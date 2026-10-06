import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
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
