using System.Diagnostics;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Arckeep.Shell;

/// <summary>
/// DSH（DeepSeek Harness）现有 Web workspace 的 start/attach 与 readiness 集成缝。
/// 模式与 KimiWebService 对齐：attach 优先（复用用户已运行实例），缺席时才启动
/// Arckeep 自有进程；ready 信号用真实 RPC（POST /api/host.describe），不靠固定 sleep。
/// 依据：D0-02 spike（spike/dsh-webview2/，证据 docs/acceptance/d0-02-*.md）。
/// </summary>
internal sealed class DshService : IDisposable
{
    /// <summary>DSH web profile 组合配置里的默认监听地址（dsh web --dump-config 实测）。</summary>
    public const string DefaultAuthority = "127.0.0.1:3080";

    private static readonly Regex ReadyLine = new(@"dsh web: (http://\S+)", RegexOptions.Compiled);

    /// <summary>attach 探测结果：URL + 该实例的真实 cwd（host.describe 事实，不伪造绑定）。</summary>
    public sealed record AttachInfo(string Url, string? Cwd);

    private Process? _proc;

    public enum Ownership { None, Attached, Owned }

    public string? OpenUrl { get; private set; }
    public Ownership Mode { get; private set; } = Ownership.None;
    public Exception? Failure { get; private set; }

    /// <summary>
    /// 本实例的项目绑定事实：Owned = 启动 cwd；Attached = host.describe 报告的 cwd
    /// （用户实例不随 Arckeep 项目切换，仅供壳层诚实记录）。
    /// </summary>
    public string? BoundCwd { get; private set; }

    /// <summary>自有模式下的子进程 PID（诊断/看门狗用；attached 模式恒为 null）。</summary>
    public int? OwnedProcessId => Mode == Ownership.Owned ? _proc?.Id : null;

    /// <summary>
    /// attach 优先：先探测 attachAuthority（默认组合配置的 3080）上是否已有 DSH
    /// （host.describe 验明正身，绝不误认其他服务）；没有再启动 Arckeep 自有实例
    /// （--port 0 由 OS 分配，不与用户实例争端口）。
    /// 失败不抛出到壳层：写入 Failure，返回 null。
    /// </summary>
    public async Task<string?> StartAsync(string cwd, TimeSpan? timeout = null, string? attachAuthority = null)
    {
        if (OpenUrl is not null && Mode == Ownership.Attached) return OpenUrl;
        if (OpenUrl is not null && _proc is { HasExited: false }) return OpenUrl;

        var attached = await TryAttachAsync(attachAuthority ?? DefaultAuthority);
        if (attached is not null)
        {
            Mode = Ownership.Attached;
            OpenUrl = attached.Url;
            BoundCwd = attached.Cwd;
            Program.Log($"dsh 复用用户已有实例 {attached.Url}（其实例 cwd={attached.Cwd ?? "未知"}，不随 Arckeep 项目切换）");
            return OpenUrl;
        }

        try
        {
            // --port 0：OS 分配空闲端口，stdout 打印 "dsh web: http://127.0.0.1:<port>"
            await SpawnAndWaitReadyAsync(cwd, timeout ?? TimeSpan.FromSeconds(60));
            return OpenUrl;
        }
        catch (Exception ex)
        {
            // spawned-but-not-ready 也必须清理：任何 post-spawn 失败返回前，
            // 先机械终止 Arckeep 已创建的进程树（不依赖调用方再 Dispose）
            TerminateOwned();
            Failure = ex;
            Program.Log("dsh 启动失败：" + ex.Message);
            return null;
        }
    }

