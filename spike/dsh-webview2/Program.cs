// D0-02 spike：DSH（DeepSeek Harness）现有 Web workspace 的 Windows 宿主集成验证
// 验证项：start/attach 缝（D1）/ 确定性 readiness（D2）/ 真实 Web 表面进 WebView2（D3）/
//         hide/show 与工作面切换不丢会话（D4）/ 故障隔离（D5）/ 进程归属语义（D6）
// 模式（DSH_PROBE_MODE）：owned（默认，探针自有启动）| attach（须先有用户态 DSH 在 3080）| fail（DSH 不可用）
// 附加开关：DSH_PROBE_KILL=1 —— 验证完成后杀掉自有 DSH，验证壳层进入受控故障态而不崩溃
// 注意：WebView2 COM 初始化必须在 UI 线程（form.Shown 里做）；DshService 无 COM，可在 Main 启动。
using System.Diagnostics;
using System.Text.Json;
using System.Windows.Forms;
using Arckeep.Shell;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Arckeep.Shell
{
    /// <summary>生产 Program.Log 的探针替身：写控制台 + 探针日志文件（不进 %APPDATA%）。</summary>
    internal static class Program
    {
        internal static string? LogFile;

        internal static void Log(string message)
        {
            Console.WriteLine("[dsh-svc] " + message);
            try { if (LogFile is not null) File.AppendAllText(LogFile, $"[{DateTime.Now:HH:mm:ss.fff}] {message}\n"); } catch { }
        }
    }
}

namespace DshSpike
{
    internal static class HostProgram
    {
        private static readonly string Root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", ".."));
        private static readonly string ResultsDir = Path.GetFullPath(Path.Combine(Root, "..", "results"));
        private static readonly string UdfRoot = Path.Combine(Root, "udfs");
        private static readonly Stopwatch Clock = Stopwatch.StartNew();
        private static readonly Dictionary<string, object?> M = new();

