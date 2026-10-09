import type { AbilityPermission } from '../../auth/casl/permission-normalization'

import { coversAnyField } from './access-rule-utils'

/** A deny index supports field coverage and attribution without allow-by-deny scans. */
export class DenyIndex {
  readonly rules: AbilityPermission[] = []
  readonly fields = new Set<string>()
  readonly usedFields = new Set<string>()
  all = false
  usedAll = false

  add(rule: AbilityPermission): void {
    this.rules.push(rule)
    this.all ||= coversAnyField(rule)
    for (const field of rule.fields) this.fields.add(field)
  }

  covers(field: string): boolean {
    return this.all || this.fields.has(field)
  }

  use(fields: readonly string[] | null): void {
    if (fields === null) this.usedAll = true
    else for (const field of fields) if (this.covers(field)) this.usedFields.add(field)
  }

  /** Only denies overlapping a masked allow are decisive, not every indexed deny. */
  maskers(): string[] {
    return this.rules
      .filter((rule) =>
        coversAnyField(rule)
          ? this.usedAll || this.usedFields.size > 0
          : rule.fields.some((field) => this.usedFields.has(field))
      )
      .map((rule) => rule.id)
  }
}
