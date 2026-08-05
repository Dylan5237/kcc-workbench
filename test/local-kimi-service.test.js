import test from 'node:test'
import assert from 'node:assert/strict'

import { buildKimiWebArgs } from '../src/main/local-kimi-args.js'

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
