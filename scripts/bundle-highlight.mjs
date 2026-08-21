import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outdir = path.join(root, 'src', 'viewer', 'public', 'vendor')
await fs.mkdir(outdir, { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: ['node_modules/highlight.js/lib/index.js'],
  bundle: true,
  format: 'iife',
  globalName: 'hljs',
  target: ['chrome120'],
  outfile: path.join(outdir, 'highlight.min.js'),
  sourcemap: false,
  logLevel: 'info'
})
console.log('bundled highlight.js')
