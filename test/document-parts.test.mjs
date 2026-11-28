// Phase D client evidence for the five sure-store document parts. The reference
// renderer maps each committed fixture to a real sure-document layout; these
// assertions are the client-render half of the coverage row.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PARTS, renderPart } from '../verification/document-parts.mjs'

const TABLE_PARTS = ['document-table', 'document-totals', 'document-keyvalue', 'document-schedule']

test('document part client render coverage', async (t) => {
  for (const name of PARTS) {
    await t.test(name, () => {
      const rendered = renderPart(name)
      const expect = rendered.fixture.fixture.expect

      assert.equal(rendered.sheetCount, expect.pages, `${name}: sheet count`)
      for (const text of expect.html_contains ?? []) {
        assert.ok(rendered.html.includes(text), `${name}: missing ${JSON.stringify(text)}`)
      }

      if (TABLE_PARTS.includes(name)) {
        assert.match(rendered.html, /<table class="sure-table[^"]*"/, `${name}: sure-table`)
        assert.match(rendered.html, /<th class="sure-table__header">/, `${name}: header cells`)
        assert.match(rendered.html, /<td class="sure-table__cell">/, `${name}: body cells`)
        const expectedRows = expect.row_count ?? rendered.fixture.replay?.row_count
        if (typeof expectedRows === 'number' && name !== 'document-totals') {
          // The first table is the data part; a totals table may follow it.
          const firstTable = rendered.html.split("<table").slice(1, 2)[0] ?? "";
          const bodyRows = (firstTable.match(/<tr>/g) ?? []).length - (firstTable.includes("<thead>") ? 1 : 0);
          assert.equal(bodyRows, expectedRows, `${name}: row count`)
        }
      }

      if (name === 'document-totals') {
        assert.match(rendered.html, /sure-table--total/, 'document-totals: declared total modifier')
      }

      if (name === 'document-graphic') {
        assert.match(rendered.html, /<svg[^>]+role="img"/, 'document-graphic: img role')
        assert.match(rendered.html, /aria-labelledby="[^"]+"/, 'document-graphic: accessible name wiring')
        assert.match(rendered.html, /<title[^>]*>Test illustration<\/title>/, 'document-graphic: title')
        assert.match(rendered.html, /<desc[^>]*>A synthetic mark\.<\/desc>/, 'document-graphic: description')
        assert.match(rendered.html, /sure-figure__plot/, 'document-graphic: figure plot')
        assert.match(rendered.html, /sure-document__graphic/, 'document-graphic: document graphic class')
      }
    })
  }
})
