import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('CloudCLI failures use a dedicated actionable error page', async () => {
  const [mainSource, errorPage, errorScript] = await Promise.all([
    readFile(new URL('src/main/main.js', root), 'utf8'),
    readFile(new URL('src/renderer/service-error-cloudcli.html', root), 'utf8'),
    readFile(new URL('src/renderer/service-error-cloudcli.js', root), 'utf8')
  ])

  assert.match(mainSource, /new URL\('app:\/\/shell\/service-error-cloudcli\.html'\)/)
  assert.match(mainSource, /searchParams\.set\('detail'/)
  assert.match(mainSource, /getURL\(\)\.startsWith\('app:\/\/shell\/service-'\)/)
  assert.match(errorPage, /CloudCLI 启动失败/)
  assert.match(errorPage, /Node\.js 22/)
  assert.match(errorPage, /process\.versions\.modules/)
  assert.match(errorPage, /cloudcli-web\.log/)
  assert.match(errorPage, /service-error-cloudcli\.js/)
  assert.match(errorScript, /textContent = detail/)
  assert.match(errorScript, /nodeFailurePattern\.test\(detail\)/)
  assert.doesNotMatch(errorPage, /Kimi Code Web 启动失败/)
})

test('asarUnpack does not blanket-unpack node_modules for the whole tree', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

  assert.ok(
    Array.isArray(packageJson.build.asarUnpack),
    'asarUnpack must be an explicit whitelist array, not a glob string'
  )
  assert.ok(
    packageJson.build.asarUnpack.length > 0,
    'asarUnpack must list at least the CloudCLI runtime packages'
  )
  assert.ok(
    !packageJson.build.asarUnpack.includes('node_modules/**'),
    'asarUnpack must not blanket-unpack node_modules/** - use the minimal CloudCLI runtime whitelist'
  )
  assert.ok(
    !packageJson.build.asarUnpack.some(g => g === 'node_modules' || g === 'node_modules/*'),
    'asarUnpack must not use a whole-node_modules glob'
  )
})

test('asarUnpack whitelist covers the CloudCLI runtime and its native/platform binaries', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const whitelist = packageJson.build.asarUnpack

  // Core: CloudCLI itself
  assert.ok(
    whitelist.includes('node_modules/@cloudcli-ai/cloudcli/**'),
    'CloudCLI package must be unpacked so system Node can resolve its server entry'
  )

  // Native modules that cannot live inside asar (system Node ABI mismatch)
  const nativeRequired = [
    'node_modules/better-sqlite3/**',
    'node_modules/bcrypt/**',
    'node_modules/node-pty/**'
  ]
  for (const glob of nativeRequired) {
    assert.ok(whitelist.includes(glob), `native runtime dep must be unpacked: ${glob}`)
  }

  // Platform binaries resolved at runtime via optionalDependencies/createRequire
  const platformBinaries = [
    'node_modules/@anthropic-ai/claude-agent-sdk/**',
    'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/**',
    'node_modules/@openai/codex/**',
    'node_modules/@openai/codex-sdk/**',
    'node_modules/@openai/codex-win32-x64/**',
    'node_modules/@vscode/ripgrep/**',
    'node_modules/@vscode/ripgrep-win32-x64/**'
  ]
  for (const glob of platformBinaries) {
    assert.ok(whitelist.includes(glob), `platform binary must be unpacked: ${glob}`)
  }

  // Previously missing runtime dependency (regression guard)
  assert.ok(
    whitelist.includes('node_modules/gray-matter/**'),
    'gray-matter must be unpacked (historical missing-dependency regression)'
  )
})

test('asarUnpack whitelist matches the traced CloudCLI runtime dependency closure', async () => {
  // Run the static closure tracer and assert that every package it discovers is
  // present in asarUnpack. This catches missing runtime dependencies that a
  // hand-maintained whitelist would miss.
 const tracerUrl = new URL('scripts/trace-cloudcli-deps.mjs', root)
  const tracer = await import(tracerUrl.href)
  const runtimePackages = tracer.runtimePackages

  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const whitelist = packageJson.build.asarUnpack

  for (const pkg of runtimePackages) {
    const expected = `node_modules/${pkg}/**`
    assert.ok(
      whitelist.includes(expected),
      `traced runtime package not in asarUnpack whitelist: ${pkg}`
    )
  }
})

test('asarUnpack whitelist excludes UI-only and frontend packages that run inside Electron', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const whitelist = packageJson.build.asarUnpack

  // These packages are bundled into the client dist/ or served by the Electron
  // Viewer server (which can read asar). Unpacking them wastes ~150+ MB and
  // thousands of files.
  const uiOnlyPackages = [
    'react', 'react-dom', 'mermaid', 'd3', 'lucide-react',
    'react-syntax-highlighter', '@codemirror', '@xterm', 'cytoscape', 'elkjs',
    'katex', '@mermaid-js', 'fuse.js', 'i18next', 'react-i18next',
    'react-router', 'react-router-dom', 'react-dropzone', 'react-error-boundary',
    'clsx', 'cmdk', 'tailwind-merge', 'class-variance-authority',
    '@tailwindcss', '@replit', '@uiw', 'marked', 'dompurify',
    'remark-gfm', 'remark-math', 'rehype-katex', 'rehype-raw', 'react-markdown'
  ]

  for (const pkg of uiOnlyPackages) {
    const glob = `node_modules/${pkg}/**`
    assert.ok(
      !whitelist.some(w => w === glob),
      `UI-only package must not be unpacked: ${pkg} (runs inside Electron which reads asar)`
    )
  }
})

test('Windows release builds a zip archive instead of a silent portable exe', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

  assert.deepEqual(packageJson.build.win.target, [
    {
      target: 'zip',
      arch: ['x64']
    }
  ])
  assert.equal(packageJson.build.win.artifactName, 'KCC-Workbench-${version}-${arch}.${ext}')
})

test('CloudCLI startup failures are persisted before cleanup', async () => {
  const serviceSource = await readFile(new URL('src/main/cloud-cli-service.js', root), 'utf8')

  assert.match(serviceSource, /CloudCLI start failed:/)
  assert.match(serviceSource, /await this\.writeLog/)
  assert.match(serviceSource, /await this\.stop\(\)/)
})
