import { join } from 'node:path'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { auditPlan, digest } from '../lib/lighthouse-plan.mjs'
import { readViewBundle, verifyView } from '../lib/lighthouse-view-export.mjs'
import { renderIndex } from '../lib/lighthouse-view-html.mjs'
import { viewRows } from '../lib/lighthouse-view-model.mjs'

export async function writeLocalRunIndex(plan, root) {
  const current = auditPlan(root, { run: plan.run, attempt: plan.attempt, source: plan.source })
  if (current.digest !== plan.digest) throw new Error('local-view-plan-changed')
  const output = join(root, '.amcore/lighthouse-results', plan.run, plan.attempt)
  const rows = []
  for (const [lane] of Object.entries(plan.assignments).filter(([, ids]) => ids.length)) {
    const directory = join(output, lane)
    let manifest
    try {
      const bundle = await readViewBundle(join(directory, 'bundle'), plan, lane)
      await verifyView(join(directory, 'view'), plan, lane, bundle?.manifest, {
        archiveHash: bundle
          ? digest(await readFile(join(directory, 'payload.json.gz')))
          : undefined,
      })
      manifest = bundle?.manifest
    } catch {
      /* An unavailable owner remains visible without a report link. */
    }
    rows.push(
      ...viewRows(plan, lane, manifest).map((row) => ({
        ...row,
        filename: row.filename ? `${lane}/view/${row.filename}` : undefined,
      }))
    )
  }
  await mkdir(output, { recursive: true, mode: 0o700 })
  const index = join(output, 'index.html')
  await writeFile(index, renderIndex(plan, 'All owners in this local run', rows), {
    flag: 'wx',
    mode: 0o600,
  })
  return index
}
