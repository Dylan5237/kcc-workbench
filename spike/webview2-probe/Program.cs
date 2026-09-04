// D0-01 C3+C4 WebView2 probe.
// Loads the real cdesktop surface in a WebView2 (same engine/stack as Arckeep),
// then from the page's own origin verifies:
//   C3: SPA render, same-origin REST, SSE events, full create-session + follow-up
//   C4: navigate away + back, session still present (localStorage + backend), resume same session
// Results are written to a JSON file.
//
// NOTE on mechanism: this WebView2 runtime does NOT await promises returned by
// ExecuteScriptAsync (they serialize to {}). We therefore use the two-step pattern:
// JS async bodies store results into window.__pb[<key>]; C# polls that key.
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace CdesktopWebView2Probe;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var url = args.Length > 0 ? args[0] : "http://127.0.0.1:1274";
        var outPath = args.Length > 1 ? args[1] : "probe-result.json";
        var probeDir = args.Length > 2 ? args[2]
            : @"D:\_projects\tools\kcc-workbench-wt-d0-01\spike\probe-project";

        Application.SetHighDpiMode(HighDpiMode.SystemAware);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new ProbeForm(url, outPath, probeDir));
    }
}

internal sealed class ProbeForm : Form
{
    private readonly string _url;
    private readonly string _outPath;
    private readonly string _probeDir;
    private readonly List<object> _results = new();
    private readonly Dictionary<string, string> _pb = new();
    private WebView2? _view;
    private CoreWebView2Environment? _env;

    public ProbeForm(string url, string outPath, string probeDir)
    {
        _url = url;
        _outPath = outPath;
        _probeDir = probeDir;
        Width = 1100;
        Height = 720;
        Text = "cdesktop WebView2 probe";
        StartPosition = FormStartPosition.CenterScreen;
        ShowInTaskbar = false;
        _view = new WebView2 { Dock = DockStyle.Fill };
        Controls.Add(_view);
        Shown += OnShown;
    }

    /// <summary>Inject a SINGLE-LEVEL async function (t3-proven pattern) whose body assigns its
    /// result to __res; the script ends with a plain non-promise value.</summary>
    private void StartJs(string key, string asyncBody)
    {
        var script = $@"window.__pb = window.__pb || {{}};
window.__pb['{key}'] = null;
window.__lastErr = window.__lastErr || null;
var __res;
(async function(){{
    try {{
        {asyncBody}
        window.__pb['{key}'] = __res;
    }} catch (__e) {{
        window.__pb['{key}'] = {{ jsError: String(__e) }};
    }}
}})();
'done';";
        _view!.CoreWebView2.ExecuteScriptAsync(script);
    }

