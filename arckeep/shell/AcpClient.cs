using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Arckeep.Shell;

/// <summary>
/// ACP（Agent Client Protocol）客户端：`kimi acp`，NDJSON JSON-RPC over stdio。
/// 证据链：session/new 返回 sessionId；session/prompt 响应含 stopReason；
/// 期间服务端推送 session/update 流（agent_message_chunk 等）。
/// spike 已验证（spike/probe-kimi-acp.mjs，Kimi Code 0.39）。
/// </summary>
internal sealed class AcpClient : IDisposable
{
    private Process? _proc;
    private readonly object _writeLock = new();
    private readonly Dictionary<long, TaskCompletionSource<JsonElement>> _pending = new();
    private long _nextId;

    /// <summary>服务端事件（session/update 等）。参数：update 种类、可读摘要。</summary>
    public event Action<string, string>? OnSessionUpdate;

    public bool Start(string cwd)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/c kimi acp",
            WorkingDirectory = cwd,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = new UTF8Encoding(false),   // GBK 系统上必须显式 UTF-8，否则中文乱码
            StandardErrorEncoding = new UTF8Encoding(false),
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        _proc = Process.Start(psi);
        if (_proc is null) return false;
        _ = Task.Run(ReadLoop);
        _ = Task.Run(async () =>
        {
            string? line;
            while ((line = await _proc.StandardError.ReadLineAsync()) is not null)
                Debug.WriteLine("[kimi acp][stderr] " + line);
        });
        return true;
    }

    public async Task<bool> InitializeAsync()
    {
        var result = await CallAsync("initialize", new { protocolVersion = 1, clientCapabilities = new { } });
        return result.HasValue && !result.Value.ValueKind.Equals(JsonValueKind.Undefined);
    }

    public async Task<string?> NewSessionAsync(string cwd)
    {
        var result = await CallAsync("session/new", new { cwd, mcpServers = Array.Empty<string>() });
        if (result is null) return null;
        return result.Value.TryGetProperty("sessionId", out var id) ? id.GetString() : null;
    }

    /// <summary>携带简报发起首轮；响应到达即一轮完成（stopReason）。</summary>
    public async Task<string?> PromptAsync(string sessionId, string brief)
    {
        var result = await CallAsync("session/prompt", new
        {
            sessionId,
            prompt = new[] { new { type = "text", text = brief } },
        }, timeout: TimeSpan.FromMinutes(10));
        if (result is null) return null;
        return result.Value.TryGetProperty("stopReason", out var sr) ? sr.GetString() : "unknown";
    }

    private async Task<JsonElement?> CallAsync(string method, object params_, TimeSpan? timeout = null)
    {
        if (_proc is null || _proc.HasExited) return null;
        var id = Interlocked.Increment(ref _nextId);
        var tcs = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = tcs;
        var payload = JsonSerializer.Serialize(new { jsonrpc = "2.0", id, method, @params = params_ });
        lock (_writeLock)
        {
            _proc.StandardInput.WriteLine(payload);
            _proc.StandardInput.Flush();
        }
        var wait = await Task.WhenAny(tcs.Task, Task.Delay(timeout ?? TimeSpan.FromSeconds(20)));
        _pending.Remove(id);
        if (wait != tcs.Task) return null;
        var msg = tcs.Task.Result;
        if (msg.TryGetProperty("error", out var err))
        {
            Debug.WriteLine("[acp] error: " + err.GetRawText());
            return null;
        }
        return msg.TryGetProperty("result", out var ok) ? ok : null;
    }

    private async Task ReadLoop()
    {
        var proc = _proc;   // Dispose 会把 _proc 置空；本地捕获防止 NRE
        if (proc is null) return;
        string? line;
        while ((line = await proc.StandardOutput.ReadLineAsync()) is not null)
        {
            JsonDocument doc;
            try { doc = JsonDocument.Parse(line); }
            catch { continue; }
            using (doc)
            {
                var root = doc.RootElement;
                if (root.TryGetProperty("id", out var idEl) && (root.TryGetProperty("result", out _) || root.TryGetProperty("error", out _)))
                {
                    if (_pending.TryGetValue(idEl.GetInt64(), out var tcs))
                        tcs.TrySetResult(root.Clone());
                }
                else if (root.TryGetProperty("method", out var methodEl) && methodEl.GetString() == "session/update")
                {
                    var (kind, summary) = SummarizeUpdate(root);
                    OnSessionUpdate?.Invoke(kind, summary);
                }
            }
        }
    }

    private static (string kind, string summary) SummarizeUpdate(JsonElement root)
    {
        try
        {
            var update = root.GetProperty("params").GetProperty("update");
            var kind = update.GetProperty("sessionUpdate").GetString() ?? "unknown";
            var text = "";
            if (update.TryGetProperty("content", out var content) &&
                content.TryGetProperty("text", out var textEl))
                text = textEl.GetString() ?? "";
            return (kind, text);
        }
        catch
        {
            return ("other", "");
        }
    }

    public void Dispose()
    {
        try
        {
            if (_proc is { HasExited: false })
            {
                Process.Start(new ProcessStartInfo("taskkill", $"/PID {_proc.Id} /T /F") { CreateNoWindow = true });
            }
        }
        catch { }
        _proc = null;
    }
}
