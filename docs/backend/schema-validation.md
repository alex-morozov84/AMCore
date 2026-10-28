# Request and response schemas

AMCore uses shared Zod schemas with NestJS 12's Standard Schema request validation.
It does not require `nestjs-zod` or `class-validator`.

## Requests

Keep schemas in `packages/shared`. Do not add literal localized messages.
Custom issues carry `params: { errorCode }`; the frontend translates that code.

Wrap the schema to retain a named DTO and its parsed TypeScript type:

```ts
import { createSchemaDto } from '../../common/schemas/schema-dto'

export class CreateThingDto extends createSchemaDto(createThingSchema) {}
```

A direct factory binding needs an explicit stable name, including union DTOs:

```ts
export const ChoiceDto = createSchemaDto(choiceSchema, 'ChoiceDto')
```

Named subclasses use their class names. Assigning an anonymous factory result to
a variable does not rename its runtime class. Use a unique DTO name for each contract.

Declare the schema explicitly on each validated parameter:

```ts
create(@Body({ schema: CreateThingDto.schema }) input: CreateThingDto) {
  return this.service.create(input)
}
```

Use the same option on `@Query()` and `@Param()`. A raw schema works too:
`@Param('id', { schema: identifierSchema })`. A DTO type alone does not validate
input. The global native pipe reads parameter schema metadata, applies coercion,
defaults and transformations, and rejects invalid input.

`createSchemaValidationPipe()` supplies the application exception factory.
It preserves nested/root paths, issue codes and custom `errorCode`, including
Standard Schema's `{ key }` path segments. Only transport fields survive in the
exception; the request value and nested validation error objects do not.
The existing HTTP exception filter emits field errors and the correlation ID.
For explicit `safeParse()` branches, throw `SchemaValidationException(error)`.

## Responses

Declare the DTO with `@SchemaResponse({ type: ThingDto, status: 200 })`.
This declaration binds three contracts:

```text
Shared schema -> handler return type
              -> whole-response validation -> filtered HTTP response
              -> Swagger output schema
```

The decorator checks the handler's return type at compilation. The global
`SchemaResponseInterceptor` validates the entire declared response, including an
array's length, primitive values and null. It applies schema transforms and strips
unknown fields. Invalid responses produce a safe 500 with `INTERNAL_ERROR`;
neither the invalid response nor its validation issues enter the exception.

The handler returns the response schema's input; the interceptor produces its
output. If the handler already applies a transform, declare a separate schema
for that result to avoid applying the transform twice. `[ThingDto]` declares an
array of that DTO. A root array schema keeps its whole-array constraints.

Use `SchemaResponses` when a route has several JSON outcomes. Declare a separate
DTO and HTTP status for each outcome:

```ts
@SchemaResponses(
  { type: ReadyDto, status: 200 },
  { type: PendingDto, status: 202 },
)
```

The handler returns the DTO union. The first status is the default; a passthrough
response selects another status explicitly. After the handler completes, the
interceptor validates the body against that status's schema. A body valid only for
another status, or an undeclared status, fails safely. A pending response cannot
serialize credentials through the completed response's schema. Swagger documents
each status with its own DTO rather than a shared ambiguous union.

The interceptor passes through responses without a schema. Keep download,
`StreamableFile`, SSE, manual responses and 204 handlers outside JSON validation
unless they already declare a corresponding response contract.

Nest's native serializer processes arrays element by element and bypasses some
falsy values. AMCore's narrow interceptor preserves whole-response contracts.
Request validation uses the native pipe directly.

## OpenAPI and checks

`buildApiDocument()` passes `schemaOpenApiConverter` to Swagger. It uses Zod's
input/output JSON Schema conversion and preserves named DTO components:
`ThingDto` for requests and `ThingDto_Output` for responses.
Unrepresentable JSON transformations use Zod's `any` conversion; runtime validation
still uses the complete shared schema. Do not replace a runtime contract with its
documentation projection.

Run API typecheck and the schema unit fixtures for changes to this seam. The
return-type fixture checks a valid return and the specific compilation diagnostic
for an invalid return. The OpenAPI E2E suite checks the public route inventory,
success bodies, security, multipart requests and component references.

NestJS 12 and the API use ESM on the declared Node floor.
See [API build and ESM runtime](api-build.md). Jest remains the existing
runner; unit transformation deliberately retains CommonJS. Framework upgrades also need
role boot, worker admission and shutdown checks because lifecycle ordering changes.

SWC emits legacy decorator metadata for API unit and E2E tests. Type checking
remains a separate command. E2E keeps its ESM test module format.

The E2E Jest setup evaluates Nest and its BullMQ integration before loading each
suite. Jest's mixed CJS/ESM loader can otherwise reject a companion's synchronous
require while the same ESM graph is still loading. This preparation runs in every
isolated test environment and does not rely on the order of test files.
