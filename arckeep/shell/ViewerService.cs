using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;

namespace Arckeep.Shell;

/// <summary>
/// KCC Viewer sidecar 桥（D0-04）。以独立 Node 进程原样复用 src/viewer/server.cjs：
/// stdout 握手拿随机端口 + 一次性 token，stdin 控制通道（JSON 行，id 关联）同步项目根目录。
/// Viewer 是独立进程：它挂掉只影响 Viewer 表面，不影响 Kimi/ACP 工作面（故障隔离）。
/// </summary>
internal sealed class ViewerService : IDisposable
{
    private Process? _proc;
    private readonly object _sync = new();
    private readonly Dictionary<long, TaskCompletionSource<JsonObject>> _pending = new();
    private long _nextId;
    private TaskCompletionSource<JsonObject>? _readyTcs;

    /// <summary>含 ?token= 的启动地址；GET 后服务端 302 并种 HttpOnly cookie。</summary>
    public string? ViewerUrl { get; private set; }
    public string? CurrentRoot { get; private set; }
    public Exception? Failure { get; set; }
    /// <summary>仅供测试钩子定位 sidecar 进程。</summary>
    internal int? SidecarPid => _proc is { HasExited: false } ? _proc.Id : null;

    /// <summary>确保 Viewer sidecar 以指定项目根运行；根不同则经控制通道同步（V3）。</summary>
    public async Task<string> EnsureStartedAsync(string projectRoot, TimeSpan? timeout = null)
    {
        if (_proc is { HasExited: false } && ViewerUrl is not null)
        {
            if (!SamePath(CurrentRoot, projectRoot))
                await SetProjectRootAsync(projectRoot);
            return ViewerUrl;
        }
        StopProcess();
        await SpawnAsync(projectRoot, timeout ?? TimeSpan.FromSeconds(30));
        return ViewerUrl!;
    }

    /// <summary>仅当 sidecar 已在运行时同步根目录；未运行则留待首次打开时以当前项目启动。</summary>
    public async Task SyncRootAsync(string projectRoot)
    {
        if (_proc is { HasExited: false } && ViewerUrl is not null && !SamePath(CurrentRoot, projectRoot))
            await SetProjectRootAsync(projectRoot);
    }

    private async Task SpawnAsync(string projectRoot, TimeSpan timeout)
    {
        var entry = FindEntry();
        var configDir = Path.Combine(ProjectStore.ArckeepDataDir, "viewer");
        Directory.CreateDirectory(configDir);

        _readyTcs = new TaskCompletionSource<JsonObject>(TaskCreationOptions.RunContinuationsAsynchronously);
        var psi = new ProcessStartInfo
        {
            FileName = "node",
            Arguments = $"\"{entry}\" --config-dir \"{configDir}\" --root \"{projectRoot}\"",
            WorkingDirectory = Path.GetDirectoryName(entry)!,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = new UTF8Encoding(false),
            StandardErrorEncoding = new UTF8Encoding(false),
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        try
        {
            _proc = Process.Start(psi) ?? throw new InvalidOperationException("Viewer sidecar 无法启动");
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException("Viewer sidecar 需要 Node.js 在 PATH 中：" + ex.Message, ex);
        }

        PumpStdout(_proc);
        PumpStderr(_proc);

        var done = await Task.WhenAny(_readyTcs.Task, Task.Delay(timeout));
        if (done != _readyTcs.Task)
        {
            if (_proc.HasExited) throw new InvalidOperationException($"Viewer sidecar 提前退出（exit {_proc.ExitCode}）");
            throw new TimeoutException("Viewer sidecar 握手超时");
        }
        var ready = await _readyTcs.Task;
        var port = ready["port"]!.GetValue<int>();
        var token = ready["token"]!.GetValue<string>();
        CurrentRoot = ready["root"]?.GetValue<string>() ?? projectRoot;
        ViewerUrl = $"http://127.0.0.1:{port}/?token={token}";
        Program.Log($"viewer sidecar 就绪 :{port} root={CurrentRoot}");
    }

    private async Task SetProjectRootAsync(string projectRoot)
    {
        var response = await SendCommandAsync(new JsonObject
        {
            ["type"] = "set-root",
            ["root"] = projectRoot,
        });
        if (response["ok"]?.GetValue<bool>() != true)
            throw new InvalidOperationException("Viewer 拒绝项目根目录：" + (response["error"]?.GetValue<string>() ?? projectRoot));
        CurrentRoot = response["root"]?.GetValue<string>() ?? projectRoot;
        Program.Log($"viewer 项目根已同步：{CurrentRoot}");
    }

    private Task<JsonObject> SendCommandAsync(JsonObject command)
    {
        if (_proc is not { HasExited: false }) throw new InvalidOperationException("Viewer sidecar 未运行");
        var id = ++_nextId;
        command["id"] = id;
        var tcs = new TaskCompletionSource<JsonObject>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_sync) _pending[id] = tcs;
        _proc.StandardInput.WriteLine(command.ToJsonString());
        _proc.StandardInput.Flush();
        return tcs.Task.WaitAsync(TimeSpan.FromSeconds(10));
    }

