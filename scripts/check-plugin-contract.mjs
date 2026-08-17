// check-plugin-contract.mjs — zero-dependency plugin contract self-check.
//
// Runs over every package under plugins/ and enforces the repo-wide plugin
// conventions so new plugins (by anyone) get a consistent, machine-checked
// shape before CI merges:
//
//   1. folder name == package.json `name`, and name matches dsh-*-plugin
//   2. package.json is valid JSON with a `dsh` declaration
//      (dsh.bundle.patch for host plugins, dsh.client.platform for client)
//   3. every referenced path exists: patch file, main, exports entries
//   4. README.md exists (authoritative install/config doc per package)
//   5. a test entry exists: package.json `scripts.test` OR scripts/test_*.py
//   6. host entry modules export the Cordis contract (name / inject / apply)
//      — checked statically (no imports, no dependencies)
//
// Usage: node scripts/check-plugin-contract.mjs
// Exit code is non-zero when any plugin fails.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PLUGINS_DIR = join(ROOT, 'plugins')

let failures = 0
let checks = 0

function fail(plugin, msg) {
  failures += 1
  console.log(`  [FAIL] ${plugin}: ${msg}`)
}

function check(plugin, cond, msg) {
  checks += 1
  if (!cond) fail(plugin, msg)
}

function entryExportsContract(source) {
  // static scan: export const name / inject / apply must be present
  const has = (re) => new RegExp(re, 'm').test(source)
  return has('export\\s+const\\s+name') && has('export\\s+const\\s+inject') &&
    (has('export\\s+const\\s+apply') || has('export\\s+function\\s+apply'))
}

const pluginDirs = readdirSync(PLUGINS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
  .map((d) => d.name)
  .sort()

if (pluginDirs.length === 0) {
  console.error('No plugin packages found under plugins/')
  process.exit(1)
}

console.log(`Checking ${pluginDirs.length} plugin package(s): ${pluginDirs.join(', ')}`)

for (const dir of pluginDirs) {
  const pkgPath = join(PLUGINS_DIR, dir, 'package.json')
  if (!existsSync(pkgPath)) {
    fail(dir, 'package.json missing')
    continue
  }
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (err) {
    fail(dir, `package.json is not valid JSON: ${err.message}`)
    continue
  }

  // 1. naming
  check(dir, pkg.name === dir, `folder name must equal package.json name (${pkg.name ?? 'missing'})`)
  check(dir, /^dsh-.+-plugin$/.test(pkg.name ?? ''), `name must match dsh-<domain>-plugin (got ${pkg.name})`)

  // 2. dsh declaration (host bundle patch XOR client platform)
  const isHost = Boolean(pkg.dsh?.bundle?.patch)
  const isClient = Boolean(pkg.dsh?.client?.platform)
  check(dir, isHost || isClient, 'must declare dsh.bundle.patch (host) or dsh.client.platform (client)')

  // 3. referenced paths exist
  if (isHost) {
    const patch = join(PLUGINS_DIR, dir, pkg.dsh.bundle.patch)
    check(dir, existsSync(patch), `dsh.bundle.patch not found: ${pkg.dsh.bundle.patch}`)
  }
  if (pkg.main) check(dir, existsSync(join(PLUGINS_DIR, dir, pkg.main)), `main not found: ${pkg.main}`)
  for (const [sub, target] of Object.entries(pkg.exports ?? {})) {
    if (typeof target === 'string') {
      check(dir, existsSync(join(PLUGINS_DIR, dir, target)), `exports[${sub}] not found: ${target}`)
    }
  }

  // 4. README
  check(dir, existsSync(join(PLUGINS_DIR, dir, 'README.md')), 'README.md missing (authoritative install/config doc)')

  // 5. test entry
  const hasNpmTest = Boolean(pkg.scripts?.test)
  const hasPyTest = readdirSync(join(PLUGINS_DIR, dir), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name === 'scripts')
    .some(() => readdirSync(join(PLUGINS_DIR, dir, 'scripts')).some((f) => /^test_.+\.py$/.test(f)))
  check(dir, hasNpmTest || hasPyTest, 'no test entry: add package.json "scripts.test" or scripts/test_*.py')

  // 6. host entry module exports the Cordis contract (static scan)
  if (isHost && pkg.main) {
    const entry = join(PLUGINS_DIR, dir, pkg.main)
    if (existsSync(entry) && statSync(entry).isFile()) {
      check(dir, entryExportsContract(readFileSync(entry, 'utf8')),
        `${pkg.main} must export name / inject / apply (Cordis plugin contract)`)
    }
  }
}

console.log(`\nContract check: ${checks} checks, ${failures} failure(s)`)
process.exit(failures > 0 ? 1 : 0)
