import { parseStructuralModel } from './path-algebra-ast-model.mjs'
import { e2eUiExpectationInventory } from './project-locale-e2e-ui-inventory.mjs'
import { E2E_UI_SURFACES } from './project-locale-e2e-ui-surfaces.mjs'

export function e2eUiResiduals(locale, contents) {
  const residuals = []
  for (const { path, namespaces, expectedReferences } of E2E_UI_SURFACES) {
    const content = contents.get(path)
    if (content === undefined) {
      residuals.push(`${path}:missing localized verification surface`)
      continue
    }
    const model = parseStructuralModel(path, content)
    const en = e2eUiExpectationInventory(model, namespaces, 'en').count
    const ru = e2eUiExpectationInventory(model, namespaces, 'ru').count
    const expectedEn = locale === 'en' ? expectedReferences : 0
    const expectedRu = locale === 'ru' ? expectedReferences : 0
    if (en !== expectedEn) residuals.push(`${path}:English UI expectations ${en} != ${expectedEn}`)
    if (ru !== expectedRu) residuals.push(`${path}:Russian UI expectations ${ru} != ${expectedRu}`)
  }
  return residuals
}
