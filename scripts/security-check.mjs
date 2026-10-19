/**
 * Repository security gate — sure-store.
 *
 * This repository is MIT and intended to be public, so **every tracked file is
 * published**. Unlike a repo with a private `plan/` directory, there is no
 * internal tier: a leak in a spec note is as public as a leak in code. That
 * makes the rules simpler and stricter than the sure-mail gate this is modelled
 * on.
 *
 * Two things are checked:
 *
 *   1. **content** — key material, credentials, PII, private IPs, and
 *      environment-specific absolute paths, in every tracked file;
 *   2. **history** — commit author and committer identities, because an email
 *      address in commit metadata is published with the repository and cannot
 *      be removed by editing a file.
 *
 * Dependency-free on purpose: it must run under plain `node` on a fresh clone,
 * in CI and before publish, with nothing to install.
 *
 * Usage: `node scripts/security-check.mjs`
 *
 * Allow-list etiquette: patterns are never loosened to make the check pass. Add
 * an entry keyed by file + label + exact text, with a reason, when a hit is a
 * deliberate placeholder.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = join(import.meta.dirname, '..')

/** Scan text-ish files only; binaries cannot carry a readable secret. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.wasm', '.zip', '.gz', '.tgz', '.pdf', '.mp4', '.webm', '.mp3',
])
const MAX_BYTES = 1024 * 1024

/**
 * Test files carry synthetic fixtures (fake tokens, passwords) by design — that
 * is how the gate proves it fires. They stay covered by the filename rules, but
 * are skipped for content patterns so the gate's own tests do not trip it.
 */
const TEST_FILE = /(?:^|\/)test\/|\.(?:test|spec)\.\w+$/

const PATTERNS = [
  { label: 'Private key block', regex: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/ },
  { label: 'AWS access key id', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: 'GitHub token', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/ },
  { label: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: 'OpenAI/Anthropic key', regex: /\b(?:sk-ant-|sk-)[A-Za-z0-9_-]{24,}\b/ },
  { label: 'Stripe live key', regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{24,}\b/ },
  { label: 'JWT', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { label: 'Credentials in URL', regex: /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/i },
  { label: 'Hardcoded password', regex: /password\s*[:=]\s*['"][^'"]{3,}['"]/i },
  { label: 'SSN', regex: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/ },
  { label: 'Email address', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { label: 'Private IP address', regex: /\b(?:192\.168|10)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/ },
  { label: 'Environment-specific path', regex: /(?:\/Users\/|\/home\/[a-z0-9._-]+\/|\/usr\/local\/devel\/|C:\\Users\\)/i },
]
for (const p of PATTERNS) p.global = new RegExp(p.regex.source, p.regex.flags + 'g')

/** Addresses that cannot belong to a real person (RFC 2606 / dev-only). */
const SAFE_EMAIL_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'example', 'test', 'localhost', 'invalid',
])
/** Non-contact addresses that look like emails. */
const SAFE_EMAIL_LITERALS = new Set([
  'git@github.com', 'npm@npmjs.com', 'noreply@github.com', 'support@npmjs.com',
])
/**
 * The maintainer's published org identity. Deliberately narrow and explicit:
 * a personal address on any other domain is still flagged, including the one
 * that lives in the local git config.
 */
const ORG_EMAIL_DOMAIN = 'positronic-ai.us'

/**
 * Explicit allow-list: known-benign matches. Every entry MUST carry a reason.
 * Keyed by file + label + exact text so a line edit cannot silently widen it.
 */
const ALLOW = []

/** Luhn check — a 13–19 digit run is only reported if it is a valid card number. */
function luhnValid(digits) {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

/** Show enough to locate a leak without printing the secret itself. */
function redact(match) {
  if (match.length <= 8) return `${match.slice(0, 2)}…`
  return `${match.slice(0, 4)}…${match.slice(-2)} (${match.length} chars)`
}

function isSafeEmail(match) {
  const lower = match.toLowerCase()
  if (SAFE_EMAIL_LITERALS.has(lower)) return true
  const at = lower.lastIndexOf('@')
  const domain = lower.slice(at + 1)
  if (SAFE_EMAIL_DOMAINS.has(domain)) return true
  if (domain.endsWith('.example') || domain.endsWith('.test')) return true
  return domain === ORG_EMAIL_DOMAIN
}

/**
 * Scan one text blob. Pure — this is what the unit tests exercise.
 * @returns {Array<{file: string, line: number, label: string, hint: string}>}
 */
export function scanText(text, file = '<memory>') {
  const findings = []
  const lines = text.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const pattern of PATTERNS) {
      const seen = new Set()
      for (const m of line.matchAll(pattern.global)) {
        const match = m[0]
        if (seen.has(match)) continue
        seen.add(match)
        if (pattern.label === 'Email address' && isSafeEmail(match)) continue
        const allowed = ALLOW.some(
          (a) => a.file === file && a.label === pattern.label && match.includes(a.match),
        )
        if (allowed) continue
        findings.push({ file, line: i + 1, label: pattern.label, hint: redact(match) })
      }
    }

    // Card numbers: regex-shaped, then Luhn-validated to avoid false positives.
    for (const m of line.matchAll(/\b(?:\d[ -]?){12,18}\d\b/g)) {
      const digits = m[0].replace(/\D/g, '')
      if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) continue
      findings.push({ file, line: i + 1, label: 'Card number', hint: redact(m[0]) })
    }
  }
  return findings
}

