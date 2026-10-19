// Tests for the repository security gate (scripts/security-check.mjs).
//
// A scanner that never fires is worse than none, so each `detects` case is a
// realistic leak shape; each `allows` case is a look-alike that must NOT fire —
// false positives train people to widen the patterns until the gate is useless.
//
// This file is itself excluded from the content scan (see TEST_FILE in the
// gate), which is why it can carry synthetic secrets at all.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  checkCommitIdentities,
  isApprovedIdentity,
  scanRepo,
  scanText,
} from '../scripts/security-check.mjs'

const detects = [
  ['Private key block', '-----BEGIN RSA PRIVATE KEY-----'],
  ['AWS access key id', 'const k = "AKIAIOSFODNN7EXAMPLE"'],
  ['GitHub token', `token: ghp_${'a'.repeat(36)}`],
  ['Slack token', 'slack = "xoxb-1234567890-abcdefghij"'],
  ['Google API key', `key = "AIza${'b'.repeat(35)}"`],
  ['OpenAI/Anthropic key', `key = "sk-${'c'.repeat(32)}"`],
  ['Stripe live key', `stripe = "sk_live_${'d'.repeat(24)}"`],
  [
    'JWT',
    'auth = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"',
  ],
  ['Credentials in URL', 'const db = "postgres://admin:hunter2@db.internal/app"'],
  ['Hardcoded password', 'const cfg = { password: "s3cretPass" }'],
  ['SSN', 'patient 123-45-6789'],
  ['Card number', 'card 4111 1111 1111 1111'],
  ['Email address', 'contact someone@realcorp.example.co'],
  ['Private IP address', 'host 10.20.30.40'],
  ['Environment-specific path', 'open("/Users/swong/private/notes.md")'],
  ['Environment-specific path', 'path /usr/local/devel/sure-store'],
]

for (const [label, line] of detects) {
  test(`security gate flags ${label}`, () => {
    const findings = scanText(line, 'impl/ts/example.ts')
    assert.ok(
      findings.some((f) => f.label === label),
      `expected ${label} in ${JSON.stringify(findings)}`,
    )
  })
}

const allows = [
  ['reserved example domain', 'write to alice@example.com'],
  ['reserved .test domain', 'seed foo@bar.test'],
  ['non-contact git address', 'repository git@github.com:ShingWong/sure-store.git'],
  ['the org identity', 'Copyright (c) 2026 Shing Wong <shing@positronic-ai.us>'],
  ['semver', 'version 0.1.0'],
  ['scoped package name', 'import x from "@shing.wong/sure-store"'],
  ['public IP', 'resolver 8.8.8.8'],
  ['an ordinary system path', 'see /usr/share/doc/sqlite3'],
  ['a URL without credentials', 'https://github.com/ShingWong/sure-store'],
  ['a 16-digit number that fails Luhn', 'trace id 1234 5678 9012 3456'],
]

for (const [why, line] of allows) {
  test(`security gate allows ${why}`, () => {
    assert.deepEqual(scanText(line, 'impl/ts/example.ts'), [], `should not flag: ${line}`)
  })
}

test('commit identities: the org identity is approved, a personal address is not', () => {
  assert.equal(isApprovedIdentity('shing@positronic-ai.us'), true)
  assert.equal(isApprovedIdentity('12345+user@users.noreply.github.com'), true)
  assert.equal(isApprovedIdentity('noreply@github.com'), true)
  // The address in the developer's local git config — must never reach history.
  assert.equal(isApprovedIdentity('swong@fcsllc.us'), false)
  assert.equal(isApprovedIdentity('someone@gmail.com'), false)
})

test('the real repository is clean', () => {
  assert.deepEqual(scanRepo(), [])
  assert.deepEqual(checkCommitIdentities(), [])
})
