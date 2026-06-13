import { parseAppleUserName } from './apple-user'

describe('parseAppleUserName', () => {
  it('builds a full name from first + last', () => {
    const raw = JSON.stringify({ name: { firstName: 'Jane', lastName: 'Appleseed' } })
    expect(parseAppleUserName(raw)).toBe('Jane Appleseed')
  })

  it('accepts only a first name', () => {
    const raw = JSON.stringify({ name: { firstName: 'Jane' } })
    expect(parseAppleUserName(raw)).toBe('Jane')
  })

  it('accepts only a last name', () => {
    const raw = JSON.stringify({ name: { lastName: 'Appleseed' } })
    expect(parseAppleUserName(raw)).toBe('Appleseed')
  })

  it('ignores the email and other fields', () => {
    const raw = JSON.stringify({
      name: { firstName: 'Jane', lastName: 'Appleseed' },
      email: 'jane@example.com',
    })
    expect(parseAppleUserName(raw)).toBe('Jane Appleseed')
  })

  it.each([
    ['undefined', undefined],
    ['empty string', ''],
    ['malformed JSON', '{not-json'],
    ['no name object', JSON.stringify({ email: 'jane@example.com' })],
    ['empty name object', JSON.stringify({ name: {} })],
    ['blank name parts', JSON.stringify({ name: { firstName: '  ', lastName: '' } })],
    ['non-string input', { name: { firstName: 'Jane' } } as unknown],
  ])('returns null for %s', (_label, input) => {
    expect(parseAppleUserName(input)).toBeNull()
  })
})
