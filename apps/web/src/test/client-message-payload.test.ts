import { expect, it } from 'vitest'

import { embeddedFlight, serializedClientMessages } from '../../e2e/shared/client-message-payload'

it('reads client messages across chunks and referenced rows without scanning rendered text', () => {
  const flight =
    '1:{"auth":{"login":"selected"}}\n2:["$","$L8",null,{"messages":"$1"}]\n3:["$","h1",null,{"children":"unselected server text"}]\n'
  const html = [flight.slice(0, 40), flight.slice(40)]
    .map((chunk) => `<script>self.__next_f.push(${JSON.stringify([1, chunk])})</script>`)
    .join('')
  expect(serializedClientMessages(embeddedFlight(html))).toEqual([{ auth: { login: 'selected' } }])
})

it('retains a newly introduced namespace so allowlist assertions cannot miss it', () => {
  const flight = '1:["$","$L8",null,{"messages":{"newNamespace":{"marker":"negative control"}}}]\n'
  expect(serializedClientMessages(flight)).toEqual([
    { newNamespace: { marker: 'negative control' } },
  ])
  expect(() => embeddedFlight('<html>selected text only</html>')).toThrow('No embedded Flight')
})
