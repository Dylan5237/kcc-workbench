// D0-03 outer probe: drives the real Arckeep.exe through its test hooks and
// verifies process-ownership shutdown semantics from OUTSIDE the process.
//
// Scenarios:
//   switch      ARCKEEP_TEST_SWITCH=1  — full Project→Kimi→Claude→DSH→Viewer→…→Project
//               sequence, persistence markers, real Claude session (V1/V2/V3/V4);
//               after exit, owned PIDs must be gone, attached instances alive (V8).
//   fail-claude ARCKEEP_TEST_FAIL=claude with bogus CDESKTOP_BIN / port file (V7).
//   fail-dsh    ARCKEEP_TEST_FAIL=dsh with a fake `dsh` shim first in PATH (V7).
//
// Usage: node spike/shell-switch/probe-d0-03.mjs [switch|fail-claude|fail-dsh|all]
// Output: spike/results/d0-03-<scenario>.json
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const EXE = path.join(REPO, 'arckeep', 'shell', 'bin', 'Release', 'net7.0-windows', 'Arckeep.exe');
const RESULTS = path.join(REPO, 'spike', 'results');
const stamp = () => new Date().toISOString().slice(11, 19);

function pidAlive(pid) {
  if (!pid) return false;
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' });
    return out.includes(`"${pid}"`);
  } catch { return false; }
}

async function httpOk(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}

function makeFixtureProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd0-03-proj-'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# d0-03 probe project\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'hello.py'), 'print("hi")\n');
  return dir;
}

function runArckeep(env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(EXE, [], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const killer = setTimeout(() => {
      try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch {}
      resolve({ exitCode: -1, timedOut: true, out, err });
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(killer);
      resolve({ exitCode: code ?? -1, timedOut: false, out, err });
    });
  });
}

function readProof(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// V8: after Arckeep exits, owned processes must be gone; attached must be alive.
async function verifyShutdown(matrix) {
  const r = { checks: [] };
  const owned = [
    ['kimi', matrix?.kimi?.ownedPid],
    ['claude', matrix?.claude?.ownedPid],
    ['dsh', matrix?.dsh?.ownedPid],
    ['viewer', matrix?.viewer?.ownedPid],
  ];
  for (const [name, pid] of owned) {
    if (!pid) continue;
    const alive = pidAlive(pid);
    r.checks.push({ surface: name, pid, ownedGone: !alive });
    if (alive) r.ok = false;
  }
  if (matrix?.claude?.mode === 'Attached' && matrix.claude.url) {
    const alive = await httpOk(matrix.claude.url + 'api/health');
    r.checks.push({ surface: 'claude-attached', url: matrix.claude.url, attachedAlive: alive });
    if (!alive) r.ok = false;
  }
  if (matrix?.dsh?.mode === 'Attached' && matrix.dsh.url) {
    const alive = await httpOk(matrix.dsh.url);
    r.checks.push({ surface: 'dsh-attached', url: matrix.dsh.url, attachedAlive: alive });
    if (!alive) r.ok = false;
  }
  if (r.ok === undefined) r.ok = r.checks.every((c) => c.ownedGone !== false && c.attachedAlive !== false);
  return r;
}

async function runScenario(name, extraEnv, timeoutMin, opts = {}) {
  const project = makeFixtureProject();
  const outFile = path.join(os.tmpdir(), `d0-03-${name}-proof.json`);
  try { fs.rmSync(outFile, { force: true }); } catch {}
  console.log(`[${stamp()}] scenario=${name} project=${project}`);
  const env = {
    ARCKEEP_TEST_PROJECT: project,
    ARCKEEP_TEST_OUT: outFile,
    ...extraEnv,
  };
  const run = await runArckeep(env, timeoutMin * 60 * 1000);
  const proof = readProof(outFile);
  const result = { scenario: name, project, exitCode: run.exitCode, timedOut: run.timedOut, proof };
  if (proof?.matrix) {
    // 进程退出后稍等，再核对 ownership
    await new Promise((r) => setTimeout(r, 2500));
    result.shutdown = await verifyShutdown(proof.matrix);
  }
  if (opts.extra) result.extra = await opts.extra(proof, run);
  fs.mkdirSync(RESULTS, { recursive: true });
  const dest = path.join(RESULTS, `d0-03-${name}.json`);
  fs.writeFileSync(dest, JSON.stringify(result, null, 2));
  console.log(`[${stamp()}] scenario=${name} exit=${run.exitCode} timedOut=${run.timedOut} -> ${dest}`);
  return result;
}

// V8 attach case: pre-start REAL "user-owned" cdesktop + DSH, let Arckeep attach
// to both (port file / host.describe), then prove both survive Arckeep exit.
// Instances this probe pre-starts are cleaned up by the probe itself; a
// pre-existing 3080 DSH that we did NOT start is left untouched.
async function dshAttachable() {
  try {
    const r = await fetch('http://127.0.0.1:3080/api/host.describe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'probe', method: 'host.describe', payload: {} }),
      signal: AbortSignal.timeout(3000),
    });
    const j = await r.json();
    return j.type === 'server-response' && j.result?.ok === true;
  } catch { return false; }
}

