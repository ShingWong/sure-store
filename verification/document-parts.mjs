// Reference renderer for the five sure-store document parts (Phase D).
//
// The parts are data contracts; sure-document owns the markup. This harness maps
// each committed fixture to a real sure-document layout, renders it, and writes a
// standalone demo. It is verification code, not a runtime dependency of any
// product — the same reason sure-document carries no Playwright.
//
//   node verification/document-parts.mjs --write-demos
//   node --experimental-strip-types test/document-parts.test.mjs
//
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compose } from '@shing.wong/sure-ui'
import { formatCurrency, renderDocument } from '@shing.wong/sure-document'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const FIXTURES = join(ROOT, 'components', 'fixtures')
const DEMOS = join(ROOT, 'components', 'demos')

export const PARTS = [
  'document-table',
  'document-totals',
  'document-keyvalue',
  'document-schedule',
  'document-graphic',
]

const money = (value) => formatCurrency(Number(value), '¤#,##0.00')

function contract(name) {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.golden.json`), 'utf8'))
}

function table(id, y, columns, rows, { height = 120, keepTogether = true, repeatHeader = true } = {}) {
  return {
    kind: 'table',
    id,
    x: 36,
    y,
    w: 540,
    h: height,
    columns,
    rows,
    keepTogether,
    repeatHeader,
  }
}

function totalsTable(id, y, rows) {
  return table(id, y, [{ label: 'Label', field: 'label' }, { label: 'Amount', field: 'amount' }], rows, {
    height: 80,
    repeatHeader: false,
  })
}

function layoutFor(elements) {
  return {
    mode: 'fixed',
    sheet: { size: 'letter', orientation: 'portrait' },
    bands: [{ id: 'body', height: 650, elements }],
  }
}

/** Map a fixture to the sure-document layout + data that renders the part. */
export function model(name, fixture = contract(name)) {
  const input = fixture.fixture?.input ?? {}
  switch (name) {
    case 'document-table': {
      const rows = (input.rows ?? []).map((row) => ({ ...row, amount: money(row.amount) }))
      const total = money(input.totals?.grand_total ?? 0)
      return {
        layout: layoutFor([
          table('document-table', 36, [
            { label: 'Line', field: 'line_number' },
            { label: 'Due', field: 'due_on' },
            { label: 'Amount', field: 'amount' },
            { label: 'Description', field: 'description' },
          ], rows),
          totalsTable('document-table-total', 180, [{ label: 'Grand total', amount: total }]),
        ]),
        postprocess: (html) => html,
      }
    }
    case 'document-totals': {
      const record = input.record ?? {}
      const rows = [
        { label: 'Subtotal', amount: money(record.subtotal) },
        { label: 'Tax', amount: money(record.tax) },
        { label: 'Grand total', amount: money(record.grand_total) },
      ]
      return {
        layout: layoutFor([totalsTable('document-totals', 36, rows)]),
        // The catalog declares a total modifier; sure-document renders the base
        // table, so the part adds its own declared modifier after rendering.
        postprocess: (html) => html.replace('class="sure-table sure-table--print"', 'class="sure-table sure-table--print sure-table--total"'),
      }
    }
    case 'document-keyvalue': {
      const rows = (input.record ?? []).map((entry) => ({ label: entry.label, value: entry.value }))
      return {
        layout: layoutFor([
          table('document-keyvalue', 36, [{ label: 'Label', field: 'label' }, { label: 'Value', field: 'value' }], rows),
        ]),
        postprocess: (html) => html,
      }
    }
    case 'document-schedule': {
      const rows = (input.rows ?? []).map((row) => ({
        installment: row.installment,
        due_on: row.due_on,
        amount: money(row.amount),
        late_fee: money(row.late_fee),
      }))
      const total = money(input.totals?.grand_total ?? 0)
      return {
        layout: layoutFor([
          table('document-schedule', 36, [
            { label: 'Installment', field: 'installment' },
            { label: 'Due', field: 'due_on' },
            { label: 'Amount', field: 'amount' },
            { label: 'Late fee', field: 'late_fee' },
          ], rows),
          totalsTable('document-schedule-total', 180, [{ label: 'Grand total', amount: total }]),
        ]),
        postprocess: (html) => html,
      }
    }
    case 'document-graphic': {
      const svg = typeof input.svg === 'string' ? input.svg : ''
      const title = /<title>([^<]+)<\/title>/.exec(svg)?.[1] ?? input.record?.alt ?? 'Document graphic'
      const desc = /<desc>([^<]+)<\/desc>/.exec(svg)?.[1] ?? 'A synthetic document mark.'
      return {
        layout: layoutFor([
          {
            kind: 'figure',
            id: 'document-graphic',
            x: 36,
            y: 36,
            w: 360,
            h: 240,
            title,
            desc,
            fallback: true,
            series: [],
          },
        ]),
        // The catalog's own class for a document graphic sits beside the figure
        // plot class sure-document emits.
        postprocess: (html) => html.replace('class="sure-figure__plot"', 'class="sure-document__graphic sure-figure__plot"'),
      }
    }
    default:
      throw new Error(`unknown document part: ${name}`)
  }
}

/** Render one part with sure-document. */
export function renderPart(name) {
  const fixture = contract(name)
  const { layout, postprocess } = model(name, fixture)
  const result = renderDocument({ layout })
  return {
    name,
    fixture,
    sheetCount: result.sheetCount,
    html: postprocess ? postprocess(result.html) : result.html,
  }
}

/** A standalone, themed demo page for one part. */
export function demoHtml(name) {
  const rendered = renderPart(name)
  const blocks = (rendered.fixture.sure_ui ?? []).filter((b) => b !== 'form')
  const theme = compose({ theme: 'nord', components: blocks })
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — sure-store document part</title>
<style>${theme}</style>
<style>body{margin:0;padding:2rem;background:#f4f4f4} .sure-document{margin:0 auto}</style>
</head>
<body>
${rendered.html}
</body>
</html>
`
}

/** Write every demo under components/demos/ (committed evidence). */
export function writeDemos(outDir = DEMOS) {
  mkdirSync(outDir, { recursive: true })
  for (const name of PARTS) writeFileSync(join(outDir, `${name}.html`), demoHtml(name))
  return PARTS.length
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--write-demos')) {
    console.log(`wrote ${writeDemos()} document-part demos`)
  } else {
    for (const name of PARTS) {
      const rendered = renderPart(name)
      console.log(`${name}: ${rendered.sheetCount} sheet(s), ${rendered.html.length} bytes`)
    }
  }
}
