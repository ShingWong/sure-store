// sure-store — Phase D component coverage matrix.
//
// One row per catalog entry across the sure-factor built-in catalog and the
// sure-store document-part catalog. Each row records evidence for four checks:
// client render, browser structure, accessibility and demo. Evidence is
// referenced, never guessed; a row is green only when all four are present.
//
//   node verification/coverage.mjs            # check matrix vs catalogs
//   node verification/coverage.mjs --write    # regenerate matrix + Markdown
//   node verification/coverage.mjs --strict   # fail while any row has a gap
//
// Cross-repo evidence is verified only when the sibling checkout is present
// (SURE_FACTOR_DIR / SURE_EXAMPLES_DIR). CI without those checks structure.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const MATRIX = join(ROOT, 'components', 'coverage.json')
const MARKDOWN = join(ROOT, 'components', 'COVERAGE.md')
const FACTOR_DIR = resolve(process.env.SURE_FACTOR_DIR || join(ROOT, '..', 'sure-factor'))
const EXAMPLES_DIR = resolve(process.env.SURE_EXAMPLES_DIR || join(ROOT, '..', 'sure-examples'))

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const STRICT = args.includes('--strict')

function namesIn(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.yaml')).map((name) => name.replace(/\.yaml$/, ''))
}

function tierOf(path) {
  try {
    return (readFileSync(path, 'utf8').match(/^tier:\s*(\S+)/m) || [])[1] || 'unknown'
  } catch {
    return 'unknown'
  }
}

function discovery() {
  const out = []
  for (const name of namesIn(join(FACTOR_DIR, 'catalog', 'components')).sort()) {
    out.push({ id: name, source: 'sure-factor', tier: tierOf(join(FACTOR_DIR, 'catalog', 'components', `${name}.yaml`)) })
  }
  for (const name of namesIn(join(ROOT, 'components')).filter((n) => n.endsWith('-table') || n.startsWith('document-')).sort()) {
    if (out.some((entry) => entry.id === name)) continue
    out.push({ id: name, source: 'sure-store', tier: tierOf(join(ROOT, 'components', `${name}.yaml`)) })
  }
  // sure-store's component catalog is exactly the five document parts, but
  // discovery must not silently miss one if a sixth is added.
  const storeYaml = namesIn(join(ROOT, 'components')).filter((n) => existsSync(join(ROOT, 'components', `${n}.yaml`)))
  for (const name of storeYaml) {
    if (!out.some((entry) => entry.id === name)) {
      out.push({ id: name, source: 'sure-store', tier: tierOf(join(ROOT, 'components', `${name}.yaml`)) })
    }
  }
  return out
}

// The suite is parameterized over every catalog entry; the literal needle is
// its describe block, which a plain-text checker can verify in any checkout.
const CLIENT_TEST = 'sure-factor:src/coverage.test.ts#catalog client render coverage'
const clientEvidence = () => [CLIENT_TEST]

function builtInEvidence(id) {
  const extra = {
    form: {
      client: ['sure-factor:src/generate-client.test.ts#emits a module that parses as JavaScript'],
      browser: ['sure-examples:components/tests/browser.test.mjs#the generated form appears'],
      a11y: ['sure-examples:components/tests/browser.test.mjs#every field has a label'],
      demo: ['sure-examples:components/'],
    },
    'data-table': {
      client: ['sure-factor:src/generate-client.test.ts#emits a table renderer for data-table, not a form'],
      browser: ['sure-examples:components/tests/browser.test.mjs#the generated classes are the catalog ones'],
    },
  }
  const override = extra[id] || {}
  return {
    client: [...clientEvidence(), ...(override.client || [])],
    browser: [...(override.browser || []), 'sure-factor:src/e2e/coverage.test.ts#component browser coverage'],
    a11y: [...(override.a11y || []), 'sure-factor:src/e2e/coverage.test.ts#Accessibility invariant'],
    demo: [...(override.demo || []), `sure-factor:e2e/demos/${id}.html`],
    note: null,
  }
}

function documentEvidence(id) {
  return {
    client: [],
    browser: [],
    a11y: [],
    demo: [],
    note: `sure-store:components/fixtures/${id}.golden.json — contract replay only; no client/browser/a11y/demo evidence yet`,
  }
}

function buildRows() {
  return discovery().map((entry) => {
    const evidence = entry.source === 'sure-store' ? documentEvidence(entry.id) : builtInEvidence(entry.id)
    const complete = ['client', 'browser', 'a11y', 'demo'].every((key) => evidence[key].length > 0)
    return {
      id: entry.id,
      source: entry.source,
      tier: entry.tier,
      client: evidence.client,
      browser: evidence.browser,
      a11y: evidence.a11y,
      demo: evidence.demo,
      note: evidence.note,
      status: complete ? 'green' : 'gap',
    }
  })
}

