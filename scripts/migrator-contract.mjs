import { verifyMigrator } from './lib/migrator-contract.mjs'
import { resolve } from 'node:path'

console.log('Migrator contract:', verifyMigrator(resolve(import.meta.dirname, '..')))
