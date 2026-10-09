import type { AbilityPermission } from '../../auth/casl/permission-normalization'

import { AccessOperationBudget } from './access-budget'
import { conditionKeys } from './access-rule-utils'
import { maskRules, type Scan } from './configured-scan'

const rule = (id: string, inverted = false, conditions: unknown = null): AbilityPermission => ({
  id,
  inverted,
  conditions,
  subject: 'Organization',
  action: 'update',
  fields: ['name'],
})
const scan = (allows: AbilityPermission[], denies: AbilityPermission[]): Scan => ({
  itemFields: ['name'],
  allows,
  denies,
  relevant: [...allows, ...denies],
})

describe('indexed masking of configured rules', () => {
  it('compares normalized dates by value, including nested arrays, and memoizes the rule', () => {
    const budget = new AccessOperationBudget()
    const key = conditionKeys(budget)
    const condition = (time: number) => ({ createdAt: { in: [new Date(time)] } })
    const allow = rule('a', false, condition(1000))
    const same = rule('same', true, condition(1000))
    const different = rule('different', true, condition(2000))
    expect(key(allow)).toBe(key(same))
    expect(key(allow)).not.toBe(key(different))
    expect(budget.spentIn('canonical')).toBe(3)
    expect(maskRules(scan([allow], [different]), key, budget).masked.size).toBe(0)
    expect(maskRules(scan([allow], [same]), key, budget).masked.has('a')).toBe(true)
    expect(budget.spentIn('canonical')).toBe(3)
  })

  it('indexes dense same-condition denies once instead of scanning every pair', () => {
    const budget = new AccessOperationBudget()
    const allows = Array.from({ length: 50 }, (_, i) => rule(`a${i}`))
    const denies = Array.from({ length: 50 }, (_, i) => rule(`d${i}`, true))
    const checks = denies.map((deny) => jest.spyOn(deny.fields, 'includes'))
    const result = maskRules(scan(allows, denies), conditionKeys(budget), budget)
    expect(result.masked.size).toBe(50)
    expect(result.maskers.size).toBe(50)
    expect(checks.reduce((sum, check) => sum + check.mock.calls.length, 0)).toBeLessThanOrEqual(100)
    expect(budget.spentIn('mask')).toBe(100)
    expect(budget.spentIn('canonical')).toBe(50)
    expect(budget.spent).toBe(150)
  })

  it('charges the mask scan before accessing rule fields', () => {
    const deny = rule('d', true)
    const check = jest.spyOn(deny.fields, 'includes')
    const budget = new AccessOperationBudget(0)
    expect(() => maskRules(scan([rule('a')], [deny]), conditionKeys(budget), budget)).toThrow(
      expect.objectContaining({ reason: 'operationBudget', category: 'mask' })
    )
    expect(check).not.toHaveBeenCalled()
  })

  it('combines field coverage and attributes only overlapping denies', () => {
    const allow = { ...rule('a'), fields: ['name', 'description'] }
    const name = rule('name', true)
    const description = { ...rule('description', true), fields: ['description'] }
    const unrelated = { ...rule('id', true), fields: ['id'] }
    const budget = new AccessOperationBudget()
    const result = maskRules(
      { ...scan([allow], [name, description, unrelated]), itemFields: ['name', 'description'] },
      conditionKeys(budget),
      budget
    )
    expect(result.globalBlock).toBe(true)
    expect(result.masked.has('a')).toBe(true)
    expect([...result.maskers].sort()).toEqual(['description', 'name'])
  })
})
