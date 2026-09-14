import { readFileSync } from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

function parseConfig(root, relative) {
  const configPath = path.join(root, relative)
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile)
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configPath))
  return { directory: path.dirname(configPath), options: parsed.options }
}

export function loadTsconfigResolvers(root, configPaths) {
  return configPaths
    .map((relative) => parseConfig(root, relative))
    .sort((left, right) => right.directory.length - left.directory.length)
}

function resolverFor(file, resolvers) {
  return resolvers.find(({ directory }) => file.startsWith(`${directory}${path.sep}`))
}

function insideRoot(root, file) {
  const relative = path.relative(root, file)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export function resolveImport(root, resolvers, importer, specifier) {
  const resolver = resolverFor(importer, resolvers)
  const options = resolver?.options ?? {
    allowJs: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  }
  const result = ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule
  if (!result || !insideRoot(root, result.resolvedFileName)) return undefined
  return path.relative(root, result.resolvedFileName).replaceAll('\\', '/')
}

export function configuredAliases(resolvers) {
  return resolvers.flatMap(({ options }) => Object.keys(options.paths ?? {}))
}

export function isRelevantSpecifier(specifier, aliases) {
  if (specifier.startsWith('.')) return true
  return aliases.some((alias) => {
    const prefix = alias.endsWith('*') ? alias.slice(0, -1) : alias
    return alias.endsWith('*') ? specifier.startsWith(prefix) : specifier === alias
  })
}

export function readSource(file) {
  return readFileSync(file, 'utf8')
}