    private void PumpStdout(Process proc) => _ = Task.Run(async () =>
    {
        try
        {
            string? line;
            while ((line = await proc.StandardOutput.ReadLineAsync()) is not null)
            {
                JsonObject? message = null;
                try { message = JsonNode.Parse(line) as JsonObject; } catch { }
                if (message is null) continue;
                if (message["type"]?.GetValue<string>() == "ready")
                    _readyTcs?.TrySetResult(message);
                else if (message["id"]?.GetValue<long>() is { } id)
                {
                    TaskCompletionSource<JsonObject>? tcs = null;
                    lock (_sync) if (_pending.Remove(id, out var found)) tcs = found;
                    tcs?.TrySetResult(message);
                }
            }
        }
        catch { }
        // stdout 结束 = sidecar 退出：让挂起的请求失败，而不是永久等待
        lock (_sync)
        {
            foreach (var tcs in _pending.Values) tcs.TrySetException(new InvalidOperationException("Viewer sidecar 已退出"));
            _pending.Clear();
        }
        _readyTcs?.TrySetException(new InvalidOperationException("Viewer sidecar 在握手前退出"));
    });

    private static void PumpStderr(Process proc) => _ = Task.Run(async () =>
    {
        try
        {
            string? line;
            while ((line = await proc.StandardError.ReadLineAsync()) is not null)
                Program.Log("viewer sidecar: " + line);
        }
        catch { }
    });

    private static string FindEntry()
    {
        // 发布布局：BaseDirectory = <repo>/arckeep/shell/bin/Release/net7.0-windows/
        var fromBase = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "viewer", "standalone.cjs"));
        if (File.Exists(fromBase)) return fromBase;
        // 开发布局：在仓库根直接 dotnet run
        var fromCwd = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "src", "viewer", "standalone.cjs"));
        if (File.Exists(fromCwd)) return fromCwd;
        throw new FileNotFoundException("未找到 src/viewer/standalone.cjs（Arckeep 需要在 kcc-workbench 仓库内运行）");
    }

    private static bool SamePath(string? left, string? right) =>
        string.Equals(
            left is null ? null : Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar),
            right is null ? null : Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar),
            StringComparison.OrdinalIgnoreCase);

    private void StopProcess()
    {
        var proc = _proc;
        _proc = null;
        ViewerUrl = null;
        CurrentRoot = null;
        if (proc is null) return;
        try
        {
            if (!proc.HasExited)
            {
                try { proc.StandardInput.WriteLine("{\"type\":\"shutdown\"}"); proc.StandardInput.Flush(); } catch { }
                if (!proc.WaitForExit(1500))
                    Process.Start(new ProcessStartInfo("taskkill", $"/PID {proc.Id} /T /F") { CreateNoWindow = true });
            }
        }
        catch { }
    }

    public void Dispose()
    {
        StopProcess();
        lock (_sync)
        {
            foreach (var tcs in _pending.Values) tcs.TrySetCanceled();
            _pending.Clear();
        }
    }
}