async function startUserCdesktop() {
  const bin = process.env.CDESKTOP_BIN
    || path.join(os.homedir(), '.cdesktop', 'bin', 'v0.2.3-20260519022845', 'windows-x64', 'cdesktop.exe');
  const child = spawn(bin, [], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1' }, windowsHide: true,
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const m = out.match(/Main server on :(\d+)/);
    if (m) {
      const base = `http://127.0.0.1:${m[1]}`;
      if (await httpOk(base + '/api/health')) return { child, base };
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('user cdesktop failed to start');
}

async function startUserDsh() {
  // 3080 是 DshService 的唯一 attach 探测点。本机 9/3 起有一个挂起的用户旧实例
  // （接受 TCP 不应答，D0-02 已记录）：此时无法可判定地制造 attach 场景，
  // 返回 null 跳过（不 kill 用户进程；spike 级 attach 证据见 dsh-probe-attach.json）。
  if (await dshAttachable()) return { child: null, base: 'http://127.0.0.1:3080/', preExisting: true };
  return null;
}

function killTree(child) {
  if (child?.pid) try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch {}
}

async function main() {
  const which = process.argv[2] || 'all';
  const results = [];

  if (which === 'attach') {
    const userCdesktop = await startUserCdesktop();
    const userDsh = await startUserDsh();
    console.log(`[${stamp()}] user instances: cdesktop=${userCdesktop.base} dsh=${userDsh?.base ?? 'SKIP(3080 被挂起旧实例占用)'}`);
    try {
      const r = await runScenario('attach', { ARCKEEP_TEST_SWITCH: '1' }, 15);
      // Arckeep 已退出：用户实例必须仍然存活
      r.userSurvivors = {
        cdesktopAlive: await httpOk(userCdesktop.base + '/api/health'),
        claudeMode: r.proof?.matrix?.claude?.mode,
        dshMode: r.proof?.matrix?.dsh?.mode,
        dshAttachSkipped: userDsh === null,
      };
      if (userDsh) r.userSurvivors.dshAlive = await dshAttachable();
      r.ok = r.exitCode === 0 && r.userSurvivors.cdesktopAlive
        && r.userSurvivors.claudeMode === 'Attached'
        && (userDsh === null || (r.userSurvivors.dshAlive && r.userSurvivors.dshMode === 'Attached'));
      fs.writeFileSync(path.join(RESULTS, 'd0-03-attach.json'), JSON.stringify(r, null, 2));
      console.log(`[${stamp()}] scenario=attach ok=${r.ok} survivors=${JSON.stringify(r.userSurvivors)}`);
      results.push(r);
    } finally {
      killTree(userCdesktop.child);
      if (userDsh && !userDsh.preExisting) killTree(userDsh.child);
    }
    const ok = results.every((r) => r.ok !== false && r.exitCode === 0);
    console.log(`[${stamp()}] OVERALL ${ok ? 'PASS' : 'FAIL'}`);
    process.exit(ok ? 0 : 1);
  }

  if (which === 'switch' || which === 'all') {
    results.push(await runScenario('shell-switch', {
      ARCKEEP_TEST_SWITCH: '1',
    }, 15));
  }

  if (which === 'fail-claude' || which === 'all') {
    const bogus = path.join(os.tmpdir(), 'd0-03-no-such-cdesktop.exe');
    results.push(await runScenario('fail-claude', {
      ARCKEEP_TEST_FAIL: 'claude',
      CDESKTOP_BIN: bogus,
      ARCKEEP_CDESKTOP_PORT_FILE: path.join(os.tmpdir(), 'd0-03-no-such-port', 'cdesktop.port'),
    }, 10));
  }

  if (which === 'fail-dsh' || which === 'all') {
    // 假 dsh：真实启动、立即退出 —— 走 DshService 真实 owned 失败路径
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd0-03-fakedsh-'));
    fs.writeFileSync(path.join(shimDir, 'dsh.cmd'), '@echo off\r\nexit /b 1\r\n');
    results.push(await runScenario('fail-dsh', {
      ARCKEEP_TEST_FAIL: 'dsh',
      ARCKEEP_DSH_ATTACH_AUTHORITY: '127.0.0.1:9',
      PATH: shimDir + ';' + process.env.PATH,
    }, 10));
  }

  const ok = results.every((r) => r.exitCode === 0 && !r.timedOut && r.shutdown?.ok !== false);
  console.log(`[${stamp()}] OVERALL ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('probe error:', e); process.exit(2); });