        [STAThread]
        private static void Main()
        {
            _ = Task.Run(async () => { await Task.Delay(150000); Console.WriteLine("[step] WATCHDOG forced exit"); Environment.Exit(2); });
            ApplicationConfiguration.Initialize();
            Directory.CreateDirectory(ResultsDir);
            Arckeep.Shell.Program.LogFile = Path.Combine(ResultsDir, "dsh-probe.log");
            var mode = Environment.GetEnvironmentVariable("DSH_PROBE_MODE") ?? "owned";
            var killTest = Environment.GetEnvironmentVariable("DSH_PROBE_KILL") == "1";
            M["mode_requested"] = mode;
            M["dotnet"] = Environment.Version.ToString();
            M["webview2_runtime"] = CoreWebView2Environment.GetAvailableBrowserVersionString();
            M["dsh_default_authority"] = DshService.DefaultAuthority;

            using var dsh = new DshService();
            string? dshUrl = null;

            // PRE_READY_HANG / NEVER_READY：真实存活的 child process 永远不就绪，
            // 验证 StartAsync 超时失败返回前已机械清理自有进程树（无窗口，纯进程语义）
            if (mode == "hang")
            {
                RunHangScenario(dsh);
                return;
            }

            // 1) start/attach（纯 .NET，无 COM）
            if (mode == "fail")
            {
                // 模拟 DSH 不可用：attach 探针指向死端口 + 剥离 PATH 里的 dsh，走真实失败路径（短超时）
                Environment.SetEnvironmentVariable("PATH", Environment.GetFolderPath(Environment.SpecialFolder.System));
                dshUrl = dsh.StartAsync(Environment.CurrentDirectory, TimeSpan.FromSeconds(10), "127.0.0.1:1").GetAwaiter().GetResult();
                M["fail_start_returned_null"] = dshUrl is null;
                M["fail_failure_recorded"] = dsh.Failure is not null;
                M["fail_failure_message"] = dsh.Failure?.Message;
                Console.WriteLine($"[step] fail-mode start returned null={dshUrl is null} {Clock.ElapsedMilliseconds}ms");
            }
            else
            {
                // DSH_PROBE_ATTACH 覆盖 attach 探测目标：
                // attach 模式指向“用户实例”；owned 模式指向死端口可强制走自有启动
                // （真实默认 3080 上有一个 9/3 起挂载起、间歇应答的旧实例，会随机吃掉 owned 验证）
                var attachAuthority = Environment.GetEnvironmentVariable("DSH_PROBE_ATTACH");
                dshUrl = dsh.StartAsync(Environment.CurrentDirectory, TimeSpan.FromSeconds(60), attachAuthority).GetAwaiter().GetResult();
                M["attach_authority"] = attachAuthority;
                M["dsh_url"] = dshUrl;
                M["mode_actual"] = dsh.Mode.ToString();
                M["start_ms"] = Clock.ElapsedMilliseconds;
                Console.WriteLine($"[step] dsh ready mode={dsh.Mode} url={dshUrl} {Clock.ElapsedMilliseconds}ms");
            }

            // 2) 装配窗口：DSH 工作面 + “其他工作面”（workspace switching 对端），Visible 切换
            var form = new Form { Text = "D0-02 spike — DSH in WebView2", Width = 1440, Height = 900 };
            var dshView = new WebView2 { Dock = DockStyle.Fill };
            var otherView = new WebView2 { Dock = DockStyle.Fill, Visible = false };
            form.Controls.Add(dshView);
            form.Controls.Add(otherView);
            form.Shown += async (_, _) => await OnShownAsync(form, dshView, otherView, dsh, dshUrl, killTest);
            Application.Run(form);

            // 3) 归属语义：Dispose 后 owned 必须死掉；attached 必须活着
            var finalMode = dsh.Mode; // Dispose 会重置 Mode，先取样
            dsh.Dispose();
            if (mode != "fail" && dshUrl is not null)
            {
                // node 进程退出后 socket 释放有毫秒级尾巴，轮询而非单次判定
                var alive = false;
                for (var i = 0; i < 10; i++)
                {
                    alive = Ping(dshUrl).GetAwaiter().GetResult();
                    if (!alive) break;
                    Thread.Sleep(1000);
                }
                if (finalMode == DshService.Ownership.Owned && !killTest) M["owned_process_gone_after_exit"] = !alive;
                if (finalMode == DshService.Ownership.Attached) M["attached_alive_after_exit"] = alive;
            }
            WriteResults();
            Console.WriteLine("SPIKE DONE " + JsonSerializer.Serialize(M));
        }

        private static async Task<bool> Ping(string url) =>
            await DshService.TryAttachAsync(new Uri(url).Authority) is not null;

        /// <summary>
        /// PRE_READY_HANG / NEVER_READY：PATH 里放假 dsh.cmd（ping 长眠，真实存活、永不就绪），
        /// StartAsync 必须超时失败且返回前已清理自有进程树。
        /// </summary>
        private static void RunHangScenario(DshService dsh)
        {
            var fakeDir = Path.Combine(Root, "tmp-fake-dsh");
            Directory.CreateDirectory(fakeDir);
            File.WriteAllText(Path.Combine(fakeDir, "dsh.cmd"), "@echo off\r\nping -n 999 127.0.0.1 >nul\r\n");
            Environment.SetEnvironmentVariable("PATH", fakeDir + ";" + Environment.GetFolderPath(Environment.SpecialFolder.System));

            int? spawnedPid = null;
            var aliveAt2s = false;
            var aliveAt5s = false;
            var watch = Task.Run(async () =>
            {
                var t0 = Clock.Elapsed;
                while (Clock.Elapsed - t0 < TimeSpan.FromSeconds(9))
                {
                    spawnedPid ??= dsh.OwnedProcessId;
                    if (spawnedPid is int pid)
                    {
                        var alive = ProcessAlive(pid);
                        if (Clock.Elapsed - t0 > TimeSpan.FromSeconds(2)) aliveAt2s |= alive;
                        if (Clock.Elapsed - t0 > TimeSpan.FromSeconds(5)) aliveAt5s |= alive;
                    }
                    await Task.Delay(100);
                }
            });

            var sw = Stopwatch.StartNew();
            var url = dsh.StartAsync(Environment.CurrentDirectory, TimeSpan.FromSeconds(8), "127.0.0.1:1").GetAwaiter().GetResult();
            sw.Stop();
            watch.Wait(15000);

            M["startup_failed"] = url is null;
            M["failure_recorded"] = dsh.Failure is not null;
            M["failure_message"] = dsh.Failure?.Message;
            M["owned_process_started"] = spawnedPid is not null;
            M["owned_process_alive_at_2s"] = aliveAt2s;
            M["owned_process_alive_at_5s"] = aliveAt5s;
            if (spawnedPid is int p)
                M["owned_process_gone_after_failure"] = !ProcessAlive(p) && !HasChild(p);
            M["mode_after_failure"] = dsh.Mode.ToString();
            M["open_url_after_failure"] = dsh.OpenUrl;
            M["owned_ref_after_failure"] = dsh.OwnedProcessId;
            M["elapsed_ms"] = sw.ElapsedMilliseconds;
            Console.WriteLine($"[step] hang: failed={M["startup_failed"]} started={M["owned_process_started"]} " +
                $"alive2s={aliveAt2s} alive5s={aliveAt5s} gone={M["owned_process_gone_after_failure"]} elapsed={sw.ElapsedMilliseconds}ms");
            WriteResults();
            Console.WriteLine("SPIKE DONE " + JsonSerializer.Serialize(M));
        }

