// Jest evaluates CJS dependencies before ESM siblings in a mixed graph. A Nest
// companion can therefore require Nest while that graph is still loading.
// Finish the framework's synchronous ESM evaluation before loading each suite.
// This runs in each isolated test environment, independently of suite order.
require('@nestjs/common')
require('@nestjs/core')
require('@nestjs/bullmq')
