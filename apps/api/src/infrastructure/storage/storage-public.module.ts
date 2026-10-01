import { Module } from '@nestjs/common'

import { StoragePublicController } from './storage-public.controller'

/** HTTP-only consumer of globally provided storage; workers expose no file routes. */
@Module({ controllers: [StoragePublicController] })
export class StoragePublicModule {}
