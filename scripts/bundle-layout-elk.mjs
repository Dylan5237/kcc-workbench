import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outdir = path.join(root, 'src', 'viewer', 'public', 'vendor')
await fs.mkdir(outdir, { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: ['node_modules/@mermaid-js/layout-elk/dist/mermaid-layout-elk.core.mjs'],
  bundle: true,
  format: 'esm',
  target: ['chrome120'],
  outfile: path.join(outdir, 'layout-elk.mjs'),
  sourcemap: false,
  logLevel: 'info'
})
console.log('bundled layout-elk')
