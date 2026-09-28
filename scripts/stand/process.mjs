import { writeFileSync, renameSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { processTable, observeGroup, observeTree } from './process-groups.mjs'
import { setRetirementJournal } from './retirement-audit.mjs'

const allowed = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'CI']
export function cleanEnvironment(extra = {}, source = process.env) {
  return {
    ...Object.fromEntries(allowed.filter((key) => source[key]).map((key) => [key, source[key]])),
    NEXT_TELEMETRY_DISABLED: '1',
    HUSKY: '0',
    COMPOSE_PROGRESS: 'plain',
    BUILDKIT_PROGRESS: 'plain',
    ...extra,
  }
}

export const children = new Set()
let journal
let cancelled = false
export const requestCancellation = () => {
  cancelled = true
}
export const allowCleanup = () => {
  cancelled = false
}
export function setJournal(path) {
  journal = path
  setRetirementJournal(path)
}
function recordChildren() {
  if (!journal) return
  const tmp = `${journal}.tmp`
  writeFileSync(
    tmp,
    JSON.stringify(
      [...children].map((c) => ({
        pid: c.pid,
        cwd: c.standCwd,
        started: c.standStarted,
        leaderBirth: c.standLeaderStarted,
        absent: c.standGroupAbsent,
        members: c.standMembers,
        closed: c.standClosed,
        proofError: c.standProofError,
        groups: c.standDetached?.map((group) => ({
          pid: group.pid,
          started: group.started,
          leaderBirth: group.leaderBirth,
          members: group.standMembers,
        })),
      }))
    ),
    { mode: 0o600 }
  )
  renameSync(tmp, journal)
}
// Preparation aborts stop the proved group independently of stream closure.
// Only managed runners opt into direct signalling so their own finally can clean resources.
export function run(
  command,
  args,
  { cwd, env = cleanEnvironment(), capture = false, input, signal, graceful = false } = {}
) {
  if (cancelled) return Promise.reject(new Error('Stand interrupted; new subprocess refused'))
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', 'pipe'],
    })
    child.standCwd = cwd
    child.standStarted = new Date().toISOString()
    if (child.pid) {
      children.add(child)
      try {
        const leader = processTable().find((row) => row.pid === child.pid && row.pgid === child.pid)
        child.standMembers = leader ? [{ pid: leader.pid, started: leader.started }] : []
        child.standLeaderStarted = leader?.started
        updateChild(child)
      } catch (error) {
        child.standProofError = error.message
      }
      recordChildren()
    }
    const monitor = setInterval(() => {
      try {
        updateChild(child)
      } catch (error) {
        child.standProofError = error.message
      }
      recordChildren()
    }, 100)
    let cancellation
    const cancel = () => {
      if (graceful) {
        try {
          signalLeader(child, signal.reason)
        } catch (error) {
          child.standProofError = error.message
          recordChildren()
          interrupted(error)
        }
        return
      }
      cancellation = stopGroups([child]).catch((error) => {
        child.standProofError = error.message
        recordChildren()
        throw error
      })
      // Settle even if an unproved survivor keeps the inherited streams open.
      cancellation.then(() => interrupted(), interrupted)
    }
    const interrupted = (error = new Error('Stand preparation interrupted')) => {
      clearInterval(monitor)
      signal?.removeEventListener('abort', cancel)
      child.stdin?.destroy()
      child.stdout?.destroy()
      child.stderr?.destroy()
      reject(error)
    }
    signal?.addEventListener('abort', cancel, { once: true })
    let output = ''
    let error = ''
    child.stdout?.on('data', (chunk) => {
      output += chunk
    })
    child.stderr?.on('data', (chunk) => {
      error = (error + chunk).slice(-8000)
      if (!capture) process.stderr.write(chunk)
    })
    child.on('error', (error) => {
      clearInterval(monitor)
      reject(error)
    })
    child.on('close', async (code, exitSignal) => {
      clearInterval(monitor)
      signal?.removeEventListener('abort', cancel)
      child.standClosed = true
      try {
        updateChild(child)
      } catch (error) {
        child.standProofError = error.message
      }
      recordChildren()
      if (cancellation) {
        await cancellation.catch(() => {})
        return
      }
      if (code === 0) resolve(output)
      else {
        const failure = new Error(
          `${command} failed (${exitSignal ?? code})${capture ? `: ${error.trim()}` : ''}`
        )
        failure.stderr = error
        reject(failure)
      }
    })
    if (input !== undefined) child.stdin.end(input)
    if (signal?.aborted) cancel()
  })
}

function updateChild(child) {
  if (!children.has(child)) return false
  if (!observeTree(child)) {
    children.delete(child)
    return false
  }
  delete child.standProofError
  return true
}

let stopping
export function stopChildren() {
  stopping ??= stopGroups().finally(() => {
    stopping = undefined
  })
  return stopping
}

async function stopGroups(targets = children) {
  const began = Date.now()
  const signalled = new Map()
  const pending = () => [...targets].filter((child) => children.has(child))
  while (pending().length) {
    for (const child of pending()) {
      if (!updateChild(child)) continue
      const signal = Date.now() - began >= 5000 ? 'SIGKILL' : 'SIGTERM'
      for (const group of [child, ...(child.standDetached ?? [])]) {
        if (!observeGroup(group) || signalled.get(group) === signal) continue
        // A live member with the recorded birth identity anchors this group.
        try {
          process.kill(-group.pid, signal)
        } catch (error) {
          if (error.code !== 'ESRCH') throw error
        }
        signalled.set(group, signal)
      }
    }
    recordChildren()
    if (pending().length && Date.now() - began >= 10000)
      throw new Error('Owned process group remains; retain lease/recovery, cleanup incomplete')
    if (pending().length) await new Promise((resolve) => setTimeout(resolve, 50))
  }
  recordChildren()
}

function signalLeader(child, signal) {
  const leader = processTable().find((row) => row.pid === child.pid)
  if (!leader) return
  if (leader.pgid !== child.pid || leader.started !== child.standLeaderStarted)
    throw new Error('Runner PID identity unproved or reused; cancellation refused')
  process.kill(child.pid, signal)
}
