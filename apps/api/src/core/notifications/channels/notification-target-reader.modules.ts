import { Module } from '@nestjs/common'

import { PrismaModule } from '../../../prisma'

import { EmailTargetResolver } from './email-target.resolver'
import { TelegramTargetResolver } from './telegram/telegram-target.resolver'

@Module({ providers: [EmailTargetResolver], exports: [EmailTargetResolver] })
export class EmailTargetReaderModule {}

@Module({
  imports: [PrismaModule],
  providers: [TelegramTargetResolver],
  exports: [TelegramTargetResolver],
})
export class TelegramTargetReaderModule {}
