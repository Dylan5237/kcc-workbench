import test from 'node:test'
import assert from 'node:assert/strict'

import { buildKimiWebArgs } from '../src/main/local-kimi-args.js'
import {
  buildAuthenticatedKimiWebUrl,
  extractKimiWebToken,
  extractKimiWebUrl,
  parseKimiSessionId,
  redactUrlToken
} from '../src/main/local-kimi-runtime.js'

test('extracts the authenticated Web UI URL from new Kimi Code output', () => {
  const output = 'Local:    http://127.0.0.1:59427/#token=abc_123\n'
  assert.equal(extractKimiWebUrl(output), 'http://127.0.0.1:59427/#token=abc_123')
  assert.equal(extractKimiWebToken(extractKimiWebUrl(output)), 'abc_123')
})

test('does not persist the Kimi Web bearer token in logs', () => {
  const output = [
    'Local: http://127.0.0.1:59427/#token=secret-token',
    'Token: secret-token'
  ].join('\n') + '\n'
  assert.equal(redactUrlToken(output), [
    'Local: http://127.0.0.1:59427/#token=[redacted]',
    'Token: [redacted]'
  ].join('\n') + '\n')
})

test('keeps the Kimi Web origin stable while adding the server token to the fragment', () => {
  const url = buildAuthenticatedKimiWebUrl('http://127.0.0.1:59427/', 'secret-token')
  assert.equal(url, 'http://127.0.0.1:59427/#token=secret-token')
})

test('extracts a Kimi session id from the Web route', () => {
  assert.equal(parseKimiSessionId('http://127.0.0.1:59427/sessions/ses_abc-123'), 'ses_abc-123')
  assert.equal(parseKimiSessionId('http://127.0.0.1:59427/'), '')
  assert.equal(parseKimiSessionId('http://127.0.0.1:59427/sessions/ses_abc-123/extra'), '')
})

test('places the global yolo flag before the web subcommand', () => {
  assert.deepEqual(buildKimiWebArgs('yolo', 58627), [
    '--yolo',
    'web',
    '--host', '127.0.0.1',
    '--port', '58627',
    '--no-open'
  ])
})

test('does not add an unsupported global flag for other permission modes', () => {
  const expected = ['web', '--host', '127.0.0.1', '--port', '58627', '--no-open']
  assert.deepEqual(buildKimiWebArgs('manual', 58627), expected)
  assert.deepEqual(buildKimiWebArgs('auto', 58627), expected)
  assert.deepEqual(buildKimiWebArgs(undefined, 58627), expected)
})
