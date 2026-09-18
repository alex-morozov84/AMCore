#!/usr/bin/env node
import { readFileSync } from 'node:fs'

import { validateDecision } from './output-schema.mjs'

const [pathname] = process.argv.slice(2)
if (!pathname) throw new Error('output path is required')
validateDecision(JSON.parse(readFileSync(pathname, 'utf8')))
