import { test } from 'node:test'
import { mkdtemp, mkdir, cp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { root } from './state.mjs'
import { run } from './process.mjs'

for (const signal of ['SIGINT', 'SIGTERM'])
  for (const [graceful, unproved] of [
    [false, false],
    [true, false],
    [false, true],
  ])
    test(`wrapper preparation inherited pipes ${signal} graceful=${graceful} unproved=${unproved}`, async () => {
      const fixture = await mkdtemp(join(tmpdir(), 'amcore-prepare-proof-'))
      await mkdir(`${fixture}/scripts`)
      await symlink(`${root}/node_modules`, `${fixture}/node_modules`)
      await cp(`${root}/scripts/stand`, `${fixture}/scripts/stand`, {
        recursive: true,
        filter: (path) => !path.endsWith('.test.mjs'),
      })
      const foreign = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
        detached: true,
        stdio: 'ignore',
      })
      const worker = `process.title='t016-pipe-worker';
        process.on('SIGINT',()=>{}); process.on('SIGTERM',()=>{});
        require('node:fs').writeFileSync('ready',String(process.pid)); setInterval(()=>{},1000)`
      const parent = `const fs=require('node:fs');
        const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(worker)}],
          {stdio:['ignore','inherit','inherit']});
        for(const s of ['SIGINT','SIGTERM']) process.on(s,()=>{
          fs.writeFileSync('leader-exit','yes'); process.exit(0);
        }); setInterval(()=>{},1000)`
      const runner = `const fs=require('node:fs');
        const child=require('node:child_process').spawn(process.execPath,['-e',
          'setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']});
        fs.writeFileSync('ready',String(child.pid));
        for(const s of ['SIGINT','SIGTERM']) process.on(s,()=>setTimeout(()=>{
          child.kill('SIGTERM');
          child.on('close',()=>{const m=JSON.parse(fs.readFileSync('manifest-path','utf8'));
            const record=JSON.parse(fs.readFileSync(m,'utf8')); record.state='purged';
            fs.writeFileSync(m,JSON.stringify(record)); fs.writeFileSync('graceful-done','yes');
            process.exit(0);});
        },6500)); setInterval(()=>{},1000)`
      await writeFile(
        `${fixture}/proof.mjs`,
        program({ signal, graceful, unproved, parent, runner })
      )
      let verified = false
      try {
        await run(process.execPath, ['proof.mjs'], { cwd: fixture, capture: true })
        process.kill(foreign.pid, 0)
        verified = true
      } finally {
        foreign.kill('SIGTERM')
        await once(foreign, 'close')
        if (verified) await rm(fixture, { recursive: true })
        else console.error(`Preparation proof incomplete; retain recovery: ${fixture}`)
      }
    })

function program({ signal, graceful, unproved, parent, runner }) {
  return `
    import assert from 'node:assert/strict';
    import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
    import {cancellation} from './scripts/stand/cancellation.mjs';
    import {run,children,stopChildren} from './scripts/stand/process.mjs';
    import {directory,load,save,root} from './scripts/stand/state.mjs';
    import {processTable} from './scripts/stand/process-groups.mjs';
    const operation=await cancellation(), wrapperId=operation.standId.slice(0,-4);
    const cwd=directory(wrapperId)+'/fixture'; await mkdir(cwd);
    if (${graceful}) {
      const m={version:1,id:operation.standId,worktree:root,state:'cleanup-running'};
      await save(m); await writeFile(cwd+'/manifest-path',JSON.stringify(directory(m.id)+'/manifest.json'));
    }
    let completed=false, finallyReached=false;
    const running=(async()=>{
      try { await run(process.execPath,['-e',${JSON.stringify(graceful ? runner : parent)}],
        {cwd,capture:true,signal:operation.signal,graceful:${graceful}}); }
      catch(error) { assert.match(error.message,${unproved ? '/unproved or reused/' : '/interrupted|SIG|failed/'}); }
      finally { finallyReached=true;
        if (${unproved}) await assert.rejects(()=>operation.finish(),/unproved or reused/);
        else await operation.finish();
      }
      completed=true;
    })();
    let worker,leader;
    for(let n=0;n<200;n++) {
      worker=Number(await readFile(cwd+'/ready','utf8').catch(()=>0));
      leader=[...children].find(c=>c.standMembers?.some(p=>p.pid===worker));
      if(worker && leader) break;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.ok(leader,'worker must be admitted while leader lives');
    const originalMembers=structuredClone(leader.standMembers);
    if (${unproved}) leader.standMembers=[{pid:leader.pid,started:'reused birth'}];
    const began=Date.now(); process.kill(process.pid,${JSON.stringify(signal)});
    await new Promise(resolve=>setTimeout(resolve,750));
    if (!${unproved}) assert.equal(finallyReached,false,'held streams must not bypass cleanup');
    if (!${unproved}) assert.equal(completed,false);
    assert.ok(processTable().some(row=>row.pid===worker));
    if (!${graceful} && !${unproved}) {
      assert.equal(await readFile(cwd+'/leader-exit','utf8'),'yes');
      assert.ok(!processTable().some(row=>row.pid===leader.pid),'leader exits before pipe close');
    }
    const deadline=Date.now()+14000;
    while(!completed && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(completed,true,'cancellation must reach finally within bounded lifecycle');
    await running;
    if (${unproved}) {
      const failed=await load(wrapperId); assert.equal(failed.closeout.incomplete,true);
      await access(directory(wrapperId)+'/lease/owner.json');
      const journal=JSON.parse(await readFile(directory(wrapperId)+'/lease/children.json','utf8'));
      assert.equal(journal[0].pid,leader.pid);
      assert.ok(processTable().some(row=>row.pid===leader.pid));
      for(const member of originalMembers) assert.ok(processTable().some(row=>
        row.pid===member.pid && row.started===member.started));
      // Test-only corrupted evidence is restored only after its original identities match.
      leader.standMembers=originalMembers; await stopChildren(); await operation.finish();
    } else assert.ok(Date.now()-began>=${graceful ? 6400 : 4900});
    assert.ok(!processTable().some(row=>row.pid===worker || row.pgid===leader.pid));
    if (${graceful}) assert.equal(await readFile(cwd+'/graceful-done','utf8'),'yes');
    const record=await load(wrapperId);
    assert.equal(record.state,'purged'); assert.ok(record.closeout.verifiedAt);
    await assert.rejects(()=>access(directory(wrapperId)+'/lease'),{code:'ENOENT'});
    process.exitCode=0;
  `
}
