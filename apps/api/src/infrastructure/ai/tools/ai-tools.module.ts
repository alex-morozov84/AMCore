import { Module } from '@nestjs/common'

import { AI_TOOLS, type AiTool } from './ai-tool.types'
import { AiToolRegistry } from './ai-tool-registry.service'
import { currentTimeTool } from './reference/current-time.tool'

/**
 * AI tool registry slice (Track C — ADR-054, Arc E.1) — `worker`/`all` roles only. Provides the
 * code-owned tool set (`AI_TOOLS`) and the `AiToolRegistry` that validates and serves it. It is
 * **not** imported by `coreImports()`/web — tools execute where provider I/O already is (the
 * worker), so the model can never reach a tool from the web DI graph (ADR-041). Arc E.4 imports this
 * into the worker run slice and wires the registry into the bounded agent loop; E.1 ships the
 * registry standalone (no executor wiring yet).
 *
 * The shipped set is a single SAFE reference tool; any approval-gated demo tool stays test-module
 * only, and no enabled assistant allowlists a tool by default (Arc E §4).
 */
@Module({
  providers: [
    {
      provide: AI_TOOLS,
      useFactory: (): AiTool[] => [currentTimeTool],
    },
    AiToolRegistry,
  ],
  exports: [AiToolRegistry, AI_TOOLS],
})
export class AiToolsModule {}
