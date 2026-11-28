// Phase D browser + accessibility evidence for the five sure-store document
// parts. Env-gated so the plain `npm test` gate stays dependency-free; run with
//
//   SURE_STORE_BROWSER=1 node --test verification/document-parts.browser.test.mjs
//
// The page is the same standalone demo committed under components/demos/.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { PARTS, demoHtml, renderPart } from './document-parts.mjs'

const enabled = process.env.SURE_STORE_BROWSER === '1'
const EXECUTABLE = process.env.SURE_STORE_CHROME ?? process.env.SURE_MAIL_CHROME ?? '/usr/bin/google-chrome'
const TABLE_PARTS = new Set(['document-table', 'document-totals', 'document-keyvalue', 'document-schedule'])

test('document part browser coverage', { skip: !enabled, timeout: 120000 }, async (t) => {
  const browser = await chromium.launch({ executablePath: EXECUTABLE, headless: true, args: ['--no-sandbox'] })
  t.after(() => browser.close())
  const page = await browser.newPage()

  for (const name of PARTS) {
    await t.test(name, async () => {
      await page.setContent(demoHtml(name), { waitUntil: 'load' })

      // Every value the contract promises must reach the rendered page.
      const expect = renderPart(name).fixture.fixture.expect
      const text = await page.evaluate(() => document.body.textContent ?? '')
      for (const value of expect.html_contains ?? []) {
        assert.ok(text.includes(value), `${name}: rendered text is missing ${JSON.stringify(value)}`)
      }

      if (TABLE_PARTS.has(name)) {
        assert.ok((await page.locator('table.sure-table').count()) >= 1, `${name}: table renders`)
        assert.ok((await page.locator('table.sure-table th.sure-table__header').count()) >= 1, `${name}: header cells`)
        assert.ok((await page.locator('table.sure-table td.sure-table__cell').count()) >= 1, `${name}: body cells`)
        assert.match(String(await page.locator('table.sure-table').first().getAttribute('class')), /sure-table--print/, `${name}: print modifier`)
      }

      if (name === 'document-totals') {
        assert.match(String(await page.locator('table.sure-table').first().getAttribute('class')), /sure-table--total/, 'document-totals: total modifier')
      }

      if (name === 'document-graphic') {
        const svg = page.locator('svg[role="img"]')
        assert.equal(await svg.count(), 1, 'document-graphic: one img-role svg')
        assert.equal(await page.locator('svg title').count(), 1, 'document-graphic: title')
        assert.equal(await page.locator('svg desc').count(), 1, 'document-graphic: description')
        const labelled = await svg.getAttribute('aria-labelledby')
        assert.ok(labelled, 'document-graphic: aria-labelledby')
        for (const id of labelled.split(/\s+/)) {
          assert.equal(await page.locator(`#${id}`).count(), 1, `document-graphic: #${id} resolves`)
        }
      }
    })
  }

  // Accessibility invariants across the whole set.
  await t.test('Accessibility invariant', async () => {
    for (const name of PARTS) {
      await page.setContent(demoHtml(name), { waitUntil: 'load' })
      const tablesWithoutHead = await page.evaluate(
        () => [...document.querySelectorAll('table')].filter((table) => table.querySelectorAll('th').length === 0).length,
      )
      assert.equal(tablesWithoutHead, 0, `${name}: every table has a header`)
      const namelessImages = await page.evaluate(
        () =>
          [...document.querySelectorAll('svg[role="img"]')].filter(
            (svg) => !svg.getAttribute('aria-labelledby') && !svg.getAttribute('aria-label'),
          ).length,
      )
      assert.equal(namelessImages, 0, `${name}: every image has an accessible name`)
    }
  })

  // The composed sure-ui CSS is present, so this is a styled component, not bare markup.
  await t.test('sure-ui component CSS present', async () => {
    for (const name of PARTS) {
      await page.setContent(demoHtml(name), { waitUntil: 'load' })
      const styled = await page.evaluate(() =>
        [...document.styleSheets].some((sheet) => {
          try {
            return [...sheet.cssRules].some(
              (rule) => rule.cssText?.includes('.sure-table') || rule.cssText?.includes('.sure-figure'),
            )
          } catch {
            return false
          }
        }),
      )
      assert.equal(styled, true, `${name}: sure-ui component CSS present`)
    }
  })
})
