import { createZodDto } from 'nestjs-zod'

import {
  workCatalogueSchema,
  workCommandSchema,
  workEvidenceReconciliationSchema,
  workJobSchema,
  workPageSchema,
  workReceiptSchema,
  workReconciliationSchema,
} from '@amcore/shared'

export class BackgroundWorkCommandDto extends createZodDto(workCommandSchema) {}
export class BackgroundWorkReceiptDto extends createZodDto(workReceiptSchema) {}
export class BackgroundWorkCatalogueDto extends createZodDto(workCatalogueSchema) {}

export class BackgroundWorkJobDto extends createZodDto(workJobSchema) {}
export class BackgroundWorkPageDto extends createZodDto(workPageSchema) {}
export class BackgroundWorkReconciliationDto extends createZodDto(workReconciliationSchema) {}
export class BackgroundWorkEvidenceReconciliationDto extends createZodDto(
  workEvidenceReconciliationSchema
) {}
