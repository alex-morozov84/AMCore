import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import ts from 'typescript'

/**
 * Guard: BullMQ queues must come from the single queue inventory.
 *
 * A queue created outside `queue-inventory.constant.ts` is invisible to the Console Background
 * work screen, the depth metrics and `QueueService`, and nothing would say so. The compiler
 * already rejects a `QueueName` without a descriptor; this guard closes the other gap by parsing
 * every production source file and reporting file:line for the forms below.
 *
 * Detected (statically, through the TypeScript AST, so import aliases and multiline calls count):
 * - `new Queue(...)` where `Queue` is imported from `bullmq` under any local name, or
 *   `new ns.Queue(...)` on a namespace import of `bullmq`;
 * - any `x.registerQueue(...)` / `x.registerQueueAsync(...)` call, including `x['registerQueue']`;
 * - an `@InjectQueue(...)` decorator imported from `@nestjs/bullmq` under any local name.
 *
 * Not detected: queues built dynamically or reached through a re-export of `Queue` from your own
 * module, and queue-like classes from other libraries. This is a guard against accidents in
 * ordinary code, not a sandbox. Tests, specs and generated code are not scanned.
 *
 * To add a queue, follow "Adding a queue" in the queue README, not a new allowlist entry.
 */
const SRC_ROOT = join(__dirname, '..', '..')

/** Places allowed to create queues, each with the reason. Keep this list short. */
const ALLOWLIST: Record<string, string> = {
  'infrastructure/queue/queue.module.ts':
    'registers the enabled inventory, the only place that may',
}

interface Finding {
  line: number
  form: string
}

const REGISTER = new Set(['registerQueue', 'registerQueueAsync'])

function importedNames(
  sf: ts.SourceFile,
  moduleName: string,
  imported: string
): { named: Set<string>; namespaces: Set<string> } {
  const named = new Set<string>()
  const namespaces = new Set<string>()
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleName
    )
      continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings) continue
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    else {
      for (const element of bindings.elements) {
        if ((element.propertyName ?? element.name).text === imported) named.add(element.name.text)
      }
    }
  }
  return { named, namespaces }
}

function findQueueCreations(text: string, fileName = 'file.ts'): Finding[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true)
  const bullQueue = importedNames(sf, 'bullmq', 'Queue')
  const injectQueue = importedNames(sf, '@nestjs/bullmq', 'InjectQueue')
  const found: Finding[] = []
  const report = (node: ts.Node, form: string) =>
    found.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, form })

  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && bullQueue.named.has(callee.text)) report(node, 'new Queue')
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'Queue' &&
        ts.isIdentifier(callee.expression) &&
        bullQueue.namespaces.has(callee.expression.text)
      ) {
        report(node, 'new Queue')
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isPropertyAccessExpression(callee) && REGISTER.has(callee.name.text)) {
        report(node, callee.name.text)
      }
      if (
        ts.isElementAccessExpression(callee) &&
        ts.isStringLiteralLike(callee.argumentExpression) &&
        REGISTER.has(callee.argumentExpression.text)
      ) {
        report(node, callee.argumentExpression.text)
      }
      if (
        ts.isIdentifier(callee) &&
        injectQueue.named.has(callee.text) &&
        ts.isDecorator(node.parent)
      ) {
        report(node, '@InjectQueue')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === 'generated' ? [] : sources(path)
    return /\.ts$/.test(entry) && !/\.(spec|test|e2e-spec)\.ts$/.test(entry) ? [path] : []
  })
}

describe('queue creation detector', () => {
  const lines = (code: string) => findQueueCreations(code).map((f) => `${f.line}:${f.form}`)

  it.each([
    ['canonical constructor', "import { Queue } from 'bullmq'\nnew Queue('x')", ['2:new Queue']],
    [
      'aliased constructor',
      "import { Queue as ReportQueue } from 'bullmq'\nnew ReportQueue('x')",
      ['2:new Queue'],
    ],
    [
      'namespace constructor',
      "import * as bull from 'bullmq'\nconst q = new bull.Queue('x')",
      ['2:new Queue'],
    ],
    [
      'multiline registration',
      "import { BullModule } from '@nestjs/bullmq'\nBullModule\n  .registerQueue\n  ({ name: 'x' })",
      ['2:registerQueue'],
    ],
    ['async registration', "X.registerQueueAsync({ name: 'x' })", ['1:registerQueueAsync']],
    [
      'aliased module registration',
      "import { BullModule as B } from '@nestjs/bullmq'\nB.registerQueue({})",
      ['2:registerQueue'],
    ],
    [
      'element access registration',
      "BullModule['registerQueue']({ name: 'x' })",
      ['1:registerQueue'],
    ],
    [
      'aliased injection decorator',
      "import { InjectQueue as Q } from '@nestjs/bullmq'\nclass A { constructor(@Q('x') q: unknown) {} }",
      ['2:@InjectQueue'],
    ],
  ])('flags a %s', (_name, code, expected) => {
    expect(lines(code)).toEqual(expected)
  })

  it.each([
    ['a comment', "// BullModule.registerQueue({}) and new Queue('x')"],
    ['a string', 'const s = "new Queue(\'x\'); registerQueue("'],
    ['an unrelated Queue class', "import { Queue } from './my-queue'\nnew Queue('x')"],
    ['a type-only use', "import type { Queue } from 'bullmq'\nlet q: Queue | undefined"],
    ['using a queue', "queue.add('job', {})\nservice.getQueue('email')"],
    ['a similar name', 'registerQueueLike({})\nthis.registerQueuesElsewhere()'],
    [
      'an unrelated decorator',
      "import { InjectRepository } from 'x'\nclass A { constructor(@InjectRepository('q') r: unknown) {} }",
    ],
  ])('does not flag %s', (_name, code) => {
    expect(lines(code)).toEqual([])
  })
})

describe('queue registration coverage', () => {
  it('creates queues only through the single inventory', () => {
    const violations = sources(SRC_ROOT).flatMap((file) => {
      const name = relative(SRC_ROOT, file)
      if (name in ALLOWLIST) return []
      return findQueueCreations(readFileSync(file, 'utf8'), file).map(
        (finding) => `${name}:${finding.line} ${finding.form}`
      )
    })
    expect(violations).toEqual([])
  })

  it('keeps every allowlisted file real, justified and actually using the forms it is allowed', () => {
    const all = sources(SRC_ROOT).map((file) => relative(SRC_ROOT, file))
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length).toBeGreaterThan(10)
      expect(all).toContain(file)
      expect(findQueueCreations(readFileSync(join(SRC_ROOT, file), 'utf8')).length).toBeGreaterThan(
        0
      )
    }
  })
})