    /// <summary>Wait for window.__pb[key]. On timeout, dump captured JS errors and the whole __pb map.</summary>
    private async Task<string?> WaitForJs(string key, int timeoutMs)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            var raw = await _view!.CoreWebView2.ExecuteScriptAsync(
                $"JSON.stringify(window.__pb && window.__pb['{key}'] != null ? window.__pb['{key}'] : null)");
            // raw is the JSON-encoded value. "null" (unset) arrives as "null" or "\"null\"".
            if (raw != "null" && raw != "\"null\"" && !string.IsNullOrEmpty(raw)) return raw;
            await Task.Delay(400);
        }
        // timeout: dump everything for diagnosis
        var dump = await _view!.CoreWebView2.ExecuteScriptAsync(
            "JSON.stringify({ err: window.__lastErr, pb: window.__pb })");
        return $"(TIMEOUT) {dump}";
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var json = e.WebMessageAsJson;
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("key", out var k) &&
                doc.RootElement.TryGetProperty("value", out var val))
            {
                var key = k.GetString() ?? "";
                lock (_pb) _pb[key] = val.GetRawText();
            }
        }
        catch { /* ignore malformed */ }
    }

    private async Task<bool> NavigateAsync(string target, int timeoutMs)
    {
        var tcs = new TaskCompletionSource<bool>();
        void H(object? s, CoreWebView2NavigationCompletedEventArgs e) => tcs.TrySetResult(e.IsSuccess);
        _view!.CoreWebView2.NavigationCompleted += H;
        _view.CoreWebView2.Navigate(target);
        var ok = await Task.WhenAny(tcs.Task, Task.Delay(timeoutMs)) == tcs.Task ? await tcs.Task : false;
        _view.CoreWebView2.NavigationCompleted -= H;
        return ok;
    }

    private async void OnShown(object? sender, EventArgs e)
    {
        try
        {
            var udf = Path.Combine(Path.GetTempPath(), "cdesktop-wv2-probe-udf");
            _env = await CoreWebView2Environment.CreateAsync(userDataFolder: udf);
            await _view!.EnsureCoreWebView2Async(_env);
            _view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            _view.CoreWebView2.Settings.AreDevToolsEnabled = true;
            _view.CoreWebView2.WebMessageReceived += OnWebMessage;
            _view.CoreWebView2.ExecuteScriptAsync(
                @"window.__lastErr = null;
                  window.addEventListener('error', e => { window.__lastErr = (e.message || String(e.error || e)); });");

            var jsProbePath = JsonSerializer.Serialize(_probeDir);

            // ---- Phase A: load the real cdesktop surface ----
            var loaded = await NavigateAsync(_url, 40000);
            _results.Add(new { phase = "A-load", ok = loaded, url = _url });
            await Task.Delay(2000);

            StartJs("spa", @"__res = { origin: location.origin, title: document.title,
                ready: document.readyState,
                rootChildren: (document.getElementById('root')?.children.length ?? -1),
                bodyLen: (document.body ? document.body.innerText.length : 0) };");
            _results.Add(new { phase = "A-spa", data = await WaitForJs("spa", 10000) });

            StartJs("health", @"const r = await fetch('/api/health');
                const j = await r.json();
                __res = { ok: j.success, data: j.data };");
            _results.Add(new { phase = "A-health", data = await WaitForJs("health", 10000) });

            StartJs("sse", @"__res = await new Promise(resolve => {
                const es = new EventSource('/api/events');
                let gotOpen = false, gotEvent = false, sample = '';
                const done = () => { try { es.close(); } catch {} resolve({ gotOpen, gotEvent, sample }); };
                const t = setTimeout(() => done(), 15000);
                es.onopen = () => { gotOpen = true; };
                // cdesktop emits named events (json_patch), so onmessage alone is not enough.
                es.onmessage = (e) => { gotEvent = true; clearTimeout(t); sample = String(e.data).slice(0, 300); done(); };
                es.addEventListener('json_patch', (e) => { gotEvent = true; clearTimeout(t); sample = String(e.data).slice(0, 300); done(); });
                es.onerror = () => {};
            });");
            // Trigger a backend event while the SSE listener is open (creating a workspace
            // emits a json_patch SSE event), proving events actually flow over SSE in WebView2.
            StartJs("sseTrigger", @"await (await fetch('/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'd0-01-sse-trigger-' + Date.now(), use_worktree: false }) })).json();
                __res = { triggered: true };");
            _results.Add(new { phase = "A-sse", data = await WaitForJs("sse", 20000) });
            _results.Add(new { phase = "A-sse-trigger", data = await WaitForJs("sseTrigger", 10000) });

            StartJs("fullFlow", $@"
                const repoJ = await (await fetch('/api/repos', {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, body: JSON.stringify({{ path: {jsProbePath}, display_name: 'd0-01-probe-wv2' }}) }})).json();
                const repo  = repoJ.data;
                const wsJ   = await (await fetch('/api/workspaces', {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, body: JSON.stringify({{ name: 'd0-01-wv2-ws', use_worktree: false }}) }})).json();
                const ws    = wsJ.data;
                await (await fetch('/api/workspaces/' + ws.id + '/repos', {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, body: JSON.stringify({{ repo_id: repo.id, target_branch: 'main' }}) }})).json();
                const sessJ = await (await fetch('/api/sessions', {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, body: JSON.stringify({{ workspace_id: ws.id, executor: 'CLAUDE_CODE', name: 'd0-01-wv2-session' }}) }})).json();
                const sess  = sessJ.data;
                const runJ  = await (await fetch('/api/sessions/' + sess.id + '/follow-up', {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, body: JSON.stringify({{ prompt: 'Reply with exactly the token: cdesktop-webview2-probe-ok. Nothing else.', executor_config: {{ executor: 'CLAUDE_CODE' }} }}) }})).json();
                const procId = runJ.data.id;
                let status = '', tries = 0;
                while (tries < 40) {{
                    await new Promise(r => setTimeout(r, 2500));
                    const pr = await (await fetch('/api/execution-processes/' + procId)).json();
                    status = pr.data?.status || 'unknown';
                    if (['completed','failed','killed'].includes(status)) break;
                    tries++;
                }}
                localStorage.setItem('__probe', JSON.stringify({{ wsId: ws.id, sessId: sess.id, procId, repoId: repo.id }}));
                __res = {{ wsId: ws.id, sessId: sess.id, procId, status, tries }};");
            _results.Add(new { phase = "A-real-session", data = await WaitForJs("fullFlow", 160000) });

            // ---- Phase B: workspace switch = navigate away, then back ----
            await NavigateAsync("about:blank", 10000);
            _results.Add(new { phase = "B-navigate-away", ok = true });
            await Task.Delay(500);
            var back = await NavigateAsync(_url, 40000);
            _results.Add(new { phase = "B-navigate-back", ok = back });
            await Task.Delay(2000);

            StartJs("persist", @"const saved = JSON.parse(localStorage.getItem('__probe') || '{}');
                if (!saved.sessId) { __res = { error: 'no saved probe state', saved }; }
                else {
                    const j = await (await fetch('/api/sessions?workspace_id=' + saved.wsId)).json();
                    __res = { found: j.success, sessionCount: (j.data||[]).length,
                             session: (j.data||[]).find(s => s.id === saved.sessId) || null,
                             persistedViaLocalStorage: true };
                }");
            _results.Add(new { phase = "B-session-persisted", data = await WaitForJs("persist", 15000) });

            StartJs("resume", $@"
                const saved = JSON.parse(localStorage.getItem('__probe') || '{{}}');
                if (!saved.sessId) {{ __res = {{ error: 'no saved probe state' }}; }}
                else {{
                    const r = await fetch('/api/sessions/' + saved.sessId + '/follow-up', {{
                        method: 'POST', headers: {{ 'Content-Type': 'application/json' }},
                        body: JSON.stringify({{ prompt: 'Reply with exactly the token: cdesktop-webview2-resume-ok. Nothing else.',
                                               executor_config: {{ executor: 'CLAUDE_CODE' }} }})
                    }});
                    const j = await r.json();
                    const procId = j.data?.id;
                    let status = '', tries = 0;
                    while (tries < 40) {{
                        await new Promise(rr => setTimeout(rr, 2500));
                        const pr = await (await fetch('/api/execution-processes/' + procId)).json();
                        status = pr.data?.status || 'unknown';
                        if (['completed','failed','killed'].includes(status)) break;
                        tries++;
                    }}
                    __res = {{ procId, status, sameSession: saved.sessId, tries }};
                }}");
            _results.Add(new { phase = "B-resume-session", data = await WaitForJs("resume", 160000) });

            // Cleanup probe artifacts (delete the probe workspace + repo we created).
            StartJs("cleanup", $@"
                const saved = JSON.parse(localStorage.getItem('__probe') || '{{}}');
                const del = async (path) => await (await fetch(path, {{ method: 'DELETE' }})).json();
                let removedWs = false, removedRepo = false;
                if (saved.wsId) {{ const w = await del('/api/workspaces/' + saved.wsId); removedWs = w.success; }}
                if (saved.repoId) {{ const r = await del('/api/repos/' + saved.repoId); removedRepo = r.success; }}
                __res = {{ removedWs, removedRepo }};");
            _results.Add(new { phase = "Y-cleanup", data = await WaitForJs("cleanup", 15000) });

            _results.Add(new { phase = "Z-webview2-version", version = _env.BrowserVersionString });
        }
        catch (Exception ex)
        {
            _results.Add(new { phase = "ERROR", message = ex.ToString() });
        }
        finally
        {
            try
            {
                await File.WriteAllTextAsync(_outPath,
                    JsonSerializer.Serialize(_results, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch { /* best effort */ }
            Close();
        }
    }
}
