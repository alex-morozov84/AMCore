import { createHash } from 'node:crypto'

import { Injectable, Module } from '@nestjs/common'
import { z } from 'zod'

import {
  WORK_OPERATIONS,
  type WorkCommand,
  type WorkJob,
  type WorkListQuery,
  type WorkPage,
  type WorkReason,
  type WorkSummary,
} from '@amcore/shared'

import {
  defineDurableWork,
  type DurableControlState,
  type DurableOutcome,
  type DurableTransactionContext,
  type DurableWorkControl,
  type DurableWorkReader,
  resolveWorkFailure,
} from '@/infrastructure/background-work'
import { PrismaModule, PrismaService } from '@/prisma'

export const importWork = defineDurableWork({
  id: 'fixture-import',
  definitionVersion: 1,
  failureReasons: {
    invalid_import: {
      title: {
        en: 'The import file contains invalid data',
        ru: 'Файл импорта содержит некорректные данные',
      },
      nextStep: {
        en: 'Correct the source file before requesting another attempt.',
        ru: 'Исправьте исходный файл перед повторной обработкой.',
      },
    },
  },
  presentation: {
    name: { en: 'Demo import', ru: 'Демонстрационный импорт' },
    fields: { reference: { en: 'Work record ID', ru: 'Идентификатор записи работы' } },
  },
})
const rowSchema = z.object({
  id: z.string().max(128),
  incarnation: z.uuid(),
  revision: z.number().int().nonnegative(),
  state: z.enum(['waiting', 'active', 'failed', 'completed']),
  attempts: z.number().int().nonnegative(),
  grant: z.enum(['none', 'spent']),
  certainty: z.enum(['none', 'accepted', 'unknown']),
  finished: z.date().nullable(),
  failure_code: z.string().nullable().optional(),
})
type ImportRow = z.infer<typeof rowSchema>
type ImportState = { paused: boolean; revision: number; rows: ImportRow[] }
const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const identityRevision = (row: ImportRow): string =>
  digest([
    row.incarnation,
    row.revision,
    row.state,
    row.attempts,
    row.grant,
    row.certainty,
    row.finished?.toISOString(),
    row.failure_code ?? null,
  ])

/** Business authority only. Generic ADMIN owns authentication, receipts, limits and audit. */
@Injectable()
export class ImportWorkAdapter implements DurableWorkReader, DurableWorkControl {
  constructor(private readonly db: PrismaService) {}

  async readSummary(): Promise<WorkSummary> {
    const [control] = await this.db.$queryRaw<ImportState[]>`
      SELECT paused, revision FROM core.fixture_import_control WHERE id = 1`
    if (!control) throw new Error('MISSING_BUSINESS_AUTHORITY')
    return {
      id: importWork.id,
      kind: 'durable',
      definitionVersion: 1,
      status: 'available',
      sampledAt: new Date().toISOString(),
      paused: control.paused,
      revision: digest([control.paused, control.revision]),
      capabilities: WORK_OPERATIONS.map((operation) => ({
        operation,
        allowed:
          operation === 'pause' ? !control.paused : operation === 'resume' ? control.paused : true,
      })),
    }
  }

  async list(query: WorkListQuery): Promise<WorkPage> {
    const offset = (query.page - 1) * query.limit
    const remaining = Math.min(query.limit, 512 - offset)
    const rows = await this.db.$queryRaw<(ImportRow & { window_truncated: boolean })[]>`
      WITH first_window AS MATERIALIZED (
        SELECT * FROM core.fixture_imports WHERE state = ${query.state}
        ORDER BY id LIMIT 513
      )
      SELECT *, (SELECT count(*) > 512 FROM first_window) AS window_truncated
      FROM first_window ORDER BY id LIMIT ${remaining + 1} OFFSET ${offset}`
    return {
      workId: importWork.id,
      sampledAt: new Date().toISOString(),
      rows: rows.slice(0, remaining).map((row) => this.project(rowSchema.parse(row))),
      windowTruncated: rows[0]?.window_truncated ?? false,
    }
  }

  async detail(id: string): Promise<WorkJob | null> {
    const [row] = await this.db.$queryRaw<
      ImportRow[]
    >`SELECT * FROM core.fixture_imports WHERE id = ${id}`
    return row ? this.project(rowSchema.parse(row)) : null
  }

  async lock(ctx: DurableTransactionContext, command: WorkCommand): Promise<DurableControlState> {
    const [control] = await ctx.tx.$queryRaw<ImportState[]>`
      SELECT paused, revision FROM core.fixture_import_control WHERE id = 1 FOR UPDATE`
    if (!control) throw new Error('MISSING_BUSINESS_AUTHORITY')
    const rows: ImportRow[] = []
    for (const target of [...command.targets].sort((a, b) => a.id.localeCompare(b.id))) {
      const [row] = await ctx.tx.$queryRaw<ImportRow[]>`
        SELECT * FROM core.fixture_imports WHERE id = ${target.id} FOR UPDATE`
      if (row) rows.push(rowSchema.parse(row))
    }
    const queue = command.operation === 'pause' || command.operation === 'resume'
    return {
      businessState: { ...control, rows },
      targets: queue
        ? [
            {
              id: importWork.id,
              snapshot: {
                revision: digest([control.paused, control.revision]),
                paused: control.paused,
              },
            },
          ]
        : command.targets.map((target) => ({
            id: target.id,
            incarnation: target.incarnation,
            snapshot: {
              revision: rows.find((row) => row.id === target.id)
                ? identityRevision(rows.find((row) => row.id === target.id)!)
                : target.revision,
            },
          })),
    }
  }

