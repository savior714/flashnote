import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acceptanceIsolationDecision,
  isolatedHomeIsProven,
  normalizeAcceptancePath,
} from '../src/lib/acceptanceIsolation.ts'

test('normalizeAcceptancePath collapses separators and relative segments', () => {
  assert.equal(normalizeAcceptancePath('/tmp//flashnote///'), '/tmp/flashnote')
  assert.equal(normalizeAcceptancePath('/tmp/./flashnote/home'), '/tmp/flashnote/home')
  assert.equal(normalizeAcceptancePath('/tmp/flashnote/../flashnote/home'), '/tmp/flashnote/home')
  assert.equal(normalizeAcceptancePath('/'), '/')
  assert.equal(normalizeAcceptancePath(''), '')
})

test('isolatedHomeIsProven admits the isolated home and its descendants only', () => {
  assert.equal(
    isolatedHomeIsProven('/tmp/flashnote-accept-home/Library/Application Support/Flashnote', '/tmp/flashnote-accept-home'),
    true,
  )
  assert.equal(isolatedHomeIsProven('/tmp/flashnote-accept-home', '/tmp/flashnote-accept-home'), true)
  assert.equal(isolatedHomeIsProven('/tmp/flashnote-accept-home/', '/tmp/flashnote-accept-home'), true)
})

test('isolatedHomeIsProven rejects a sibling that only shares a prefix', () => {
  // The exact historical failure: an isolated root whose name is a prefix of the
  // real one must not be mistaken for containment.
  assert.equal(
    isolatedHomeIsProven('/tmp/flashnote-accept-home-real/Library/Application Support/Flashnote', '/tmp/flashnote-accept-home'),
    false,
  )
})

test('isolatedHomeIsProven rejects unrelated roots and missing values', () => {
  assert.equal(
    isolatedHomeIsProven('/Users/developer/Library/Application Support/Flashnote', '/tmp/flashnote-accept-home'),
    false,
  )
  // A sibling of the isolated home is not inside it, even though it shares the
  // real-data directory layout.
  assert.equal(
    isolatedHomeIsProven('/Users/developer/Library/Application Support/Flashnote', '/Users/developer'),
    true,
  )
  assert.equal(isolatedHomeIsProven('/tmp/flashnote-accept-home/Library', ''), false)
  assert.equal(isolatedHomeIsProven('', '/tmp/flashnote-accept-home'), false)
})

test('acceptanceIsolationDecision reports a greppable refusal reason for every unproven case', () => {
  const missing = acceptanceIsolationDecision('/tmp/home/Library/Application Support/Flashnote', '')
  assert.equal(missing.isolated, false)
  assert.match(missing.isolated ? '' : missing.reason, /reason=missing-isolated-home/)

  const outside = acceptanceIsolationDecision('/Users/developer/Library/Application Support/Flashnote', '/tmp/home')
  assert.equal(outside.isolated, false)
  assert.match(outside.isolated ? '' : outside.reason, /reason=data-dir-outside-isolated-home/)

  const proven = acceptanceIsolationDecision('/tmp/home/Library/Application Support/Flashnote', '/tmp/home')
  assert.deepEqual(proven, {
    isolated: true,
    dataDir: '/tmp/home/Library/Application Support/Flashnote',
    isolatedHome: '/tmp/home',
  })
})
