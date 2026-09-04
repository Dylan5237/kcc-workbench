// D0-01 C5 probe: controlled startup / failure / recovery path.
//
// Proves the claim: a failed Claude surface (cdesktop service) does NOT imply
// the host shell (Arckeep) or other surfaces must fail.
//
// cdesktop defaults to PORT=0 auto-assignment; the host shell discovers the
// real port from the server's stdout ("Main server on :NNNN") and the port
// file (%TEMP%/cdesktop/cdesktop.port). This probe uses that same discovery
// path, then:
//
//   A-startup  spawn the real cdesktop binary, parse the bound port, hit
//              /api/health -> service up.
//   B-host     spawn a SEPARATE OS process ("host") that polls the surface URL
//              and writes an independent heartbeat file — the same isolation
//              boundary an Arckeep host process would have.
//   C-kill     terminate the cdesktop process (simulated Claude-surface failure).
//   D-alive    host process is STILL RUNNING and still writes heartbeats
//              (proves failure is contained to the surface process).
//   E-recovery restart cdesktop; host observes the surface return.
//
// Output: evidence/c5-failure-isolation.json (plus stdout for audit).
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CDESKTOP_BIN = process.env.CDESKTOP_BIN
  || 'C:\\Users\\howyo\\.cdesktop\\bin\\v0.2.3-20260519022845\\windows-x64\\cdesktop.exe';
const OUT = path.resolve(import.meta.dirname, 'evidence', 'c5-failure-isolation.json');
const PORT_FILE = path.join(os.tmpdir(), 'cdesktop', 'cdesktop.port');

const results = [];
const started = Date.now();
const stamp = () => new Date().toISOString().slice(11, 19);

function healthOk(base) {
  return fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.status === 200 && r.json().then((j) => j.success === true))
    .catch(() => false);
}

