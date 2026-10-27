// Test-only filesystem access through the actual runtime UID; no host-UID assumption.
import { removeContainer } from './migrator-lifecycle/resources.mjs'

export function fileIo({ f, data, archive, root, container, run }) {
  const execute = async (args, expected = true) => {
    try {
      return await run(container(args), expected)
    } finally {
      await removeContainer(f, f.containers[0])
    }
  }
  const uid = process.getuid(),
    gid = process.getgid()
  const mounts = [
    '--mount',
    `type=bind,src=${data},dst=/data`,
    '--mount',
    `type=bind,src=${archive},dst=/archive`,
  ]
  return {
    invoke: (mode, expected = true) =>
      execute(
        [
          '--entrypoint',
          'sh',
          '--env',
          `EXPORT_UID=${uid}`,
          '--env',
          `EXPORT_GID=${gid}`,
          '--mount',
          `type=bind,src=${data},dst=/data${mode === 'backup' ? ',readonly' : ''}`,
          '--mount',
          `type=bind,src=${archive},dst=/archive${mode === 'restore' ? ',readonly' : ''}`,
          '--mount',
          `type=bind,src=${root}/docker/postgres/local-files.sh,dst=/local-files.sh,readonly`,
          'postgres:18-alpine',
          '/local-files.sh',
          mode,
        ],
        expected
      ),
    runtime: (command, ...args) =>
      execute([
        '--user',
        '1001:1001',
        '--entrypoint',
        'sh',
        ...mounts,
        'postgres:18-alpine',
        '-c',
        command,
        'sh',
        ...args,
      ]),
    reset: () =>
      execute([
        '--entrypoint',
        'sh',
        ...mounts,
        'postgres:18-alpine',
        '-c',
        `find /data -mindepth 1 -delete && chown ${uid}:${gid} /data && chmod 0700 /data`,
      ]),
    root: (command) =>
      execute(['--entrypoint', 'sh', ...mounts, 'postgres:18-alpine', '-c', command]),
  }
}
