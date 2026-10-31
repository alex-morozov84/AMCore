import { invariant } from '../lib/lighthouse-plan.mjs'

export function browserSandboxProfile(executablePath) {
  invariant(
    /^\/[-\w./]+\/\.cache\/puppeteer\/chrome\/linux-156\.0\.8078\.47\/chrome-linux64\/chrome$/.test(
      executablePath
    ) && !executablePath.split('/').includes('..'),
    'invalid-browser-sandbox-path'
  )
  return `abi <abi/4.0>,\ninclude <tunables/global>\nprofile amcore-lighthouse "${executablePath}" flags=(unconfined) {\n  userns,\n}\n`
}

export function assertBrowserSandbox(state) {
  for (const [key, value] of Object.entries({
    'Layer 1 Sandbox': 'Namespace',
    'PID namespaces': 'Yes',
    'Network namespaces': 'Yes',
    'Seccomp-BPF sandbox': 'Yes',
  }))
    invariant(state[key] === value, 'browser-sandbox-not-active')
}
