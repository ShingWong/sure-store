// The Phase D coverage matrix is a gate artifact, not prose: its rows must
// match the catalogs and its status must follow the recorded evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const checker = join(ROOT, 'verification', 'coverage.mjs');

function run(args = []) {
  return spawnSync(process.execPath, [checker, ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('coverage matrix matches both catalogs and is internally consistent', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OK matrix is complete and consistent/);
});

test('every catalog entry has exactly one row', () => {
  const matrix = JSON.parse(readFileSync(join(ROOT, 'components', 'coverage.json'), 'utf8'));
  const ids = matrix.rows.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate rows');
  for (const required of ['form', 'data-table', 'markdown', 'session-list', 'document-table', 'document-graphic']) {
    assert.ok(ids.includes(required), `missing ${required}`);
  }
});

test('green rows require all four evidence kinds; gaps stay visible', () => {
  const matrix = JSON.parse(readFileSync(join(ROOT, 'components', 'coverage.json'), 'utf8'));
  for (const row of matrix.rows) {
    const complete = ['client', 'browser', 'a11y', 'demo'].every((key) => row[key].length > 0);
    assert.equal(row.status, complete ? 'green' : 'gap', row.id);
    for (const key of ['client', 'browser', 'a11y', 'demo']) {
      assert.ok(Array.isArray(row[key]), `${row.id}.${key} is not a list`);
    }
  }
  // Phase D is not satisfied today; --strict must refuse to claim otherwise.
  assert.ok(matrix.rows.some((row) => row.status === 'gap'), 'a gap was silently closed');
  assert.equal(run(['--strict']).status, 1, '--strict must fail while gaps remain');
});
