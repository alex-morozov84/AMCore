import { MockEmailProvider } from './mock.provider'

describe('MockEmailProvider', () => {
  let provider: MockEmailProvider

  beforeEach(() => {
    provider = new MockEmailProvider()
  })

  it('should be defined', () => {
    expect(provider).toBeDefined()
  })

  describe('send', () => {
    it('should return successful result', async () => {
      const result = await provider.send({
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<p>Test</p>',
      })

      expect(result.success).toBe(true)
      expect(result.id).toMatch(/^mock-/)
    })

    it('should include timestamp in generated ID', async () => {
      const result1 = await provider.send({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      })

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10))

      const result2 = await provider.send({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      })

      expect(result1.id).not.toBe(result2.id)
    })

    it('should handle all email parameters', async () => {
      const result = await provider.send({
        to: 'test@example.com',
        from: 'sender@example.com',
        replyTo: 'reply@example.com',
        subject: 'Test',
        html: '<strong>HTML</strong>',
        text: 'Text version',
      })

      expect(result.success).toBe(true)
    })
  })
})
