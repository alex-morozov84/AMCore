import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, chmod } from 'node:fs/promises'
const execute = promisify(execFile)
export async function certificates(directory) {
  const ssl = `${directory}/ssl`
  await mkdir(ssl)
  await writeFile(
    `${ssl}/san.cnf`,
    '[req]\nprompt=no\ndistinguished_name=dn\nreq_extensions=ext\n[dn]\nCN=migration-db\n[ext]\nsubjectAltName=DNS:migration-db,DNS:localhost,IP:127.0.0.1\n'
  )
  const commands = [
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${ssl}/ca.key`,
      '-out',
      `${ssl}/ca.crt`,
      '-days',
      '1',
      '-subj',
      '/CN=AMCore Fixture CA',
    ],
    [
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${ssl}/server.key`,
      '-out',
      `${ssl}/server.csr`,
      '-config',
      `${ssl}/san.cnf`,
    ],
    [
      'x509',
      '-req',
      '-in',
      `${ssl}/server.csr`,
      '-CA',
      `${ssl}/ca.crt`,
      '-CAkey',
      `${ssl}/ca.key`,
      '-CAcreateserial',
      '-out',
      `${ssl}/server.crt`,
      '-days',
      '1',
      '-extensions',
      'ext',
      '-extfile',
      `${ssl}/san.cnf`,
    ],
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${ssl}/wrong.key`,
      '-out',
      `${ssl}/wrong.crt`,
      '-days',
      '1',
      '-subj',
      '/CN=AMCore Wrong CA',
    ],
  ]
  for (const args of commands)
    await execute('openssl', args, { timeout: 10000, maxBuffer: 1024 * 1024 })
  await chmod(`${ssl}/ca.crt`, 0o644)
  await chmod(`${ssl}/wrong.crt`, 0o644)
  return ssl
}
