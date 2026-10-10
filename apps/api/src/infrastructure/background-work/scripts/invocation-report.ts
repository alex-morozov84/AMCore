import type { Redis } from 'ioredis'
import { z } from 'zod'

import { workFailureCodeSchema } from '@amcore/shared'

const reportSchema = z.strictObject({
  report: z.enum(['success', 'failure']),
  code: z.enum([
    'COMPLETED',
    'TRANSIENT_FAILURE',
    'PERMANENT_FAILURE',
    'CONTENT_UNSUPPORTED',
    'RATE_LIMITED',
    'NO_CALL',
  ]),
  failureCode: workFailureCodeSchema.optional(),
  incarnation: z.uuid(),
  invocationId: z.uuid(),
  revision: z.number().int().nonnegative(),
  lockToken: z.string().min(1).max(128),
})

const REPORT_LUA = `
local function reject(code) return {'rejected',code} end
if redis.call('TYPE', KEYS[1]).ok ~= 'hash' or
   redis.call('TYPE', KEYS[2]).ok ~= 'string' then return reject('STATE_CHANGED') end
if redis.call('HLEN', KEYS[1]) > 64 then return reject('CONTENT_UNSUPPORTED') end
local fields = {'amIncarnation','amInvocationId','amRevision','amMetadata','amHistory'}
local limits = {128,128,128,2048,8192}
for i,field in ipairs(fields) do
  if redis.call('HSTRLEN', KEYS[1], field) > limits[i] then
    return reject('CONTENT_UNSUPPORTED')
  end
end
local values = redis.call('HMGET', KEYS[1], unpack(fields))
if values[1] ~= ARGV[1] or values[2] ~= ARGV[2] or values[3] ~= ARGV[3] or
  redis.call('GET', KEYS[2]) ~= ARGV[4] then return reject('STATE_CHANGED') end
local revision = tonumber(values[3])
if not revision or revision < 0 or revision >= 9007199254740991 or
  revision ~= math.floor(revision) then return reject('CONTENT_UNSUPPORTED') end
local ok,metadata = pcall(cjson.decode, values[4] or '')
if not ok or type(metadata) ~= 'table' or metadata.report ~= 'unrecorded' or
  metadata.invocationId ~= ARGV[2] then return reject('STATE_CHANGED') end
local historyOk,history = pcall(cjson.decode, values[5] or '[]')
if not historyOk or type(history) ~= 'table' or #history >= 16 then
  return reject('CONTENT_UNSUPPORTED')
end
for key,_ in pairs(history) do
  if type(key) ~= 'number' or key ~= math.floor(key) or key < 1 or key > #history then
    return reject('CONTENT_UNSUPPORTED')
  end
end
for _,entry in ipairs(history) do
  if type(entry) ~= 'table' or #cjson.encode(entry) > 512 then
    return reject('CONTENT_UNSUPPORTED')
  end
end
local time = redis.call('TIME')
local now = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)
local summary = {version=1,report=ARGV[5],code=ARGV[6],invocationId=ARGV[2],
  startedAt=metadata.startedAt,finishedAt=now}
if ARGV[7] ~= '' then
  if ARGV[5] ~= 'failure' or #ARGV[7] > 64 or not string.match(ARGV[7], '^[A-Za-z0-9_-]+$') then
    return reject('CONTENT_UNSUPPORTED')
  end
  summary.failureCode = ARGV[7]
end
local encoded = cjson.encode(summary)
if #encoded > 512 then return reject('CONTENT_UNSUPPORTED') end
table.insert(history,summary)
local encodedHistory = cjson.encode(history)
if #encodedHistory > 8192 then return reject('CONTENT_UNSUPPORTED') end
local additions = 0
for _,field in ipairs({'amMetadata','amHistory','amRevision'}) do
  if redis.call('HEXISTS',KEYS[1],field) == 0 then additions = additions+1 end
end
if redis.call('HLEN',KEYS[1])+additions > 64 then return reject('CONTENT_UNSUPPORTED') end
-- FIRST WRITE: stale workers cannot turn an unrecorded attempt into success.
redis.call('HSET', KEYS[1], 'amMetadata',encoded,'amHistory',encodedHistory,
  'amRevision',revision+1)
return {'recorded',tostring(revision+1)}
`

export async function reportManagedInvocation(
  client: Redis,
  jobKey: string,
  report: z.input<typeof reportSchema>
): Promise<
  | { readonly recorded: true; readonly revision: number }
  | { readonly recorded: false; readonly reason: string }
> {
  const input = reportSchema.parse(report)
  const reply = await client.eval(
    REPORT_LUA,
    2,
    jobKey,
    `${jobKey}:lock`,
    input.incarnation,
    input.invocationId,
    input.revision,
    input.lockToken,
    input.report,
    input.code,
    input.failureCode ?? ''
  )
  if (!Array.isArray(reply)) throw new Error('INVALID_BROKER_REPLY')
  if (reply[0] === 'recorded') {
    const revision = Number(reply[1])
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('INVALID_BROKER_REPLY')
    return { recorded: true, revision }
  }
  if (reply[0] === 'rejected' && typeof reply[1] === 'string')
    return { recorded: false, reason: reply[1] }
  throw new Error('INVALID_BROKER_REPLY')
}
