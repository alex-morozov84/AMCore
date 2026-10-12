import { z } from 'zod'

/** DTOs keep handler types; Nest12 parameter metadata owns request validation. */
export interface SchemaDto<S extends z.ZodType = z.ZodType> {
  new (): z.output<S>
  readonly schema: S
  readonly name: string
}

export const schemaNames = new WeakMap<z.ZodType, string>()

export function createSchemaDto<S extends z.ZodType>(source: S): SchemaDto<S> {
  const schemas = new WeakMap<object, S>()
  class Dto {
    static get schema(): S {
      let schema = schemas.get(this)
      if (!schema) {
        schema = source.clone()
        schemas.set(this, schema)
        schemaNames.set(schema, this.name)
      }
      return schema
    }
  }
  return Dto as unknown as SchemaDto<S>
}
