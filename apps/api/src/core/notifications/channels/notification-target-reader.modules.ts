import { Module } from '@nestjs/common'

import { PrismaModule } from '../../../prisma/index.js'

import { EmailTargetResolver } from './email-target.resolver.js'
import { TelegramTargetResolver } from './telegram/telegram-target.resolver.js'

@Module({ providers: [EmailTargetResolver], exports: [EmailTargetResolver] })
export class EmailTargetReaderModule {}

@Module({
  imports: [PrismaModule],
  providers: [TelegramTargetResolver],
  exports: [TelegramTargetResolver],
})
export class TelegramTargetReaderModule {}
