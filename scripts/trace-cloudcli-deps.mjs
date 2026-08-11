// Static closure tracer for the CloudCLI runtime dependency graph.
//
// Walks ESM `import`/`export ... from`, dynamic `import()`, and CommonJS
// `require()` from the CloudCLI CLI entrypoint, resolving every external
// package through node_modules and recursing into it. Also folds in package.json
// `dependencies`/`optionalDependencies` for each reached package, so that
// platform binaries loaded only at runtime via createRequire/optionalDependencies
// (e.g. @anthropic-ai/claude-agent-sdk-win32-x64, @openai/codex-win32-x64,
// @vscode/ripgrep-win32-x64) are included in the whitelist.
//
// Used by test/cloud-cli-failure.test.js to keep the asarUnpack whitelist honest:
// the test asserts that every package reported here is present in the whitelist,
// so a missing runtime dependency fails the build instead of breaking CloudCLI
// at launch.
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

const root = path.resolve('node_modules');
const entry = path.join(root, '@cloudcli-ai/cloudcli/dist-server/server/modules/cli/cli.js');
const visited = new Set();
const externalPkgs = new Set();

// Node built-in modules (bare + node: prefix) are never unpacked from node_modules.
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map(m => 'node:' + m),
]);

const importRe = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

function pkgName(spec) {
  if (!spec) return null;
  if (spec.startsWith('node:')) return null;
  if (nodeBuiltins.has(spec)) return null;
  if (spec.startsWith('.')) return null;
  if (spec.startsWith('/')) return null;
  if (!/^[a-z@]/i.test(spec)) return null;
  if (spec.includes(' ') || spec.includes('$') || spec.includes('{')) return null;
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0];
}

function resolveFile(file) {
  try {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  } catch { /* ignore */ }
  for (const ext of ['.js', '.mjs', '.cjs', '.json']) {
    if (fs.existsSync(file + ext)) return file + ext;
  }
  for (const idx of ['index.js', 'index.mjs', 'index.cjs']) {
    const p = path.join(file, idx);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveRelative(spec, fromFile) {
  const base = path.resolve(path.dirname(fromFile), spec);
  return resolveFile(base);
}

function resolveImport(spec, fromFile) {
  if (spec.startsWith('node:') || spec.startsWith('.')) return null;
  let dir = path.dirname(fromFile);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', spec);
    const resolved = resolveFile(candidate);
    if (resolved) return resolved;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function pkgDir(pkg) {
  return path.join(root, pkg);
}

function pkgJsonExists(pkg) {
  return fs.existsSync(path.join(pkgDir(pkg), 'package.json'));
}

// Follow package.json dependencies for a package so that runtime-resolved
// (createRequire / optionalDependencies) platform binaries are captured.
function followPackageJsonDeps(pkg) {
  const pj = path.join(pkgDir(pkg), 'package.json');
  if (!fs.existsSync(pj)) return;
  let j;
  try { j = JSON.parse(fs.readFileSync(pj, 'utf8')); } catch { return; }
  const allDeps = [
    ...Object.keys(j.dependencies || {}),
    ...Object.keys(j.optionalDependencies || {}),
  ];
  for (const dep of allDeps) {
    const depPkg = pkgName(dep);
    if (!depPkg) continue;
    if (!pkgJsonExists(depPkg)) continue; // only include installed deps
    if (!externalPkgs.has(depPkg)) {
      externalPkgs.add(depPkg);
      followPackageJsonDeps(depPkg); // recurse for transitive platform deps
    }
  }
}

function trace(file) {
  const key = path.resolve(file);
  if (visited.has(key)) return;
  visited.add(key);
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch { return; }

  for (const re of [importRe, dynamicRe, requireRe]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const spec = m[1];
      const pkg = pkgName(spec);
      if (pkg) {
        if (!externalPkgs.has(pkg) && pkgJsonExists(pkg)) {
          externalPkgs.add(pkg);
          followPackageJsonDeps(pkg);
        }
        const resolved = resolveImport(spec, file);
        if (resolved) trace(resolved);
      } else if (spec && !spec.startsWith('node:') && spec.startsWith('.')) {
        const resolved = resolveRelative(spec, file);
        if (resolved) trace(resolved);
      }
    }
  }
}

trace(entry);

const pkgs = [...externalPkgs].sort();

if (process.argv[1] && process.argv[1].endsWith('trace-cloudcli-deps.mjs')) {
  console.log('CloudCLI runtime external packages (' + pkgs.length + '):');
  for (const p of pkgs) console.log('  ' + p);
  console.log('\nFiles traced: ' + visited.size);
}

export { pkgs as runtimePackages, visited as tracedFiles };
