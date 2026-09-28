import { run } from './process.mjs'

export function psqlArguments(target, variables = {}) {
  if (!/^[a-f0-9]{64}$/.test(target.postgres) || !target.engine?.endpoint?.startsWith('unix://'))
    throw new Error('Invalid admitted local SQL target')
  if (!variables || typeof variables !== 'object' || Array.isArray(variables))
    throw new Error('Invalid SQL fixture variables')
  return [
    'exec',
    '-i',
    target.postgres,
    'env',
    '-i',
    'PATH=/usr/local/bin:/usr/bin:/bin',
    'psql',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    '/var/run/postgresql',
    '-p',
    '5432',
    '-U',
    'amcore',
    '-d',
    'amcore',
    '-At',
    ...Object.entries(variables).flatMap(([key, value]) => {
      if (!/^[a-z][a-z0-9_]*$/.test(key) || !['string', 'number'].includes(typeof value))
        throw new Error('Invalid SQL variable')
      return ['-v', `${key}=${value}`]
    }),
  ]
}
export function localSql(target, query, variables = {}) {
  return run('docker', ['--host', target.engine.endpoint, ...psqlArguments(target, variables)], {
    capture: true,
    input: query,
  })
}

export function fixtureInput(target, query) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(target.uuid))
    throw new Error('Invalid stand marker identity')
  // Supported fixtures are ordinary SELECT/DML, not a general SQL shell.
  if (
    typeof query !== 'string' ||
    !query.trim() ||
    /\\|\b(?:COPY|CONNECT|dblink|BEGIN|COMMIT|ROLLBACK|ABORT|SAVEPOINT|RELEASE|END|DO|CALL|PREPARE|DISCARD|START|RESET)\b/i.test(
      query
    ) ||
    /(?:^|;)\s*SET\b|\bSET\s+(?:SESSION|LOCAL|TRANSACTION|ROLE|CONSTRAINTS)\b/i.test(query)
  )
    throw new Error('Unsupported SQL fixture query or transaction control')
  const input = `\\set QUIET 1
BEGIN;
DO $stand$ DECLARE actual text; BEGIN
  SELECT uuid INTO STRICT actual FROM stand_meta.identity FOR SHARE;
  IF actual IS DISTINCT FROM '${target.uuid}' THEN
    RAISE EXCEPTION 'DB marker mismatch';
  END IF;
END $stand$;
\\set QUIET 0
${query}
\\set QUIET 1
COMMIT;
`
  return input
}
export function fixtureSql(target, query, variables = {}) {
  return localSql(target, fixtureInput(target, query), variables)
}
