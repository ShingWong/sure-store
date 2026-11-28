// Phase D client evidence for the five sure-store document parts. The gate job
// installs nothing, so this reads the committed demos produced by
// `npm run demos:document-parts` and checks them against the committed contract.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PARTS, TABLE_PARTS, readContract, readDemo } from '../verification/document-parts.contract.mjs'

test('document part client render coverage', async (t) => {
  for (const name of PARTS) {
    await t.test(name, () => {
      const contract = readContract(name)
      const expect = contract.fixture.expect
      const html = readDemo(name)

      const sheets = (html.match(/class="sure-document__sheet"/g) ?? []).length
      assert.equal(sheets, expect.pages, `${name}: sheet count`)
      for (const text of expect.html_contains ?? []) {
        assert.ok(html.includes(text), `${name}: missing ${JSON.stringify(text)}`)
      }

      if (TABLE_PARTS.has(name)) {
        assert.match(html, /<table class="sure-table[^"]*"/, `${name}: sure-table`)
        assert.match(html, /<th class="sure-table__header">/, `${name}: header cells`)
        assert.match(html, /<td class="sure-table__cell">/, `${name}: body cells`)
        const expectedRows = expect.row_count ?? contract.replay?.row_count
        if (typeof expectedRows === 'number' && name !== 'document-totals') {
          // The first table is the data part; a totals table may follow it.
          const firstTable = html.split('<table').slice(1, 2)[0] ?? ''
          const bodyRows = (firstTable.match(/<tr>/g) ?? []).length - (firstTable.includes('<thead>') ? 1 : 0)
          assert.equal(bodyRows, expectedRows, `${name}: row count`)
        }
      }

      if (name === 'document-totals') {
        assert.match(html, /sure-table--total/, 'document-totals: declared total modifier')
      }

      if (name === 'document-graphic') {
        assert.match(html, /<svg[^>]+role="img"/, 'document-graphic: img role')
        assert.match(html, /aria-labelledby="[^"]+"/, 'document-graphic: accessible name wiring')
        assert.match(html, /<title[^>]*>Test illustration<\/title>/, 'document-graphic: title')
        assert.match(html, /<desc[^>]*>A synthetic mark\.<\/desc>/, 'document-graphic: description')
        assert.match(html, /sure-figure__plot/, 'document-graphic: figure plot')
        assert.match(html, /sure-document__graphic/, 'document-graphic: document graphic class')
      }
    })
  }
})
