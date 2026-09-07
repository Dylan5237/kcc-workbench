import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// CloudCLI server writes this marker on listen (dist-server/server/index.js);
// the upstream Electron shell uses the same marker + /health probe to attach
// to an already-running local server. We mirror that upstream seam.
export const CLOUDCLI_MARKER_PATH = path.join(os.homedir(), '.cloudcli', 'local-server.json')

// Positive identification of a CloudCLI server, matching upstream
// electron/localServer.js isCloudCliServer(): GET /health -> { status: 'ok', installMode, version }
export function isCloudCliHealth(payload) {
  return !!payload
    && typeof payload === 'object'
    && payload.status === 'ok'
    && typeof payload.installMode === 'string'
    && typeof payload.version === 'string'
}

export function markerToUrl(marker, expectedHost = '127.0.0.1') {
  if (!marker || typeof marker !== 'object') return null
  const port = Number(marker.port)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  // marker.url uses "localhost"; KCC always loads 127.0.0.1, and browser
  // storage is origin-scoped, so normalize to the exact host KCC will use.
  const host = typeof marker.host === 'string' && marker.host === 'localhost' ? expectedHost : marker.host
  if (host !== expectedHost) return null
  return `http://${expectedHost}:${port}/`
}

export async function readMarkerUrl(markerPath = CLOUDCLI_MARKER_PATH) {
  try {
    return markerToUrl(JSON.parse(await readFile(markerPath, 'utf8')))
  } catch {
    return null
  }
}

// Decide whether to attach to an already-running CloudCLI server or spawn a
// new one. All environment touchpoints are injected so tests stay deterministic.
//
// Why attach matters: CloudCLI's Web UI login token lives in localStorage,
// which is scoped to the http://host:port origin. Spawning a new server on a
// drifted port changes the origin and forces a fresh login, while attaching
// to the live server (e.g. an orphan from a crashed KCC) keeps the origin —
// and the legitimate authenticated session — intact.
export async function resolveCloudCliEndpoint({
  preferredPort,
  host = '127.0.0.1',
  markerUrl = null,
  maxScanOffset = 99,
  isPortAvailable,
  probeCloudCliUrl,
  onLog = () => {}
}) {
  const probed = new Set()
  const probe = async url => {
    if (probed.has(url)) return false
    probed.add(url)
    return probeCloudCliUrl(url)
  }

  // 1. Attach candidates first (upstream parity: marker URL, then preferred port).
  const candidates = []
  if (markerUrl) candidates.push(markerUrl)
  candidates.push(`http://${host}:${preferredPort}/`)
  for (const url of candidates) {
    if (await probe(url)) {
      onLog(`reusing running CloudCLI server at ${url}`)
      return { action: 'attach', url, port: Number(new URL(url).port) }
    }
  }

  // 2. Spawn on the preferred port when it is free.
  if (await isPortAvailable(preferredPort)) return { action: 'spawn', port: preferredPort }

  // 3. Scan upward: attach to CloudCLI occupants, spawn on the first free port.
  //    A port that is merely open is never trusted without the /health probe.
  for (let offset = 1; offset <= maxScanOffset; offset += 1) {
    const port = preferredPort + offset
    if (await isPortAvailable(port)) {
      onLog(`port ${preferredPort} busy, using ${port}`)
      return { action: 'spawn', port }
    }
    if (await probe(`http://${host}:${port}/`)) {
      onLog(`reusing running CloudCLI server at http://${host}:${port}/`)
      return { action: 'attach', url: `http://${host}:${port}/`, port }
    }
  }
  return null
}
