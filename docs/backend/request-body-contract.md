# Request body admission

The API parses a request before route validation. Parser acceptance does not bypass auth or promise success.
The queue board has its own early admission boundary. Its fixed responses take precedence over this parser.

## Responses

| Condition                                                                | Response                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------- |
| Malformed JSON/compressed data/header; excessive form nesting            | 400                                             |
| Dangerous prototype/constructor payload in the native secure JSON parser | 400                                             |
| Scoped decoded body limit exceeded                                       | 413 `PAYLOAD_TOO_LARGE`                         |
| More than 1000 form parameters                                           | 413 `PAYLOAD_TOO_LARGE`, parameter-count reason |
| Unsupported charset/content encoding                                     | 415                                             |
| Valid supported body at an ordinary unknown path                         | 404                                             |
| Actual internal failure                                                  | 500 `INTERNAL_SERVER_ERROR`                     |

Refusals use the existing error envelope: status, bounded message, timestamp, sanitized path and method.
Correlation ID is included when application context supplies it. Transport400/415 have no domain error code.
Validation errors and domain responses retain their existing metadata. Messages/logs do not echo request bytes.
Recognized parser failures previously reported as500 now use400/413/415. Arbitrary status fields are not trusted.

## Encodings and forms

JSON accepts supported Unicode labels beginning `utf-`, decoded with iconv-lite.
UTF16/UTF32 endian/BOM behavior and invalid-byte replacement follow that decoder. Unknown labels return415.
JSON uses Fastify's secure parser with prototype and constructor actions `error`, then object/array admission.
An explicitly framed empty JSON body parses as an object. Whitespace-only JSON, scalar values and null fail400.
An absent body remains distinct; route schemas decide whether it is permitted.

Forms support UTF8 and ISO8859-1, including percent-encoded values. Extended forms retain depth32,
arrayLimitmax(100,parameterCount), repeated keys and sparse-array compaction. Background control forms stay flat:
brackets remain literal and the output has a null prototype. Form parsers omit prototype-shadowing keys.
Full Content-Type grammar is checked before the maintained parameter parser. Duplicate parameters return400;
an empty or unsupported charset returns415. Case, quoted values and unrelated parameters do not choose a false charset.

Content-Encoding supports identity, gzip, deflate and br, case-insensitively. Coding chains and zstd return415.
Encoding refusals advertise supported codings in `Accept-Encoding`; charset refusals do not add that header.
Limits count decoded bytes. Webhook rawBody retains the exact decoded bytes. Scoped invitation/role/member/
background caps remain separate from the ordinary100000-byte cap. The Fastify reader additionally caps encoded
bytes at262144; decoded route caps still apply. Multipart uploads use their separate file limits.

## Connections and checks

Valid chunked requests can reuse a keepalive connection. Fastify deliberately sends `Connection: close`
when its parser reports an error; the client reconnects.
A cancelled partial body closes its socket; the next request must still succeed. No forced exit counts as cleanup.

The parser fixtures cover byte/hash preservation, dangerous JSON, Unicode/header/form boundaries,
chunked requests, cancellation and reconnect. Actual affected API E2E remains a separate obligation.
OpenAPI body operations include400/413/415 without replacing existing route-specific error responses.

Quoted empty `charset=""` returns415 for JSON and form parsers. An absent charset defaults to UTF8.
Unquoted `charset=` is malformed header grammar and returns400. These checks do not impose the
JSON/form charset policy on multipart or text payloads. Recognized JSON parser failures receive a
fresh safe exception before Nest adapter conversion; body fragments do not enter its response or logs.

Without Content-Length or Transfer-Encoding, an empty JSON/form request has no parsed body.
Content-Length0 and chunked-empty JSON produce an empty object; whitespace-only JSON still fails400.
Malformed or truncated gzip/deflate/br returns400. Internal failures remain500;
an arbitrary error status or code does not establish a client parser failure.