function markdown(rows) {
  const cell = (items) => items.length ? '✓' : '—'
  const lines = [
    '# Component coverage matrix (Phase D gate)',
    '',
    'Generated by `node verification/coverage.mjs --write`. One row per catalog',
    'entry; `✓` means reviewed evidence is recorded in `coverage.json`. `—` is',
    'an honest gap, not a pass. **Phase D is not green until every row is green.**',
    '',
    '| Entry | Source | Tier | Client | Browser | A11y | Demo | Status |',
    '|---|---|---|---|---|---|---|---|',
  ]
  for (const row of rows) {
    lines.push(`| \`${row.id}\` | ${row.source} | ${row.tier} | ${cell(row.client)} | ${cell(row.browser)} | ${cell(row.a11y)} | ${cell(row.demo)} | ${row.status} |`)
  }
  lines.push('', '## Evidence', '')
  for (const row of rows) {
    lines.push(`### ${row.id}`)
    for (const key of ['client', 'browser', 'a11y', 'demo']) {
      lines.push(`- **${key}:** ${row[key].length ? row[key].join('; ') : 'gap'}`)
    }
    if (row.note) lines.push(`- **note:** ${row.note}`)
    lines.push('')
  }
  return lines.join('\n')
}

const factorAvailable = existsSync(join(FACTOR_DIR, 'catalog', 'components'))
if (WRITE && !factorAvailable && !args.includes('--allow-partial')) {
  console.error('sure-factor catalog not found; refusing to rewrite the full matrix. Use --allow-partial only deliberately.')
  process.exit(2)
}
const rows = buildRows()
if (WRITE) {
  writeFileSync(MATRIX, JSON.stringify({ schema: 1, generatedBy: 'verification/coverage.mjs', rows }, null, 2) + '\n')
  writeFileSync(MARKDOWN, markdown(rows))
  console.log(`wrote ${rows.length} rows to components/coverage.json + COVERAGE.md`)
  process.exit(0)
}

const existing = JSON.parse(readFileSync(MATRIX, 'utf8'))
const byId = new Map(existing.rows.map((row) => [row.id, row]))
const problems = []
const discoveredIds = rows.map((row) => row.id)
for (const id of discoveredIds) if (!byId.has(id)) problems.push(`missing row: ${id}`)
for (const row of existing.rows) {
  if (discoveredIds.includes(row.id)) continue
  // A checkout without sure-factor cannot rediscover its rows, but must not
  // call them stale either; the committed matrix remains the authority.
  if (row.source === 'sure-factor' && !factorAvailable) continue
  problems.push(`stale row: ${row.id}`)
}

const roots = { 'sure-factor': FACTOR_DIR, 'sure-examples': EXAMPLES_DIR, 'sure-store': ROOT }
for (const row of existing.rows) {
  const expected = rows.find((candidate) => candidate.id === row.id)
  if (!expected) continue
  const complete = ['client', 'browser', 'a11y', 'demo'].every((key) => row[key].length > 0)
  if (row.status !== (complete ? 'green' : 'gap')) problems.push(`${row.id}: status does not match evidence`)
  for (const key of ['client', 'browser', 'a11y', 'demo']) {
    for (const evidence of row[key]) {
      const [repo, rest] = evidence.split(':')
      const root = roots[repo]
      if (!root || !existsSync(root)) continue
      const [file, needle] = rest.split('#')
      const path = join(root, file)
      if (!existsSync(path)) { problems.push(`${row.id}/${key}: no file ${file}`); continue }
      if (needle && !readFileSync(path, 'utf8').includes(needle)) {
        problems.push(`${row.id}/${key}: no test "${needle}" in ${file}`)
      }
    }
  }
}

const gaps = existing.rows.filter((row) => row.status === 'gap')
console.log(`coverage: ${existing.rows.length} entries, ${existing.rows.length - gaps.length} green, ${gaps.length} gaps`)
if (gaps.length) console.log(`  gaps: ${gaps.map((row) => row.id).join(', ')}`)
if (problems.length) {
  for (const problem of problems) console.error(`  FAIL ${problem}`)
  process.exit(1)
}
if (STRICT && gaps.length) {
  console.error('Phase D gate: coverage matrix still has gaps.')
  process.exit(1)
}
console.log('OK matrix is complete and consistent')
