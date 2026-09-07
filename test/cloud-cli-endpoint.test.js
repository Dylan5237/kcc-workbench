import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  isCloudCliHealth,
  markerToUrl,
  readMarkerUrl,
  resolveCloudCliEndpoint
} from '../src/main/cloud-cli-endpoint.js'

const HOST = '127.0.0.1'
const PREFERRED = 42100

function harness({ busyPorts = [], healthyPorts = [], markerUrl = null } = {}) {
  const calls = { availability: [], probes: [], logs: [] }
  const resolve = extra => resolveCloudCliEndpoint({
    preferredPort: PREFERRED,
    host: HOST,
    markerUrl,
    isPortAvailable: async port => {
      calls.availability.push(port)
      return !busyPorts.includes(port)
    },
    probeCloudCliUrl: async url => {
      calls.probes.push(url)
      return healthyPorts.includes(Number(new URL(url).port))
    },
    onLog: message => calls.logs.push(message),
    ...extra
  })
  return { resolve, calls }
}

test('spawns on the preferred port when nothing is running', async () => {
  const { resolve } = harness()
  const endpoint = await resolve()
  assert.deepEqual(endpoint, { action: 'spawn', port: PREFERRED })
})

test('attaches to the marker server when it positively identifies as CloudCLI', async () => {
  const { resolve } = harness({ markerUrl: `http://${HOST}:42105/`, healthyPorts: [42105] })
  const endpoint = await resolve()
  assert.deepEqual(endpoint, { action: 'attach', url: `http://${HOST}:42105/`, port: 42105 })
})

test('ignores a stale marker and spawns on the free preferred port', async () => {
  const { resolve } = harness({ markerUrl: `http://${HOST}:42105/` })
  const endpoint = await resolve()
  assert.deepEqual(endpoint, { action: 'spawn', port: PREFERRED })
})

test('attaches to an orphan CloudCLI holding the preferred port instead of drifting', async () => {
  const { resolve } = harness({ busyPorts: [PREFERRED], healthyPorts: [PREFERRED] })
  const endpoint = await resolve()
  assert.deepEqual(endpoint, { action: 'attach', url: `http://${HOST}:${PREFERRED}/`, port: PREFERRED })
})

test('never attaches to a non-CloudCLI occupant and drifts to the next free port', async () => {
  const { resolve, calls } = harness({ busyPorts: [PREFERRED], healthyPorts: [] })
  const endpoint = await resolve()
  assert.deepEqual(endpoint, { action: 'spawn', port: PREFERRED + 1 })
  assert.ok(calls.probes.includes(`http://${HOST}:${PREFERRED}/`), 'preferred port must be probed before drift')
  assert.ok(calls.logs.some(line => line.includes(String(PREFERRED + 1))))
})

test('attaches to a CloudCLI orphan found on a scanned port', async () => {
  const { resolve } = harness({ busyPorts: [PREFERRED, PREFERRED + 1], healthyPorts: [PREFERRED + 1] })
  const endpoint = await resolve()
  assert.deepEqual(endpoint, { action: 'attach', url: `http://${HOST}:${PREFERRED + 1}/`, port: PREFERRED + 1 })
})

test('returns null when every candidate port is busy with foreign listeners', async () => {
  const busyPorts = Array.from({ length: 100 }, (_, i) => PREFERRED + i)
  const { resolve } = harness({ busyPorts })
  assert.equal(await resolve(), null)
})

test('probes each candidate URL at most once', async () => {
  const { resolve, calls } = harness({ markerUrl: `http://${HOST}:${PREFERRED}/` })
  await resolve()
  assert.deepEqual(calls.probes, [...new Set(calls.probes)])
})

test('isCloudCliHealth accepts the upstream /health payload shape only', () => {
  assert.equal(isCloudCliHealth({ status: 'ok', installMode: 'npm', version: '1.37.1' }), true)
  assert.equal(isCloudCliHealth({ status: 'ok', installMode: 'npm' }), false)
  assert.equal(isCloudCliHealth({ status: 'ok' }), false)
  assert.equal(isCloudCliHealth({ status: 'error', installMode: 'npm', version: '1.37.1' }), false)
  assert.equal(isCloudCliHealth({}), false)
  assert.equal(isCloudCliHealth(null), false)
  assert.equal(isCloudCliHealth('ok'), false)
})

test('markerToUrl normalizes localhost to the KCC loopback host', () => {
  assert.equal(
    markerToUrl({ pid: 1, host: 'localhost', port: 42100, url: 'http://localhost:42100' }),
    `http://${HOST}:42100/`
  )
  assert.equal(markerToUrl({ host: HOST, port: 42101 }), `http://${HOST}:42101/`)
})

test('markerToUrl refuses non-loopback hosts and invalid ports', () => {
  assert.equal(markerToUrl({ host: '0.0.0.0', port: 42100 }), null)
  assert.equal(markerToUrl({ host: '192.168.1.5', port: 42100 }), null)
  assert.equal(markerToUrl({ host: HOST, port: 0 }), null)
  assert.equal(markerToUrl({ host: HOST, port: 70000 }), null)
  assert.equal(markerToUrl({ host: HOST, port: 'abc' }), null)
  assert.equal(markerToUrl(null), null)
  assert.equal(markerToUrl({}), null)
})

test('readMarkerUrl parses the marker file and tolerates missing or broken files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kcc-marker-'))
  try {
    const markerPath = path.join(dir, 'local-server.json')
    assert.equal(await readMarkerUrl(markerPath), null)
    await writeFile(markerPath, 'not json')
    assert.equal(await readMarkerUrl(markerPath), null)
    await writeFile(markerPath, JSON.stringify({ pid: 1, host: 'localhost', port: 42100, url: 'http://localhost:42100' }))
    assert.equal(await readMarkerUrl(markerPath), `http://${HOST}:42100/`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
