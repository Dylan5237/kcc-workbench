using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Arckeep.Shell;

/// <summary>
/// Kimi Web 本地实例的按需启动与嵌入地址解析。
/// 模式来自 v1（local-kimi-service）与 spike：随机端口 + stdout 解析带 token 的 openUrl。
/// </summary>
internal sealed class KimiWebService : IDisposable
{
    private Process? _proc;

    public string? OpenUrl { get; private set; }
    public Exception? Failure { get; set; }

    /// <summary>一次 cwd 绑定的结果：页面 URL + session id（证据用）。</summary>
    internal sealed record KimiBinding(string Url, string SessionId, string Cwd);

    /// <summary>自有 kimi web 进程 PID（复用既有实例时为 null；诊断/关机证据用）。</summary>
    internal int? OwnedPid => _proc is { HasExited: false } ? _proc.Id : null;

    /// <summary>
    /// Kimi 工作面的 project binding（D0-03 R1）：在已运行的 kimi web 上找到
    /// metadata.cwd == projectRoot 的最近 session，找不到就用既有
    /// POST /api/v1/sessions {metadata:{cwd}} seam 创建一个空 session（不发 prompt、不启动 turn），
    /// 返回该 session 的页面 URL。端口复用只证明"是 Kimi Web"，本方法证明"是当前项目的 session"。
    /// 失败返回 null（调用方回退到 base URL 并记录，绝不 kill 用户既有实例）。
    /// </summary>
    public async Task<KimiBinding?> BindSessionAsync(string projectRoot)
    {
        if (OpenUrl is null) return null;
        try
        {
            var origin = new Uri(OpenUrl).GetLeftPart(UriPartial.Authority);
            var token = ExtractToken(OpenUrl) ?? await ReadServerTokenAsync();
            if (token is null) return null;
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

            // 复用已有 cwd 匹配的 session（取最近更新；列表项携带 metadata.cwd，spike 实证）
            string? sessionId = null;
            using (var doc = JsonDocument.Parse(await http.GetStringAsync(origin + "/api/v1/sessions")))
            {
                if (doc.RootElement.TryGetProperty("data", out var data)
                    && data.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array)
                {
                    string? bestUpdated = null;
                    foreach (var item in items.EnumerateArray())
                    {
                        if (item.TryGetProperty("archived", out var arch) && arch.GetBoolean()) continue;
                        var cwd = item.TryGetProperty("metadata", out var meta)
                            && meta.TryGetProperty("cwd", out var c) ? c.GetString() : null;
                        if (!SamePath(cwd, projectRoot)) continue;
                        var updated = item.TryGetProperty("updated_at", out var u) ? u.GetString() : null;
                        if (bestUpdated is null || string.CompareOrdinal(updated, bestUpdated) > 0)
                        {
                            bestUpdated = updated;
                            sessionId = item.GetProperty("id").GetString();
                        }
                    }
                }
            }
            if (sessionId is null)
            {
                var res = await http.PostAsJsonAsync(origin + "/api/v1/sessions",
                    new { metadata = new { cwd = projectRoot } });
                if (!res.IsSuccessStatusCode) return null;
                using var created = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                sessionId = created.RootElement.GetProperty("data").GetProperty("id").GetString();
            }
            if (sessionId is null) return null;
            Program.Log($"kimi session 绑定：{sessionId} cwd={projectRoot}");
            return new KimiBinding($"{origin}/sessions/{sessionId}#token={token}", sessionId, projectRoot);
        }
        catch (Exception ex)
        {
            Program.Log("kimi session 绑定失败：" + ex.Message);
            return null;
        }
    }

    private static string? ExtractToken(string openUrl)
    {
        var hash = openUrl.Contains('#') ? openUrl[(openUrl.IndexOf('#') + 1)..] : "";
        foreach (var part in hash.Split('&', StringSplitOptions.RemoveEmptyEntries))
            if (part.StartsWith("token=") && part.Length > 6) return part[6..];
        return null;
    }

