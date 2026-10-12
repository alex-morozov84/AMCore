import {
  workCatalogueSchema,
  workCommandSchema,
  workEvidenceReconciliationSchema,
  workJobSchema,
  workPageSchema,
  workReceiptSchema,
  workReconciliationSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

export class BackgroundWorkCommandDto extends createSchemaDto(workCommandSchema) {}
export class BackgroundWorkReceiptDto extends createSchemaDto(workReceiptSchema) {}
export class BackgroundWorkCatalogueDto extends createSchemaDto(workCatalogueSchema) {}

export class BackgroundWorkJobDto extends createSchemaDto(workJobSchema) {}
export class BackgroundWorkPageDto extends createSchemaDto(workPageSchema) {}
export class BackgroundWorkReconciliationDto extends createSchemaDto(workReconciliationSchema) {}
export class BackgroundWorkEvidenceReconciliationDto extends createSchemaDto(
  workEvidenceReconciliationSchema
) {}