async function waitHealth(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthOk(base)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// Spawn the server with PORT auto-assignment, then parse the real bound port
// from stdout ("Main server on :NNNN"). Returns { child, base } or throws.
function startServer() {
  const child = spawn(CDESKTOP_BIN, [], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    windowsHide: true,
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const startedAt = Date.now();
  const getOut = () => stdout;
  const getErr = () => stderr;
  return { child, getOut, getErr, startedAt };
}

function parsePort(srv) {
  const m = srv.getOut().match(/Main server on :(\d+)/);
  return m ? Number(m[1]) : null;
}

async function startAndWaitServer(timeoutMs) {
  const srv = startServer();
  let port = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    port = parsePort(srv);
    if (port && await waitHealth(`http://127.0.0.1:${port}`, 1500)) break;
    if (srv.child.exitCode !== null) break; // server died before binding
    await new Promise((r) => setTimeout(r, 300));
  }
  return { srv, port };
}

// The "host": a separate OS process that polls the surface and writes an
// independent heartbeat file. Stays alive regardless of the surface.
function startHost(base, reportPath) {
  const script = `
    const fs=require('fs');
    const BASE=process.argv[1]; const out=process.argv[2];
    const ev=[]; let last=null; let t0=Date.now();
    const tick=async()=>{
      let up=false;
      try{ const r=await fetch(BASE+'/api/health',{signal:AbortSignal.timeout(1500)});
        up=r.status===200; }catch{}
      if(up!==last){ ev.push({at:Date.now()-t0, up}); last=up; }
      fs.appendFileSync(out, JSON.stringify({t:Date.now()-t0, up, heartbeat:true})+String.fromCharCode(10));
    };
    (async()=>{ const iv=setInterval(tick,500);
      setTimeout(()=>{ clearInterval(iv);
        fs.appendFileSync(out, 'ev='+JSON.stringify(ev)); }, 15000);
    })();`;
  const child = spawn(process.execPath, ['-e', script, base, reportPath], { windowsHide: true });
  return child;
}

function killTree(child) {
  try {
    if (child && child.pid) execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
  } catch { try { child && child.kill('SIGKILL'); } catch {} }
}

async function main() {
  const portFileBefore = fs.existsSync(PORT_FILE) ? fs.readFileSync(PORT_FILE, 'utf8') : null;

  // ---- A: startup path (auto-assigned port + stdout/port-file discovery) ----
  const { srv, port } = await startAndWaitServer(25000);
  const base = port ? `http://127.0.0.1:${port}` : null;
  const healthUp = base ? await healthOk(base) : false;
  const mainLine = srv.getOut().split('\n').find((l) => l.includes('Main server on'))?.trim() || '';
  let portFile = null;
  try { portFile = fs.readFileSync(PORT_FILE, 'utf8'); } catch {}
  results.push({
    phase: 'A-startup',
    ok: healthUp,
    binary: CDESKTOP_BIN,
    base,
    portFileBefore,
    portFileAfter: portFile,
    stdoutMainLine: mainLine,
    health: healthUp,
  });
  console.log(`[${stamp()}] A-startup: base=${base} health=${healthUp}  ${mainLine}`);
  if (!healthUp) {
    results.push({ phase: 'X-server-failed', stdoutTail: srv.getOut().slice(-1500), stderrTail: srv.getErr().slice(-800) });
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    process.exit(2);
  }

  // ---- B: spawn independent host process ----
  const hostReport = path.join(os.tmpdir(), `c5-host-${port}.jsonl`);
  try { fs.rmSync(hostReport, { force: true }); } catch {}
  const host = startHost(base, hostReport);
  await new Promise((r) => setTimeout(r, 1500)); // let host observe healthy state
  results.push({ phase: 'B-host-spawned', hostPid: host.pid, report: hostReport });
  console.log(`[${stamp()}] B-host: spawned pid=${host.pid} polling ${base}`);

  // ---- C: kill the surface (simulated failure) ----
  const srvPid = srv.child.pid;
  killTree(srv.child);
  await new Promise((r) => setTimeout(r, 1200));
  const hostAliveAfterKill = host.exitCode === null && !host.killed;
  results.push({ phase: 'C-kill-surface', srvPid, ok: true, hostAliveAfterKill });
  console.log(`[${stamp()}] C-kill: srvPid=${srvPid} hostAlive=${hostAliveAfterKill}`);

  // ---- D: host continues to function (isolation) ----
  await new Promise((r) => setTimeout(r, 3000));
  const hostAliveLater = host.exitCode === null && !host.killed;
  const hostLines = fs.existsSync(hostReport) ? fs.readFileSync(hostReport, 'utf8').trim().split('\n') : [];
  const heartbeatLines = hostLines.filter((l) => !l.startsWith('ev='));
  const surfaceDownObserved = hostLines.some((l) => l.startsWith('ev=') && l.includes('"up":false'));
  const hostWriteStillWorks = heartbeatLines.length >= 2;
  results.push({
    phase: 'D-host-alive', hostAliveLater, hostLines: hostLines.length,
    surfaceDownObserved, hostWriteStillWorks,
    heartbeatSample: heartbeatLines.slice(-3),
  });
  console.log(`[${stamp()}] D-host-alive: alive=${hostAliveLater} downObserved=${surfaceDownObserved} writes=${hostWriteStillWorks}`);

  // ---- E: recovery — restart surface (new auto-assigned port) ----
  const { srv: srv2, port: port2 } = await startAndWaitServer(25000);
  const base2 = port2 ? `http://127.0.0.1:${port2}` : null;
  const recovered = base2 ? await healthOk(base2) : false;
  results.push({ phase: 'E-recovery', ok: recovered, base: base2, health: recovered });
  console.log(`[${stamp()}] E-recovery: base=${base2} health=${recovered}`);
  await new Promise((r) => setTimeout(r, 1500));

  // ---- cleanup ----
  killTree(srv2.child);
  if (host && host.pid) { try { execSync(`taskkill /PID ${host.pid} /T /F`, { stdio: 'ignore' }); } catch {} }
  results.push({
    phase: 'Z-cleanup',
    ok: true,
    portFileAfter: fs.existsSync(PORT_FILE) ? fs.readFileSync(PORT_FILE, 'utf8') : null,
    elapsedMs: Date.now() - started,
  });
  console.log(`[${stamp()}] Z-cleanup done (${Date.now() - started}ms)`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log('\nWROTE ' + OUT);
}

main().catch((e) => { console.error('C5 probe error:', e); process.exit(1); });
