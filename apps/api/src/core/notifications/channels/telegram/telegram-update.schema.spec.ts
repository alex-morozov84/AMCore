import { parseStartCommand, parseUpdateId } from './telegram-update.schema'

const BOT = 'amcore_bot'
const TOKEN = 'a'.repeat(43) // 43-char base64url

function startUpdate(text: string, chatId = 555, fromId = 555, type = 'private'): unknown {
  return { update_id: 10, message: { text, chat: { id: chatId, type }, from: { id: fromId } } }
}

describe('parseUpdateId', () => {
  it('returns the update_id as bigint', () => {
    expect(parseUpdateId({ update_id: 42 })).toBe(42n)
  })

  it('returns undefined when update_id is absent', () => {
    expect(parseUpdateId({ message: {} })).toBeUndefined()
    expect(parseUpdateId(null)).toBeUndefined()
  })

  it('returns undefined for a non-safe-integer update_id', () => {
    expect(parseUpdateId({ update_id: 1.5 })).toBeUndefined()
    expect(parseUpdateId({ update_id: Number.MAX_SAFE_INTEGER + 2 })).toBeUndefined()
  })
})

describe('parseStartCommand', () => {
  it('parses a valid /start <token> in a private chat', () => {
    expect(parseStartCommand(startUpdate(`/start ${TOKEN}`), BOT)).toEqual({
      chatId: '555',
      telegramUserId: '555',
      token: TOKEN,
    })
  })

  it('accepts the /start@bot form', () => {
    expect(parseStartCommand(startUpdate(`/start@${BOT} ${TOKEN}`), BOT)?.token).toBe(TOKEN)
  })

  it('rejects a non-private chat', () => {
    expect(parseStartCommand(startUpdate(`/start ${TOKEN}`, 555, 555, 'group'), BOT)).toBeNull()
  })

  it('rejects when from.id !== chat.id', () => {
    expect(parseStartCommand(startUpdate(`/start ${TOKEN}`, 555, 999), BOT)).toBeNull()
  })

  it('rejects a missing or non-/start text', () => {
    expect(parseStartCommand(startUpdate('hello'), BOT)).toBeNull()
    expect(parseStartCommand({ update_id: 1 }, BOT)).toBeNull()
  })

  it('rejects a token of the wrong length/charset', () => {
    expect(parseStartCommand(startUpdate('/start short'), BOT)).toBeNull()
    expect(parseStartCommand(startUpdate(`/start ${'!'.repeat(43)}`), BOT)).toBeNull()
  })

  it('rejects trailing content after the token', () => {
    expect(parseStartCommand(startUpdate(`/start ${TOKEN} extra`), BOT)).toBeNull()
  })

  it('rejects a wrong @bot mention', () => {
    expect(parseStartCommand(startUpdate(`/start@other_bot ${TOKEN}`), BOT)).toBeNull()
  })
})
