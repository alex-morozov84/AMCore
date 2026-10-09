import { expect, test } from '@playwright/test'

import { expectNoAxeViolations, scanAccessibility } from '../shared/axe'
import { waitForVisualStability } from '../shared/visual-stability'

test('axe waits for finite ancestor and nested opacity transitions without stopping spinners', async ({
  page,
}) => {
  await page.setContent(`<html lang="en"><head><title>Motion fixture</title></head><body>
    <main><h1>Stable state</h1><button>Action</button><span aria-hidden="true">Loading</span></main>
    </body></html>`)
  await page.evaluate(() => {
    const button = document.querySelector('button')!
    button.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 350, fill: 'forwards' })
    document
      .querySelector('main')!
      .animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 450, fill: 'forwards' })
    document
      .querySelector('span')!
      .animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
        duration: 100,
        iterations: Infinity,
      })
  })
  await expectNoAxeViolations(page)
  expect(
    await page.locator('button').evaluate((element) => getComputedStyle(element).opacity)
  ).toBe('1')
  expect(
    await page.locator('span').evaluate((element) => element.getAnimations()[0].playState)
  ).toBe('running')
})

test('stable real contrast failures remain failures', async ({ page }) => {
  await page.setContent(`<html lang="en"><head><title>Contrast fixture</title></head><body>
    <main><h1>Stable state</h1><button>Action</button></main></body></html>`)
  await page.locator('button').evaluate((element) => {
    element.style.color = '#828282'
    element.style.background = '#fafafa'
    element.style.fontSize = '14px'
  })
  await expect(expectNoAxeViolations(page)).rejects.toThrow(/color-contrast/)
})

test('settling does not cancel or finish finite application animations', async ({ page }) => {
  await page.setContent('<main><button>Action</button></main>')
  await page.evaluate(() => {
    document
      .querySelector('button')!
      .animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 200, fill: 'forwards' })
  })
  await waitForVisualStability(page)
  expect(
    await page.locator('button').evaluate((element) => element.getAnimations()[0].playState)
  ).toBe('finished')
})

// A pending control can sit in a stable half-transparent state, so a scan that only waits for
// animations would measure it. A region that declares itself busy is not scanned until it is idle.
const busyFixture = `<html lang="en"><head><title>Busy fixture</title></head><body>
  <main aria-busy="true"><h1>Loading state</h1><button style="color:#828282;background:#fafafa;font-size:14px">Checking</button></main>
  </body></html>`

test('a scan waits for a busy region to finish loading', async ({ page }) => {
  await page.setContent(busyFixture)
  await page.evaluate(() => {
    setTimeout(() => {
      const main = document.querySelector('main')!
      main.setAttribute('aria-busy', 'false')
      main.querySelector('button')!.style.color = '#171717'
    }, 500)
  })
  await expectNoAxeViolations(page)
  expect(await page.locator('main').getAttribute('aria-busy')).toBe('false')
})

test('a busy state is scanned only when the test says it is the subject', async ({ page }) => {
  await page.setContent(busyFixture)
  const results = await scanAccessibility(page, { allowBusy: true, rules: ['color-contrast'] })
  expect(results.violations.map((violation) => violation.id)).toEqual(['color-contrast'])
  expect(await page.locator('main').getAttribute('aria-busy')).toBe('true')
})

test('a region that never finishes loading fails with an actionable message', async ({ page }) => {
  test.setTimeout(30_000)
  await page.setContent(busyFixture)
  await expect(expectNoAxeViolations(page)).rejects.toThrow(/still aria-busy[\s\S]*allowBusy/)
})
