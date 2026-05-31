import { InvalidObjectKeyError, normalizeObjectKey } from './object-key'
import { MAX_OBJECT_KEY_LENGTH } from './storage.constants'

describe('normalizeObjectKey', () => {
  describe('accepts and returns safe keys', () => {
    it.each([
      ['file.txt', 'file.txt'],
      ['avatars/user-id/file.webp', 'avatars/user-id/file.webp'],
      ['a/b/c/d/e.bin', 'a/b/c/d/e.bin'],
      ['UPPER/Mixed_Case-123.PNG', 'UPPER/Mixed_Case-123.PNG'],
      ['name with spaces.txt', 'name with spaces.txt'],
      // A dot inside a segment is fine — only standalone `.`/`..` segments are rejected.
      ['.hidden', '.hidden'],
      ['avatars/.config/file.json', 'avatars/.config/file.json'],
    ])('keeps %p as %p', (input, expected) => {
      expect(normalizeObjectKey(input)).toBe(expected)
    })

    it('collapses duplicate slashes', () => {
      expect(normalizeObjectKey('a//b///c.txt')).toBe('a/b/c.txt')
    })

    it('trims surrounding whitespace', () => {
      expect(normalizeObjectKey('  avatars/x.png  ')).toBe('avatars/x.png')
    })

    it('accepts a key at the maximum length', () => {
      const key = 'a'.repeat(MAX_OBJECT_KEY_LENGTH)
      expect(normalizeObjectKey(key)).toBe(key)
    })
  })

  describe('rejects unsafe keys', () => {
    it.each([
      ['empty string', ''],
      ['whitespace only', '   '],
      ['leading slash', '/etc/passwd'],
      ['leading slash after collapse-safe trim', '  /leading'],
      ['backslash', 'a\\b.txt'],
      ['windows-style traversal', '..\\..\\secret'],
      ['parent traversal segment', 'a/../b.txt'],
      ['bare parent traversal', '..'],
      ['leading traversal', '../etc/passwd'],
      ['bare current-dir segment', '.'],
      ['current-dir segment', 'a/./b.txt'],
      ['trailing current-dir segment', 'a/.'],
      ['leading current-dir segment', './a.txt'],
      ['trailing slash', 'a/b/'],
      ['NUL byte', 'a\x00b'],
      ['control char', 'a\x01b'],
      ['DEL char', 'a\x7fb'],
    ])('rejects %s', (_label, input) => {
      expect(() => normalizeObjectKey(input)).toThrow(InvalidObjectKeyError)
    })

    it('rejects keys longer than the cap', () => {
      const tooLong = 'a'.repeat(MAX_OBJECT_KEY_LENGTH + 1)
      expect(() => normalizeObjectKey(tooLong)).toThrow(InvalidObjectKeyError)
    })

    it('counts length in UTF-8 bytes, not code units', () => {
      // Each '€' is 3 UTF-8 bytes; this is under the code-unit count but over
      // the byte cap.
      const multibyte = '€'.repeat(Math.ceil(MAX_OBJECT_KEY_LENGTH / 3) + 1)
      expect(multibyte.length).toBeLessThanOrEqual(MAX_OBJECT_KEY_LENGTH)
      expect(() => normalizeObjectKey(multibyte)).toThrow(InvalidObjectKeyError)
    })
  })
})
