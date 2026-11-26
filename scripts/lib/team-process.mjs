import { execFileSync } from 'node:child_process'
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const TEAM_PROCESS_FIELD = 'Team process'
export const DEFAULT_TEAM_PROCESS = 'amcore'

export function validTeamProcess(root, value) {
  if (value === DEFAULT_TEAM_PROCESS) return true
  if (!value.startsWith('file:')) return false
  const relative = value.slice('file:'.length)
  if (
    relative !== relative.trim() ||
    !relative.toLowerCase().endsWith('.md') ||
    /[\\:`<>[\]\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(relative) ||
    relative.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return false

  try {
    const target = join(realpathSync(root), relative)
    if (realpathSync(target) !== target || !statSync(target).isFile()) return false
    accessSync(target, constants.R_OK)
    execFileSync('git', ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', relative], {
      cwd: root,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

export function teamProcessError(root, value, tr) {
  if (validTeamProcess(root, value)) return
  return tr(
    'Use amcore or file: followed by the relative path to a readable, tracked Markdown file inside the repository.',
    'Укажите amcore или file: и относительный путь к доступному Markdown-файлу, который отслеживается Git в этом репозитории.'
  )
}