    /// <summary>
    /// 用 DSH 专有 RPC 形状验明一个 authority 是不是 DSH web：
    /// POST /api/host.describe → server-response 且 result.ok=true 且带 cwd/home。
    /// loopback Host 通过 DSH 的 browser-trust fence（dsh-client-connection）。
    /// </summary>
    public static async Task<AttachInfo?> TryAttachAsync(string authority)
    {
        var origin = $"http://{authority}";
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            var res = await http.PostAsJsonAsync($"{origin}/api/host.describe", new
            {
                type = "client-request",
                rpcId = "arckeep-attach-probe",
                method = "host.describe",
                payload = new { },
            });
            if (!res.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            var root = doc.RootElement;
            if (root.GetProperty("type").GetString() != "server-response") return null;
            if (!root.GetProperty("result").GetProperty("ok").GetBoolean()) return null;
            var value = root.GetProperty("result").GetProperty("value");
            if (!value.TryGetProperty("cwd", out var cwdEl) || !value.TryGetProperty("home", out _)) return null;
            return new AttachInfo(origin + "/", cwdEl.GetString());
        }
        catch
        {
            return null;
        }
    }

    /// <summary>确定性 readiness：host.describe 应答 ok=true 才算 ready（无固定 sleep）。</summary>
    public static async Task<bool> WaitReadyAsync(string origin, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (await TryAttachAsync(new Uri(origin).Authority) is not null) return true;
            await Task.Delay(400);
        }
        return false;
    }

    private async Task SpawnAndWaitReadyAsync(string cwd, TimeSpan timeout)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/c dsh web --host 127.0.0.1 --port 0 --no-open",
            WorkingDirectory = cwd,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = new UTF8Encoding(false),
            StandardErrorEncoding = new UTF8Encoding(false),
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        _proc = Process.Start(psi) ?? throw new InvalidOperationException("dsh web 无法启动");
        // spawn 成功即刻机械视为 Arckeep-owned：此后任何失败路径（含本方法抛错）
        // 都由 StartAsync 的 catch → TerminateOwned 兜底清理，不存在无归属窗口
        Mode = Ownership.Owned;

        var sb = new StringBuilder();
        var sync = new object();
        void Pump(StreamReader reader) => _ = Task.Run(async () =>
        {
            string? line;
            while ((line = await reader.ReadLineAsync()) is not null) lock (sync) sb.AppendLine(line);
        });
        Pump(_proc.StandardOutput);
        Pump(_proc.StandardError);

        var deadline = DateTime.UtcNow + timeout;
        string? url = null;
        while (DateTime.UtcNow < deadline)
        {
            string text;
            lock (sync) text = sb.ToString();
            var m = ReadyLine.Match(text);
            if (m.Success) { url = m.Groups[1].Value; break; }
            if (_proc.HasExited) break;
            await Task.Delay(200);
        }
        if (url is null)
        {
            string tail;
            lock (sync) tail = sb.ToString();
            throw new TimeoutException("dsh web 启动超时：" + tail[^Math.Min(400, tail.Length)..]);
        }

        var origin = new Uri(url).GetLeftPart(UriPartial.Authority);
        if (!await WaitReadyAsync(origin, deadline - DateTime.UtcNow))
            throw new TimeoutException("dsh web readiness 超时：" + origin);
        OpenUrl = origin + "/";
        BoundCwd = cwd;   // owned 实例的项目绑定 = 启动 cwd
        Program.Log($"dsh 已启动（Arckeep 自有）{OpenUrl} cwd={cwd}");
    }

    /// <summary>
    /// 终止自有进程树并复位状态。只在 Owned 语义下有意义（_proc 非空）；
    /// Attached 模式 _proc 恒为 null，本方法必然无操作——用户实例绝不受影响。
    /// </summary>
    private void TerminateOwned()
    {
        try
        {
            if (_proc is { HasExited: false })
            {
                // 等待 taskkill 完成，保证返回时进程树已确定终止（D6 关闭语义）
                Process.Start(new ProcessStartInfo("taskkill", $"/PID {_proc.Id} /T /F") { CreateNoWindow = true })
                    ?.WaitForExit(10000);
                _proc.WaitForExit(10000);
            }
        }
        catch { }
        _proc = null;
        OpenUrl = null;
        Mode = Ownership.None;
        BoundCwd = null;
    }

    /// <summary>只清理 Arckeep 明确创建并拥有的进程树；attach 的用户实例绝不动。</summary>
    public void Dispose()
    {
        if (Mode == Ownership.Owned) TerminateOwned();
        else { _proc = null; OpenUrl = null; Mode = Ownership.None; BoundCwd = null; }
    }
}