    private static bool SamePath(string? left, string? right) =>
        string.Equals(
            left is null ? null : Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar),
            right is null ? null : Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar),
            StringComparison.OrdinalIgnoreCase);

    public async Task<string> StartAsync(string cwd, TimeSpan? timeout = null)
    {
        if (OpenUrl is not null && _proc is { HasExited: false }) return OpenUrl;

        // v1 同款端口持久化：端口稳定 → origin 稳定 → localStorage 持久 → 不重复初始化向导
        var stateFile = Path.Combine(ProjectStore.ArckeepDataDir, "kimi-web.json");
        int? port = ReadPreferredPort(stateFile);
        if (port is not null)
        {
            if (!TryReserve(port.Value))
            {
                // 端口被占：若监听者就是 kimi web（token + meta 验明正身），直接复用
                var reused = await TryReuseExistingAsync(port.Value);
                if (reused is not null)
                {
                    OpenUrl = reused;
                    Program.Log($"kimi web 复用已有实例 :{port}");
                    return OpenUrl;
                }
                port = null;
            }
        }
        port ??= FreePort();

        Program.Log($"kimi web 启动于 :{port}");
        await SpawnAndParseAsync(cwd, port.Value, timeout ?? TimeSpan.FromSeconds(45));
        WritePreferredPort(stateFile, port.Value);
        return OpenUrl!;
    }

    private async Task SpawnAndParseAsync(string cwd, int port, TimeSpan timeout)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c kimi web --host 127.0.0.1 --port {port} --no-open",
            WorkingDirectory = cwd,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = new UTF8Encoding(false),
            StandardErrorEncoding = new UTF8Encoding(false),
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        _proc = Process.Start(psi) ?? throw new InvalidOperationException("kimi web 无法启动");

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
        while (DateTime.UtcNow < deadline)
        {
            string text;
            lock (sync) text = sb.ToString();
            var m = Regex.Match(text, @"http://127\.0\.0\.1:\d+/?#[^\s]+");
            if (m.Success)
            {
                OpenUrl = m.Value;
                return;
            }
            var bare = Regex.Match(text, @"http://127\.0\.0\.1:\d+/");
            if (bare.Success)
            {
                var token = await ReadServerTokenAsync();
                OpenUrl = token is not null ? $"{bare.Value}#token={token}" : bare.Value;
                return;
            }
            if (_proc.HasExited) break;
            await Task.Delay(300);
        }
        string tail;
        lock (sync) tail = sb.ToString();
        throw new TimeoutException("kimi web 启动超时：" + tail[^Math.Min(400, tail.Length)..]);
    }

    private static async Task<string?> TryReuseExistingAsync(int port)
    {
        try
        {
            var token = await ReadServerTokenAsync();
            if (token is null) return null;
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            var origin = $"http://127.0.0.1:{port}/";
            var res = await http.GetAsync(origin + "api/v1/meta");
            if (!res.IsSuccessStatusCode) return null;
            return $"{origin}#token={token}";
        }
        catch
        {
            return null;
        }
    }

    private static async Task<string?> ReadServerTokenAsync()
    {
        var tokenPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".kimi-code", "server.token");
        try
        {
            var token = (await File.ReadAllTextAsync(tokenPath)).Trim();
            return token.Length > 0 ? token : null;
        }
        catch { return null; }
    }

    private static int? ReadPreferredPort(string stateFile)
    {
        try
        {
            var data = System.Text.Json.JsonDocument.Parse(File.ReadAllText(stateFile));
            var port = data.RootElement.GetProperty("port").GetInt32();
            return port is >= 1024 and <= 65535 ? port : null;
        }
        catch { return null; }
    }

    private static void WritePreferredPort(string stateFile, int port)
    {
        try { File.WriteAllText(stateFile, System.Text.Json.JsonSerializer.Serialize(new { port }) + "\n"); }
        catch { }
    }

    private static bool TryReserve(int port)
    {
        try
        {
            var l = new System.Net.Sockets.TcpListener(IPAddress.Loopback, port);
            l.Start();
            l.Stop();
            return true;
        }
        catch { return false; }
    }

    private static int FreePort()
    {
        var l = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    public void Dispose()
    {
        try
        {
            if (_proc is { HasExited: false })
                Process.Start(new ProcessStartInfo("taskkill", $"/PID {_proc.Id} /T /F") { CreateNoWindow = true });
        }
        catch { }
        _proc = null;
        OpenUrl = null;
    }
}
