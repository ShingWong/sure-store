// Dependency-free contract helpers for the document-part evidence. The gate job
// installs nothing, so the client and browser tests read the committed demos and
// fixtures directly; only the generator imports sure-document/sure-ui.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..')
export const FIXTURES = join(ROOT, 'components', 'fixtures')
export const DEMOS = join(ROOT, 'components', 'demos')

export const PARTS = [
  'document-table',
  'document-totals',
  'document-keyvalue',
  'document-schedule',
  'document-graphic',
]

export const TABLE_PARTS = new Set([
  'document-table',
  'document-totals',
  'document-keyvalue',
  'document-schedule',
])

export function readContract(name) {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.golden.json`), 'utf8'))
}

export function readDemo(name) {
  return readFileSync(join(DEMOS, `${name}.html`), 'utf8')
}
