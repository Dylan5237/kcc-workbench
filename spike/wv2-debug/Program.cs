using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Wv2Debug;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.SetHighDpiMode(HighDpiMode.SystemAware);
        Application.EnableVisualStyles();
        Application.Run(new DebugForm());
    }
}

internal sealed class DebugForm : Form
{
    public DebugForm()
    {
        var view = new WebView2 { Dock = DockStyle.Fill };
        Controls.Add(view);
        Shown += async (_, _) =>
        {
            var env = await CoreWebView2Environment.CreateAsync(userDataFolder: Path.Combine(Path.GetTempPath(), "wv2-debug-udf"));
            await view.EnsureCoreWebView2Async(env);
            view.CoreWebView2.Navigate("http://127.0.0.1:1274");
            await Task.Delay(2500);

            void Log(string s) => File.AppendAllText("debug.txt", s + "\n");
            async Task<string> Poll(string key, int ms)
            {
                var deadline = DateTime.UtcNow.AddMilliseconds(ms);
                while (DateTime.UtcNow < deadline)
                {
                    var raw = await view.CoreWebView2.ExecuteScriptAsync($"JSON.stringify(window.__pb && window.__pb['{key}'] != null ? window.__pb['{key}'] : null)");
                    if (raw != "null") return raw;
                    await Task.Delay(400);
                }
                return "TIMEOUT";
            }

            // Test 1: trivial async sets global
            await view.CoreWebView2.ExecuteScriptAsync(@"(function(){ window.__pb=window.__pb||{}; window.__pb['t1']=null;
                (async function(){ return 42; })().then(v=>{ window.__pb['t1']=v; }); })()");
            Log($"t1(trivial async 42): {await Poll("t1", 5000)}");

            // Test 2: async + fetch /api/health
            await view.CoreWebView2.ExecuteScriptAsync(@"(function(){ window.__pb=window.__pb||{}; window.__pb['t2']=null;
                (async function(){ const r = await fetch('/api/health'); const j = await r.json(); return { ok: j.success, data: j.data }; })()
                  .then(v=>{ window.__pb['t2']=v; }, e=>{ window.__pb['t2']={err:String(e)}; }); })()");
            Log($"t2(fetch health): {await Poll("t2", 8000)}");

            // Test 3: does a top-level 'await' fail the whole script?
            var t3raw = await view.CoreWebView2.ExecuteScriptAsync("window.__pb['t3'] = 'before-await'; (async function(){ const r = await fetch('/api/health'); window.__pb['t3'] = 'after-await:' + r.status; })(); 'done';");
            Log($"t3(top-level-async-inject): {t3raw}");
            await Task.Delay(4000);
            var t3 = await view.CoreWebView2.ExecuteScriptAsync("JSON.stringify(window.__pb['t3'] ?? null)");
            Log($"t3(polled): {t3}");

            // Test 4: EXACT probe StartJs structure (outer IIFE + await async IIFE) with fetch
            await view.CoreWebView2.ExecuteScriptAsync(@"(function(){ window.__pb=window.__pb||{}; window.__pb['t4']=null;
                (async function(){ try { window.__pb['t4'] = await (async function(){ const r = await fetch('/api/health'); const j = await r.json(); return { ok: j.success, data: j.data }; })(); }
                catch (__e) { window.__pb['t4'] = { jsError: String(__e) }; } })(); })(); 'started';");
            Log($"t4(probe-structure fetch): {await Poll("t4", 8000)}");

            // Test 5: probe structure WITHOUT outer IIFE
            await view.CoreWebView2.ExecuteScriptAsync(@"window.__pb['t5']=null;
                (async function(){ try { window.__pb['t5'] = await (async function(){ const r = await fetch('/api/health'); const j = await r.json(); return { ok: j.success, data: j.data }; })(); }
                catch (__e) { window.__pb['t5'] = { jsError: String(__e) }; } })(); 'started';");
            Log($"t5(no-outer-iife fetch): {await Poll("t5", 8000)}");

            Close();
        };
    }
}
