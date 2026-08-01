import assert from 'node:assert/strict'
import test from 'node:test'
import { createKimiCodeUrlGuard, isAllowedKimiCodeUrl } from '../src/main/url-trust.js'

const opts = { viewerPort: 54321, kimiUrl: 'http://127.0.0.1:5499/', demoMode: false }

test('trusts the viewer local server origin (regression: clipboard write was denied)', () => {
  assert.equal(
    isAllowedKimiCodeUrl('http://127.0.0.1:54321/?token=abc', opts),
    true
  )
})

test('trusts the Kimi Web local server origin', () => {
  assert.equal(isAllowedKimiCodeUrl('http://127.0.0.1:5499/some/path', opts), true)
})

test('rejects a different local port (only exact viewer/kimi origins trusted)', () => {
  assert.equal(isAllowedKimiCodeUrl('http://127.0.0.1:54322/', opts), false)
  assert.equal(isAllowedKimiCodeUrl('http://127.0.0.1:5499/', {
    viewerPort: 54321,
    kimiUrl: 'http://127.0.0.1:5500/',
    demoMode: false
  }), false)
})

test('rejects external URLs', () => {
  assert.equal(isAllowedKimiCodeUrl('https://evil.com/', opts), false)
  assert.equal(isAllowedKimiCodeUrl('http://127.0.0.1.evil.com/', opts), false)
})

test('app: protocol trusted only in demo mode', () => {
  assert.equal(isAllowedKimiCodeUrl('app://shell/demo.html', { ...opts, demoMode: true }), true)
  assert.equal(isAllowedKimiCodeUrl('app://shell/demo.html', opts), false)
})

test('returns false for malformed input', () => {
  assert.equal(isAllowedKimiCodeUrl('not a url', opts), false)
  assert.equal(isAllowedKimiCodeUrl('', opts), false)
})

test('guard reads the latest Kimi Web origin for every navigation', () => {
  let kimiUrl = 'http://127.0.0.1:5499/'
  const guard = createKimiCodeUrlGuard(() => ({ ...opts, kimiUrl }))
  assert.equal(guard('http://127.0.0.1:5499/session/one'), true)
  kimiUrl = 'http://127.0.0.1:5500/'
  assert.equal(guard('http://127.0.0.1:5499/session/one'), false)
  assert.equal(guard('http://127.0.0.1:5500/session/two'), true)
})
