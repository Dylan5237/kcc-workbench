// Arckeep 2.0 spike：C# 薄壳 + 双 WebView2（agent 原生界面 + 项目侧轨）
// 验证项：多 WebView2 同窗布局 / UDF 隔离 / 冷启动 / 内存 / CapturePreview 截图
// 注意：WebView2 的 COM 初始化必须在 UI 线程（STA + WinForms 同步上下文），故全部 webview
// 逻辑放在 form.Shown 处理器里；Main 只做无 COM 的 kimi web 启动与窗口装配。
using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ArckeepSpike;

internal static class Program
{
    private static readonly string Root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", ".."));
    private static readonly string ResultsDir = Path.GetFullPath(Path.Combine(Root, "..", "results"));
    private static readonly string UdfRoot = Path.Combine(Root, "udfs");
    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly Dictionary<string, object?> Metrics = new();
    private static Process? _kimi;
    private static string? _kimiUrl;
    private static WebView2? _agentView;
    private static WebView2? _railView;

    [STAThread]
    private static void Main()
    {
        _ = Task.Run(async () => { await Task.Delay(120000); Console.WriteLine("[step] WATCHDOG forced exit"); Environment.Exit(2); });
        ApplicationConfiguration.Initialize();
        Directory.CreateDirectory(ResultsDir);
        Metrics["dotnet"] = Environment.Version.ToString();
        Metrics["webview2_runtime"] = CoreWebView2Environment.GetAvailableBrowserVersionString();

        // 1) 启动 kimi web（纯 .NET，无 COM，可在 Main 里做）
        try
        {
            var port = FreePort();
            _kimi = StartKimiWeb(port);
            _kimiUrl = ReadOpenUrlAsync(_kimi, TimeSpan.FromSeconds(45)).GetAwaiter().GetResult();
            Metrics["kimi_web_url"] = _kimiUrl;
            Console.WriteLine($"[step] kimi web ready {Clock.ElapsedMilliseconds}ms");
        }
        catch (Exception ex)
        {
            Metrics["kimi_web_error"] = ex.Message;
            Console.WriteLine($"[step] kimi web failed: {ex.Message}");
        }

        // 2) 装配窗口：左 agent（大），右 rail（260px）
        var form = new Form
        {
            Text = "Arckeep spike — C# + WebView2",
            Width = 1440,
            Height = 900,
            BackColor = Color.FromArgb(0xF5, 0xF2, 0xEA),
        };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 260F));
        form.Controls.Add(layout);

        _agentView = new WebView2 { Dock = DockStyle.Fill };
        _railView = new WebView2 { Dock = DockStyle.Fill };
        layout.Controls.Add(_agentView, 0, 0);
        layout.Controls.Add(_railView, 1, 0);

        form.Shown += async (_, _) => await OnShownAsync(form);
        Application.Run(form);

        // 3) 收尾：杀 kimi web 子进程，写指标
        try { if (_kimi is not null) Process.Start(new ProcessStartInfo("taskkill", $"/PID {_kimi.Id} /T /F") { CreateNoWindow = true }); } catch { }
        try
        {
            File.WriteAllText(Path.Combine(ResultsDir, "host-metrics.json"), JsonSerializer.Serialize(Metrics, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
    }

    private static async Task OnShownAsync(Form form)
    {
        Metrics["cold_start_ms_to_shown"] = Clock.ElapsedMilliseconds;
        Console.WriteLine($"[step] form shown {Clock.ElapsedMilliseconds}ms");
        try
        {
            // 双 WebView2，各自独立 UDF（此处已在 UI 线程，COM 安全）
            var agentEnv = await CoreWebView2Environment.CreateAsync(userDataFolder: Path.Combine(UdfRoot, "agent"));
            await _agentView!.EnsureCoreWebView2Async(agentEnv);
            Console.WriteLine($"[step] agent webview ready {Clock.ElapsedMilliseconds}ms");
            var railEnv = await CoreWebView2Environment.CreateAsync(userDataFolder: Path.Combine(UdfRoot, "rail"));
            await _railView!.EnsureCoreWebView2Async(railEnv);
            Console.WriteLine($"[step] rail webview ready {Clock.ElapsedMilliseconds}ms");

            _railView.CoreWebView2.NavigateToString(RailHtml());

            if (_kimiUrl is not null)
            {
                var navDone = new TaskCompletionSource();
                _agentView.CoreWebView2.NavigationCompleted += (_, e) => { if (e.IsSuccess) navDone.TrySetResult(); };
                _agentView.CoreWebView2.Navigate(_kimiUrl);
                var finished = await Task.WhenAny(navDone.Task, Task.Delay(25000));
                Metrics["agent_nav_completed"] = finished == navDone.Task;
                Metrics["agent_nav_ms_from_launch"] = Clock.ElapsedMilliseconds;
                Console.WriteLine($"[step] agent nav done={finished == navDone.Task} {Clock.ElapsedMilliseconds}ms");
            }
            else
            {
                _agentView.CoreWebView2.NavigateToString("<body style='background:#F5F2EA;color:#232323;font-family:sans-serif;padding:40px'>kimi web 启动失败（见 metrics）</body>");
            }

            await Task.Delay(12000);
            Console.WriteLine($"[step] settle done, capturing {Clock.ElapsedMilliseconds}ms");
            await Capture(_agentView, Path.Combine(ResultsDir, "spike-agent.png"), "agent");
            await Capture(_railView, Path.Combine(ResultsDir, "spike-rail.png"), "rail");
            Console.WriteLine($"[step] captured {Clock.ElapsedMilliseconds}ms");

            var launchedAt = Process.GetCurrentProcess().StartTime.AddSeconds(-2);
            var wv2 = Process.GetProcessesByName("msedgewebview2")
                .Where(p => { try { return p.StartTime >= launchedAt; } catch { return false; } })
                .ToList();
            Metrics["webview2_processes"] = wv2.Count;
            Metrics["webview2_working_set_mb"] = Math.Round(wv2.Sum(p => p.WorkingSet64) / 1048576.0, 1);
            Metrics["host_working_set_mb"] = Math.Round(Process.GetCurrentProcess().WorkingSet64 / 1048576.0, 1);
            Metrics["total_elapsed_ms"] = Clock.ElapsedMilliseconds;
            Console.WriteLine("SPIKE DONE " + JsonSerializer.Serialize(Metrics));
        }
        catch (Exception ex)
        {
            Metrics["fatal"] = ex.ToString();
            Console.WriteLine("[step] FATAL " + ex.Message);
        }
        finally
        {
            form.Close();
        }
    }

    private static int FreePort()
    {
        var l = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    private static Process StartKimiWeb(int port)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c kimi web --host 127.0.0.1 --port {port} --no-open",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        return Process.Start(psi) ?? throw new InvalidOperationException("kimi web 无法启动");
    }

    private static async Task<string> ReadOpenUrlAsync(Process p, TimeSpan timeout)
    {
        var sb = new StringBuilder();
        var sync = new object();
        void Pump(StreamReader reader) => _ = Task.Run(async () =>
        {
            string? line;
            while ((line = await reader.ReadLineAsync()) is not null) lock (sync) sb.AppendLine(line);
        });
        Pump(p.StandardOutput);
        Pump(p.StandardError);

        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            string text;
            lock (sync) text = sb.ToString();
            var m = System.Text.RegularExpressions.Regex.Match(text, @"http://127\.0\.0\.1:\d+/?#[^\s]+");
            if (m.Success) return m.Value;
            var bare = System.Text.RegularExpressions.Regex.Match(text, @"http://127\.0\.0\.1:\d+/");
            if (bare.Success)
            {
                var tokenPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".kimi-code", "server.token");
                if (File.Exists(tokenPath))
                {
                    var token = (await File.ReadAllTextAsync(tokenPath)).Trim();
                    if (token.Length > 0) return $"{bare.Value}#token={token}";
                }
                return bare.Value;
            }
            if (p.HasExited) break;
            await Task.Delay(300);
        }
        string tail;
        lock (sync) tail = sb.ToString();
        throw new TimeoutException("kimi web openUrl 解析超时：" + tail[^Math.Min(500, tail.Length)..]);
    }

    private static async Task Capture(WebView2 view, string path, string name)
    {
        try
        {
            await using var fs = File.Create(path);
            await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);
            Metrics[$"capture_{name}"] = true;
        }
        catch (Exception ex)
        {
            Metrics[$"capture_{name}"] = ex.Message;
        }
    }

    private static string RailHtml() => """
        <!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
        body{margin:0;background:#F5F2EA;color:#232323;font:13px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;border-left:1px solid #D8D4CB}
        .b{padding:14px 16px;border-bottom:1px solid #D8D4CB}.no{font:9px Consolas,monospace;color:#5B5E3B;letter-spacing:.1em}
        .t{font-size:11px;letter-spacing:.2em;font-weight:600;color:#66635D;margin-bottom:6px}
        .kv{display:flex;justify-content:space-between;padding:2px 0}.k{color:#66635D}.v{font:11px Consolas,monospace}
        .go{margin:14px 16px;padding:9px 0;text-align:center;background:#232323;color:#F5F2EA;font-size:12px;letter-spacing:.08em;
            clip-path:polygon(0 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%)}
        </style></head><body>
        <div class="b"><div class="no">R.1</div><div class="t">本项目</div>
        <div class="kv"><span class="k">接续点</span><span class="v">spike 验证</span></div>
        <div class="kv"><span class="k">携带简报</span><span class="v">经 ACP 已交付 ✓</span></div></div>
        <div class="b"><div class="no">R.2</div><div class="t">会话状态</div>
        <div class="kv"><span class="k">来自</span><span class="v">Kimi Code Web 0.39</span></div>
        <div class="kv"><span class="k">嵌入</span><span class="v">WebView2 · 独立 UDF</span></div></div>
        <div class="go">会话结束 · 回到项目 →</div>
        </body></html>
        """;
}
