using System.Diagnostics;
using System.Net;
using System.Text;
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