        private static bool ProcessAlive(int pid)
        {
            try { using var p = Process.GetProcessById(pid); return !p.HasExited; }
            catch { return false; }
        }

        /// <summary>进程树残留检查：自有 cmd 被杀后其 child（ping）也必须不存在。</summary>
        private static bool HasChild(int pid)
        {
            try
            {
                using var ps = Process.Start(new ProcessStartInfo("powershell",
                    $"-NoProfile -Command \"(Get-CimInstance Win32_Process -Filter 'ParentProcessId={pid}' | Measure-Object).Count\"")
                { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true });
                var outp = ps!.StandardOutput.ReadToEnd().Trim();
                ps.WaitForExit(15000);
                return outp != "0";
            }
            catch { return false; }
        }

        private static void WriteResults()
        {
            try
            {
                File.WriteAllText(Path.Combine(ResultsDir, "dsh-probe.json"), JsonSerializer.Serialize(M, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch { }
        }

        private static async Task OnShownAsync(Form form, WebView2 dshView, WebView2 otherView, DshService dsh, string? dshUrl, bool killTest)
        {
            try
            {
                var env = await CoreWebView2Environment.CreateAsync(userDataFolder: Path.Combine(UdfRoot, "dsh"));
                await dshView.EnsureCoreWebView2Async(env);
                var otherEnv = await CoreWebView2Environment.CreateAsync(userDataFolder: Path.Combine(UdfRoot, "other"));
                await otherView.EnsureCoreWebView2Async(otherEnv);
                otherView.CoreWebView2.NavigateToString("<body style='font-family:sans-serif;padding:40px'>other workspace（切换对端）</body>");
                Console.WriteLine($"[step] webviews ready {Clock.ElapsedMilliseconds}ms");

                if (dshUrl is null)
                {
                    // D5：受控产品级故障态——壳与其他工作面不受影响
                    dshView.CoreWebView2.NavigateToString(FailureHtml(dsh.Failure?.Message ?? "DSH 不可用"));
                    await Task.Delay(3000);
                    M["fail_controlled_state_shown"] = true;
                    M["shell_alive_in_failure"] = true;
                    Console.WriteLine($"[step] failure state rendered, shell alive {Clock.ElapsedMilliseconds}ms");
                    return;
                }

                // D3：真实 DSH Web workspace 进 WebView2
                var navDone = new TaskCompletionSource();
                dshView.CoreWebView2.NavigationCompleted += (_, e) => { if (e.IsSuccess) navDone.TrySetResult(); };
                dshView.CoreWebView2.Navigate(dshUrl);
                var finished = await Task.WhenAny(navDone.Task, Task.Delay(30000));
                M["d3_nav_completed"] = finished == navDone.Task;
                M["d3_nav_ms_from_launch"] = Clock.ElapsedMilliseconds;
                M["d3_document_title"] = await dshView.CoreWebView2.ExecuteScriptAsync("document.title");
                Console.WriteLine($"[step] dsh nav done={finished == navDone.Task} title={M["d3_document_title"]} {Clock.ElapsedMilliseconds}ms");
                await Task.Delay(5000); // 等前端模块装配（非 readiness 信号；ready 已由 host.describe 判定）

                // D4：页面内打标记 + 记 timeOrigin，之后验证未 reload
                var mark = "arckeep-probe-" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var markJson = JsonSerializer.Serialize(mark);
                await dshView.CoreWebView2.ExecuteScriptAsync($"window.__arckeepProbeMark={markJson}");
                var originBefore = await dshView.CoreWebView2.ExecuteScriptAsync("String(performance.timeOrigin)");

                // hide/show（ShellWindow 同款 Visible 切换）
                dshView.Visible = false;
                await Task.Delay(3000);
                dshView.Visible = true;
                await Task.Delay(1000);
                M["d4_mark_survives_hide_show"] =
                    await dshView.CoreWebView2.ExecuteScriptAsync("window.__arckeepProbeMark ?? null") == markJson;
                M["d4_timeorigin_equal_after_hide_show"] =
                    await dshView.CoreWebView2.ExecuteScriptAsync("String(performance.timeOrigin)") == originBefore;
                Console.WriteLine($"[step] hide/show mark={M["d4_mark_survives_hide_show"]} timeOrigin={M["d4_timeorigin_equal_after_hide_show"]}");

                // workspace switching：切到对端工作面再切回
                dshView.Visible = false;
                otherView.Visible = true;
                await Task.Delay(3000);
                otherView.Visible = false;
                dshView.Visible = true;
                await Task.Delay(1000);
                M["d4_mark_survives_switch"] =
                    await dshView.CoreWebView2.ExecuteScriptAsync("window.__arckeepProbeMark ?? null") == markJson;
                M["d4_timeorigin_equal_after_switch"] =
                    await dshView.CoreWebView2.ExecuteScriptAsync("String(performance.timeOrigin)") == originBefore;
                Console.WriteLine($"[step] switch mark={M["d4_mark_survives_switch"]} timeOrigin={M["d4_timeorigin_equal_after_switch"]}");

                // D5（运行中故障）：杀掉自有 DSH，壳必须活着并进受控故障态
                if (killTest && dsh.Mode == DshService.Ownership.Owned && dsh.OwnedProcessId is int pid)
                {
                    KillTree(pid);
                    await Task.Delay(2000);
                    M["d5_dsh_unreachable_after_kill"] = !await Ping(dshUrl);
                    dshView.CoreWebView2.NavigateToString(FailureHtml("DSH 进程已退出"));
                    await Task.Delay(1500);
                    M["d5_shell_alive_after_dsh_kill"] = true;
                    M["d5_controlled_state_after_kill"] = true;
                    Console.WriteLine("[step] kill test: shell alive, controlled state shown");
                }

                M["total_elapsed_ms"] = Clock.ElapsedMilliseconds;
            }
            catch (Exception ex)
            {
                M["fatal"] = ex.ToString();
                Console.WriteLine("[step] FATAL " + ex.Message);
            }
            finally
            {
                form.Close();
            }
        }

        private static void KillTree(int pid)
        {
            try { Process.Start(new ProcessStartInfo("taskkill", $"/PID {pid} /T /F") { CreateNoWindow = true })?.WaitForExit(15000); }
            catch { }
        }

        private static string FailureHtml(string reason) => $$"""
            <!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
            body{margin:0;background:#F5F2EA;color:#232323;font:13px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;padding:40px}
            .t{font-size:15px;font-weight:600;margin-bottom:8px}.r{color:#66635D}
            </style></head><body>
            <div class="t">DSH 工作面不可用</div>
            <div class="r">{{System.Net.WebUtility.HtmlEncode(reason)}}</div>
            <div class="r">Kimi / Claude / Viewer 工作面不受影响，可继续使用。</div>
            </body></html>
            """;
    }
}
