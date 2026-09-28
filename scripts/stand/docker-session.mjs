export async function withPinnedEngine(expected, action, { prove, run }) {
  const current = await prove()
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw new Error('Docker engine identity changed')
  const endpoint = current.endpoint
  if (!endpoint.startsWith('unix://')) throw new Error('Non-local Docker engine')
  return action((args, options = {}) => run('docker', ['--host', endpoint, ...args], options))
}