/** Tracked files (git), or null when git is unavailable (a published tarball). */
function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' })
    return out.split('\0').filter(Boolean)
  } catch {
    return null
  }
}

function scanPath(rel, findings) {
  const full = join(ROOT, rel)
  const ext = extname(full).toLowerCase()
  if (BINARY_EXTENSIONS.has(ext)) return
  if (TEST_FILE.test(rel)) return // synthetic fixtures — see TEST_FILE above
  let stat
  try {
    stat = statSync(full)
  } catch {
    return
  }
  if (!stat.isFile() || stat.size > MAX_BYTES) return
  let text
  try {
    text = readFileSync(full, 'utf-8')
  } catch {
    return
  }
  if (text.includes('\0')) return // binary content with a text extension
  findings.push(...scanText(text, rel.split('\\').join('/')))
}

/**
 * Whether a commit identity's address is acceptable for a public repository.
 * Exported so the gate's own tests can prove it rejects the address that lives
 * in the developer's local git config.
 */
export function isApprovedIdentity(email) {
  const d = String(email).toLowerCase().split('@').pop() ?? ''
  return (
    d === ORG_EMAIL_DOMAIN ||
    d === 'users.noreply.github.com' ||
    d === 'github.com' ||
    SAFE_EMAIL_DOMAINS.has(d)
  )
}

/**
 * Commit author and committer identities. These are published with the repo and
 * cannot be fixed by editing a file, so a personal address here is a permanent
 * leak. Checked across the whole history, which for this repo is small.
 *
 * @returns {Array<{file: string, line: number, label: string, hint: string}>}
 */
export function checkCommitIdentities() {
  let out
  try {
    out = execFileSync('git', ['log', '--format=%H%x09%ae%x09%ce'], {
      cwd: ROOT,
      encoding: 'utf-8',
    })
  } catch {
    return [] // no git history to inspect
  }
  const findings = []
  const seen = new Set()
  for (const line of out.split('\n').filter(Boolean)) {
    const [sha, author, committer] = line.split('\t')
    for (const [role, email] of [['author', author], ['committer', committer]]) {
      const key = `${role}:${email}`
      if (seen.has(key) || isApprovedIdentity(email)) continue
      seen.add(key)
      findings.push({
        file: '<git history>',
        line: 0,
        label: `Commit ${role} identity`,
        hint: `${redact(email)} in ${sha.slice(0, 7)} — use an approved identity`,
      })
    }
  }
  return findings
}

/**
 * Scan the repository (tracked files + the files npm always ships).
 * @returns {Array<{file: string, line: number, label: string, hint: string}>}
 */
export function scanRepo() {
  const files = trackedFiles()
  const findings = []
  const seen = new Set()

  if (files === null) {
    // No git (published tarball): scan the files that ship.
    for (const rel of ['README.md', 'LICENSE', 'package.json']) {
      if (existsSync(join(ROOT, rel))) scanPath(rel, findings)
    }
    return findings
  }

  for (const rel of files) {
    const norm = rel.replace(/^\.\//, '')
    if (seen.has(norm)) continue
    seen.add(norm)
    if (!existsSync(join(ROOT, norm))) continue
    scanPath(norm, findings)
  }

  // A tracked .env or key file is always a finding, regardless of contents.
  for (const rel of seen) {
    const name = rel.split('/').pop() ?? ''
    if (/^\.env(\.|$)/.test(name) && !name.endsWith('.example')) {
      findings.push({ file: rel, line: 1, label: 'Committed environment file', hint: name })
    }
    if (
      /\.(pem|key|p12|pfx|jks|keystore)$/i.test(name) ||
      name === 'id_rsa' ||
      name === 'id_ed25519'
    ) {
      findings.push({ file: rel, line: 1, label: 'Key material file', hint: name })
    }
  }

  findings.push(...checkCommitIdentities())
  return findings
}

function main() {
  const findings = scanRepo()
  if (findings.length > 0) {
    console.error('\n❌ SECURITY CHECK FAILED — potential key/credential/PII leak:\n')
    for (const f of findings) {
      const where = f.line > 0 ? `${f.file}:${f.line}` : f.file
      console.error(`  ${where} — ${f.label} — ${f.hint}`)
    }
    console.error(
      '\nThis repository is public. Remove the value, or — for a deliberate\n' +
        'placeholder — add an ALLOW entry in scripts/security-check.mjs with\n' +
        'file + label + match + reason. A commit-identity finding means the\n' +
        'address is in the history: rewrite it before publishing.\n',
    )
    process.exit(1)
  }
  console.log('✅ Security check passed — no keys, credentials, PII, private IPs,')
  console.log('   environment paths, or unapproved commit identities found.\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
