import { Inject, Injectable, Module } from '@nestjs/common'
import { z } from 'zod'

import {
  bindWorkHandlers,
  defineOrdinaryWork,
  WorkFailure,
  type WorkHandler,
  type WorkInvocation,
} from '@/infrastructure/background-work'
import { PrismaModule, PrismaService } from '@/prisma'

const requestId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/)
export const imagePayload = z.strictObject({
  businessRequestId: requestId,
  transformVersion: z.number().int().min(1).max(65535),
  productId: z.number().int().positive().optional(),
  fileName: z.string().min(1).max(128).optional(),
})
export const imageWork = defineOrdinaryWork({
  id: 'image',
  failureReasons: {
    corrupted_file: {
      title: {
        en: 'The image file cannot be processed',
        ru: 'Не удалось обработать файл изображения',
      },
      nextStep: {
        en: 'Check the source file and upload a valid image.',
        ru: 'Проверьте исходный файл и загрузите корректное изображение.',
      },
    },
    storage_unavailable: {
      title: {
        en: 'Image storage is temporarily unavailable',
        ru: 'Хранилище изображений временно недоступно',
      },
      nextStep: {
        en: 'Check storage availability before retrying.',
        ru: 'Проверьте доступность хранилища перед повтором.',
      },
    },
  },
  presentation: {
    name: { en: 'Image processing', ru: 'Обработка изображений' },
    technicalFields: ['businessRequestId', 'transformVersion'],
    fields: {
      productId: { en: 'Product', ru: 'Товар' },
      fileName: { en: 'File', ru: 'Файл' },
      businessRequestId: { en: 'Request ID', ru: 'Идентификатор запроса' },
      transformVersion: { en: 'Transformation version', ru: 'Версия обработки' },
    },
  },
  definitionVersion: 2,
  queue: { name: 'image', enabled: true },
  jobs: {
    render: {
      wireVersion: 2,
      schema: imagePayload,
      // Retain the original wire shape; normalize only for handlers and safe projections.
      supportedVersions: [
        {
          wireVersion: 1,
          schema: z.strictObject({ businessKey: requestId }),
          normalize: ({ businessKey }: { businessKey: string }) => ({
            businessRequestId: businessKey,
            transformVersion: 1,
          }),
        },
      ],
      replay: { kind: 'idempotent', policyVersion: 1 },
      project: ({ businessRequestId, transformVersion, productId, fileName }) => ({
        businessRequestId,
        transformVersion,
        ...(productId !== undefined ? { productId } : {}),
        ...(fileName ? { fileName } : {}),
      }),
      retention: { completedMs: 3600000, failedMs: 86400000 },
    },
  },
})

/** Business UNIQUE identity survives broker retention, retries and recycled job IDs. */
@Injectable()
export class ImageWorkHandler implements WorkHandler<z.infer<typeof imagePayload>> {
  constructor(@Inject(PrismaService) private readonly db: Pick<PrismaService, '$queryRaw'>) {}

  async run(payload: z.infer<typeof imagePayload>, _context: WorkInvocation): Promise<string> {
    const reference = `fixture-output:${payload.businessRequestId}:${payload.transformVersion}`
    let rows: { output_reference: string }[]
    try {
      rows = await this.db.$queryRaw<{ output_reference: string }[]>`
      INSERT INTO core.image_fixture_outputs (business_request_id, transform_version, output_reference)
      VALUES (${payload.businessRequestId}, ${payload.transformVersion}, ${reference})
      ON CONFLICT (business_request_id, transform_version)
      DO UPDATE SET output_reference = image_fixture_outputs.output_reference
      RETURNING output_reference`
    } catch {
      throw new WorkFailure('storage_unavailable', { permanent: false })
    }
    const [stored] = rows
    if (!stored) throw new WorkFailure('storage_unavailable', { permanent: false })
    return stored.output_reference
  }
}

@Module({})
export class ImageCoreModule {}

@Module({ imports: [PrismaModule], providers: [ImageWorkHandler], exports: [ImageWorkHandler] })
class ImageHandlersModule {}

export const imageRegistration = {
  definition: imageWork,
  core: async () => ImageCoreModule,
  worker: async () =>
    bindWorkHandlers(imageWork, { 'render@1': ImageWorkHandler, 'render@2': ImageWorkHandler }, [
      ImageHandlersModule,
    ]),
}
