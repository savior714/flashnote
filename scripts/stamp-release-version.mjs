#!/usr/bin/env node
//
// Stamps one release version across every build asset that reaches a user:
//
//   build/config.yml                     info.version (the product version)
//   build/darwin/Info.plist              CFBundleShortVersionString, CFBundleVersion
//   build/darwin/Info.dev.plist          same keys, for the development bundle
//   build/windows/info.json              the executable's file/product version
//   build/windows/wails.exe.manifest     the assembly version
//   build/windows/nsis/wails_tools.nsh   the installer's default product version
//
// The version is derived from the release tag, so every artifact of one release
// reports the same number. This script only rewrites those version fields; it
// never reformats the files around them.
//
// Usage: node scripts/stamp-release-version.mjs 1.2.3
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2]

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: node scripts/stamp-release-version.mjs <major>.<minor>.<patch>')
  process.exit(1)
}

const updated = []

function stamp(relativePath, transform) {
  const path = join(repoRoot, relativePath)
  const before = readFileSync(path, 'utf8')
  const after = transform(before)
  if (after === before) {
    return
  }
  writeFileSync(path, after)
  updated.push(relativePath)
}

// build/config.yml keeps its own copy of the product version inside the `info:` block.
stamp('build/config.yml', (text) => {
  const infoBlock = /(^info:\n(?:[ \t].*\n|\n)*?[ \t]+version:[ \t]*)("[^"]*")/m
  if (!infoBlock.test(text)) {
    throw new Error('build/config.yml: could not find info.version')
  }
  return text.replace(infoBlock, (_match, prefix) => `${prefix}"${version}"`)
})

// Info.plist files carry the version twice, under two different keys.
function stampPlist(text, relativePath) {
  let result = text
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
    const pattern = new RegExp(
      `(<key>${key}</key>\\s*\\n\\s*<string>)[^<]*(</string>)`,
    )
    if (!pattern.test(result)) {
      throw new Error(`${relativePath}: could not find ${key}`)
    }
    result = result.replace(pattern, `$1${version}$2`)
  }
  return result
}

stamp('build/darwin/Info.plist', (text) => stampPlist(text, 'build/darwin/Info.plist'))
stamp('build/darwin/Info.dev.plist', (text) =>
  stampPlist(text, 'build/darwin/Info.dev.plist'),
)

// Windows executable metadata. JSON.parse keeps this honest: a malformed asset
// fails the release instead of shipping an executable with a stale version.
stamp('build/windows/info.json', (text) => {
  const info = JSON.parse(text)
  info.fixed = info.fixed ?? {}
  info.fixed.file_version = version
  info.info = info.info ?? {}
  const entry = info.info['0000'] ?? (info.info['0000'] = {})
  entry.ProductVersion = version
  return `${JSON.stringify(info, null, '\t')}\n`
})

stamp('build/windows/wails.exe.manifest', (text) => {
  const identity = /(<assemblyIdentity[^>]*\sversion=")[^"]*(")/m
  if (!identity.test(text)) {
    throw new Error('build/windows/wails.exe.manifest: could not find assemblyIdentity version')
  }
  return text.replace(identity, `$1${version}$2`)
})

stamp('build/windows/nsis/wails_tools.nsh', (text) => {
  const define = /(!ifndef INFO_PRODUCTVERSION\n\s*!define INFO_PRODUCTVERSION ")[^"]*(")/m
  if (!define.test(text)) {
    throw new Error('build/windows/nsis/wails_tools.nsh: could not find INFO_PRODUCTVERSION')
  }
  return text.replace(define, `$1${version}$2`)
})

console.log(`stamped version ${version} into ${updated.length} build asset(s)`)
for (const path of updated) {
  console.log(`  ${path}`)
}
