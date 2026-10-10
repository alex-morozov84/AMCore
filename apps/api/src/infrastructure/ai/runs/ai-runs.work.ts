import { defineWork } from '../../background-work/work-definition'
import { JobName, QueueName } from '../../queue/constants/queues.constant'

import { type AiRunWakeJob,aiRunWakeJobSchema } from './ai-run-wake.schema'

export const aiRunsWork = defineWork({
  id: 'ai-runs',
  presentation: {"name": {"en": "AI processing", "ru": "Обработка ИИ"}, "fields": {"runId": {"en": "Run ID", "ru": "Идентификатор запуска"}}}, definitionVersion: 1, kind: 'wake', legacy: { kind: 'wake-hint' },
  queue: { name: QueueName.AI_RUNS, enabled: true },
  jobs: { [JobName.AI_RUN_WAKE]: {
    wireVersion: 1, schema: aiRunWakeJobSchema, replay: { kind: 'unsupported', policyVersion: 1 },
    project: (payload: AiRunWakeJob): Readonly<Record<string, string>> =>
      payload.runId ? { runId: payload.runId } : {},
    retention: { completedMs: 3600000, failedMs: 86400000 },
  } },
})