  eligibility(
    ctx: DurableTransactionContext,
    locked: DurableControlState,
    command: WorkCommand
  ): WorkReason | null {
    const state = locked.businessState as ImportState
    if (command.operation === 'pause' || command.operation === 'resume') {
      if (digest([state.paused, state.revision]) !== command.expectedWorkRevision)
        return 'STATE_CHANGED'
      return state.paused === (command.operation === 'pause') ? 'ALREADY_IN_STATE' : null
    }
    const target = command.targets[0]
    const row = state.rows.find((entry) => entry.id === target?.id)
    if (!row) return 'HISTORY_EXPIRED'
    if (row.incarnation !== target?.incarnation || identityRevision(row) !== target.revision)
      return 'STATE_CHANGED'
    if (row.state === 'active') return 'ACTIVE_JOB'
    if (command.operation === 'retry')
      return row.state !== 'failed'
        ? 'STATE_CHANGED'
        : row.certainty !== 'none'
          ? 'EFFECT_UNKNOWN'
          : row.grant !== 'none'
            ? 'MANUAL_GRANT_SPENT'
            : null
    if (command.operation === 'cancel')
      return row.state === 'waiting' && row.attempts === 0 ? null : 'ACTIVE_JOB'
    const cutoff = new Date(command.parameters.cutoff!).getTime()
    return !command.parameters.states?.includes(row.state as 'failed' | 'completed') ||
      !row.finished ||
      row.finished.getTime() > cutoff ||
      cutoff > ctx.now.getTime() - 86400000 ||
      row.certainty === 'unknown'
      ? 'STATE_CHANGED'
      : null
  }

  async apply(
    ctx: DurableTransactionContext,
    locked: DurableControlState,
    command: WorkCommand
  ): Promise<ReadonlyMap<string, DurableOutcome>> {
    const reason = this.eligibility(ctx, locked, command)
    const id = locked.targets[0]!.id
    if (reason) return new Map([[id, { state: 'rejected', reason }]])
    switch (command.operation) {
      case 'pause':
      case 'resume':
        await ctx.tx.$executeRaw`UPDATE core.fixture_import_control
          SET paused = ${command.operation === 'pause'}, revision = revision + 1 WHERE id = 1`
        break
      case 'retry':
        await ctx.tx
          .$executeRaw`UPDATE core.fixture_imports SET state = 'waiting', failure_code = NULL, "grant" = 'spent',
          revision = revision + 1 WHERE id = ${id}`
        break
      case 'cancel':
      case 'cleanup':
        await ctx.tx.$executeRaw`DELETE FROM core.fixture_imports WHERE id = ${id}`
    }
    return new Map([[id, { state: 'applied' }]])
  }

  /** Claims serialize with pause/control on the SAME business authority row. */
  async claim(): Promise<ImportRow | null> {
    return this.db.$transaction(
      async (tx) => {
        const [control] = await tx.$queryRaw<{ paused: boolean }[]>`
        SELECT paused FROM core.fixture_import_control WHERE id = 1 FOR UPDATE`
        if (!control || control.paused) return null
        const [row] = await tx.$queryRaw<ImportRow[]>`SELECT * FROM core.fixture_imports
        WHERE state = 'waiting' AND attempts < CASE WHEN "grant" = 'spent' THEN 4 ELSE 3 END
        ORDER BY id LIMIT 1 FOR UPDATE`
        if (!row) return null
        const [claimed] = await tx.$queryRaw<ImportRow[]>`UPDATE core.fixture_imports
        SET state = 'active', failure_code = NULL, attempts = attempts + 1, revision = revision + 1
        WHERE id = ${row.id} RETURNING *`
        return rowSchema.parse(claimed)
      },
      { timeout: 3000, maxWait: 1000 }
    )
  }

  private project(row: ImportRow): WorkJob {
    const capability = (
      operation: (typeof WORK_OPERATIONS)[number]
    ): WorkJob['capabilities'][number] => {
      const reason =
        operation === 'retry'
          ? row.state !== 'failed'
            ? 'STATE_CHANGED'
            : row.certainty !== 'none'
              ? 'EFFECT_UNKNOWN'
              : row.grant !== 'none'
                ? 'MANUAL_GRANT_SPENT'
                : undefined
          : operation === 'cancel'
            ? row.state !== 'waiting' || row.attempts !== 0
              ? 'ACTIVE_JOB'
              : undefined
            : operation === 'cleanup'
              ? !row.finished || row.certainty === 'unknown'
                ? 'STATE_CHANGED'
                : undefined
              : 'ACTION_UNAVAILABLE'
      return { operation, allowed: !reason, ...(reason ? { reason: reason as WorkReason } : {}) }
    }
    return {
      identity: { id: row.id, incarnation: row.incarnation, revision: identityRevision(row) },
      failure:
        row.state === 'failed' ? resolveWorkFailure(importWork, row.failure_code) : undefined,
      state: row.state,
      jobName: 'import',
      wireVersion: 1,
      source: 'domain',
      replay: 'durable',
      sampledAt: new Date().toISOString(),
      certainty: row.certainty,
      attemptsStarted: row.attempts,
      attemptsMade: row.state === 'failed' ? row.attempts : 0,
      manualGrant: row.grant,
      projection: { reference: row.id },
      capabilities: WORK_OPERATIONS.map(capability),
    }
  }
}

@Module({
  imports: [PrismaModule],
  providers: [
    ImportWorkAdapter,
    { provide: importWork.tokens.reader, useExisting: ImportWorkAdapter },
    { provide: importWork.tokens.control, useExisting: ImportWorkAdapter },
  ],
  exports: [ImportWorkAdapter, importWork.tokens.reader, importWork.tokens.control],
})
export class ImportWorkModule {}

export const importRegistration = {
  definition: importWork,
  core: async () => ImportWorkModule,
  control: async () => ImportWorkModule,
}
