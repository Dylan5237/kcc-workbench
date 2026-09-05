using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Arckeep.Shell;

/// <summary>
/// cdesktop（Claude Code 视觉工作面，D0-01 决策 REUSE_CDESKTOP）的 start/attach 集成缝。
/// 模式与 DshService 对齐：attach 优先（端口文件 + /api/health 验明正身），缺席时才启动
/// Arckeep 自有进程；ready 信号用真实 health RPC，不靠固定 sleep。
/// 已验证事实（docs/reuse/D0-01-claude-surface-reuse-gate.md）：
///   - 二进制：~/.cdesktop/bin/v0.2.3-20260519022845/windows-x64/cdesktop.exe（npm cdesktop@0.2.3 首启下载）
///   - PORT=0 自动分配；stdout 打印 "Main server on :NNNN"；端口文件 %TEMP%/cdesktop/cdesktop.port
///   - GET /api/health → { success: true }
///   - 冷启动会自动打开外部浏览器，无已验证的 no-open 开关（D0 登记为 limitation，不 fork/patch）
/// </summary>
internal sealed class CdesktopService : IDisposable
{
    /// <summary>D0-01 验收的精确二进制 tag。</summary>
    public const string BinaryTag = "v0.2.3-20260519022845";

    private static readonly Regex MainServerLine = new(@"Main server on :(\d+)", RegexOptions.Compiled);

    private readonly SemaphoreSlim _gate = new(1, 1);   // StartAsync 串行化（rebind 与 Open 并发安全）
    private Process? _proc;

    /// <summary>显式 workspace 绑定结果：只有 ensure 成功才存在（R2-3）。</summary>
    public sealed record CdesktopWorkspaceBinding(string Root, string WorkspaceId, string WorkspaceUrl, string TargetBranch);

    public enum Ownership { None, Attached, Owned }

    public string? OpenUrl { get; private set; }
    public Ownership Mode { get; private set; } = Ownership.None;
    public Exception? Failure { get; private set; }

    /// <summary>当前项目根的 workspace 绑定；null = 未绑定（服务健康 ≠ 绑定成功）。</summary>
    public CdesktopWorkspaceBinding? Binding { get; private set; }

    /// <summary>兼容读取：绑定中的 workspace id。</summary>
    public string? WorkspaceId => Binding?.WorkspaceId;

    /// <summary>兼容读取：绑定中的 workspace 页面路由。</summary>
    public string? WorkspaceUrl => Binding?.WorkspaceUrl;

    /// <summary>兼容读取：绑定使用的 target_branch。</summary>
    public string? LastTargetBranch => Binding?.TargetBranch;

    /// <summary>workspace 绑定失败的诊断（服务本身可能仍健康；两状态不混）。</summary>
    public string? WorkspaceError { get; private set; }

    /// <summary>自有模式下的子进程 PID（诊断/看门狗用；attached 模式恒为 null）。</summary>
    public int? OwnedProcessId => Mode == Ownership.Owned && _proc is { HasExited: false } ? _proc.Id : null;

    /// <summary>
    /// attach 优先：读 %TEMP%/cdesktop/cdesktop.port 拿 main_port，/api/health 验明正身后复用；
    /// 没有再启动 Arckeep 自有实例（PORT=0 由 OS 分配，不与用户实例争端口）。
    /// 服务失败不抛出到壳层：写入 Failure，返回 null。
    /// 服务就绪后对 cwd 做显式 workspace 绑定（BindWorkspaceSafeAsync）；
    /// 绑定失败只置 WorkspaceError + Binding=null，绝不让旧 root 的 WorkspaceId 被解释成新 root 的（R2-3）。
    /// </summary>
    public async Task<string?> StartAsync(string cwd, TimeSpan? timeout = null)
    {
        await _gate.WaitAsync();
        try
        {
            if (OpenUrl is not null && (Mode == Ownership.Attached || _proc is { HasExited: false }))
            {
                await BindWorkspaceSafeAsync(cwd);
                return OpenUrl;
            }

            var attached = await TryAttachAsync();
            if (attached is not null)
            {
                Mode = Ownership.Attached;
                OpenUrl = attached;
                Program.Log($"cdesktop 复用用户已有实例 {attached}");
                await BindWorkspaceSafeAsync(cwd);
                return OpenUrl;
            }

            try
            {
                await SpawnAndWaitReadyAsync(cwd, timeout ?? TimeSpan.FromSeconds(60));
            }
            catch (Exception ex)
            {
                // spawned-but-not-ready 也必须清理：任何 post-spawn 失败返回前，
                // 先机械终止 Arckeep 已创建的进程树（不依赖调用方再 Dispose）
                TerminateOwned();
                Failure = ex;
                Program.Log("cdesktop 启动失败：" + ex.Message);
                return null;
            }
            await BindWorkspaceSafeAsync(cwd);
            return OpenUrl;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>端口文件路径（ARCKEEP_CDESKTOP_PORT_FILE 仅供测试钩子重定向）。</summary>
    private static string PortFilePath() =>
        Environment.GetEnvironmentVariable("ARCKEEP_CDESKTOP_PORT_FILE")
        ?? Path.Combine(Path.GetTempPath(), "cdesktop", "cdesktop.port");

    /// <summary>
    /// 从端口文件发现用户已有 cdesktop 实例并用 /api/health 验明正身。
    /// 端口文件陈旧（进程已死）时 health 失败，自然落到 owned 启动。
    /// </summary>
    public static async Task<string?> TryAttachAsync()
    {
        int? port = null;
        try
        {
            var raw = (await File.ReadAllTextAsync(PortFilePath())).Trim();
            try
            {
                using var doc = JsonDocument.Parse(raw);
                if (doc.RootElement.TryGetProperty("main_port", out var p) && p.ValueKind == JsonValueKind.Number)
                    port = p.GetInt32();
            }
            catch
            {
                if (int.TryParse(raw, out var bare)) port = bare;
            }
        }
        catch
        {
            return null;   // 端口文件不存在 = 没有可 attach 的实例
        }
        if (port is null or <= 0 or > 65535) return null;

        var origin = $"http://127.0.0.1:{port}";
        return await HealthOkAsync(origin, TimeSpan.FromSeconds(3)) ? origin + "/" : null;
    }

    /// <summary>正向健康证据：GET /api/health → 200 且 success=true（cdesktop 专有形状）。</summary>
    public static async Task<bool> HealthOkAsync(string origin, TimeSpan timeout)
    {
        try
        {
            using var http = new HttpClient { Timeout = timeout };
            var res = await http.GetAsync($"{origin}/api/health");
            if (!res.IsSuccessStatusCode) return false;
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            return doc.RootElement.TryGetProperty("success", out var ok) && ok.GetBoolean();
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// 二进制解析：CDESKTOP_BIN 覆盖（与 spike 探针同约定）→ 精确 tag 路径 →
    /// ~/.cdesktop/bin 下任意已下载版本（按目录名取最新）→ 未安装。
    /// </summary>
    private static string ResolveBinary()
    {
        var overridePath = Environment.GetEnvironmentVariable("CDESKTOP_BIN");
        if (!string.IsNullOrEmpty(overridePath))
        {
            if (File.Exists(overridePath)) return overridePath;
            throw new FileNotFoundException("CDESKTOP_BIN 指向的 cdesktop 不存在：" + overridePath);
        }
        var binRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".cdesktop", "bin");
        var exact = Path.Combine(binRoot, BinaryTag, "windows-x64", "cdesktop.exe");
        if (File.Exists(exact)) return exact;
        if (Directory.Exists(binRoot))
        {
            var candidate = Directory.GetDirectories(binRoot)
                .OrderByDescending(d => d, StringComparer.OrdinalIgnoreCase)
                .Select(d => Path.Combine(d, "windows-x64", "cdesktop.exe"))
                .FirstOrDefault(File.Exists);
            if (candidate is not null) return candidate;
        }
        throw new FileNotFoundException(
            "未找到 cdesktop 二进制（" + exact + "）。请先运行一次 npx cdesktop@0.2.3 完成下载。");
    }

    private async Task SpawnAndWaitReadyAsync(string cwd, TimeSpan timeout)
    {
        var binary = ResolveBinary();
        var psi = new ProcessStartInfo
        {
            FileName = binary,
            Arguments = "",
            WorkingDirectory = cwd,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = new UTF8Encoding(false),
            StandardErrorEncoding = new UTF8Encoding(false),
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        psi.Environment["PORT"] = "0";              // OS 分配，不与用户实例争端口
        psi.Environment["HOST"] = "127.0.0.1";
        var spawnedAt = DateTime.UtcNow;
        _proc = Process.Start(psi) ?? throw new InvalidOperationException("cdesktop 无法启动");
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
        int? port = null;
        while (DateTime.UtcNow < deadline)
        {
            string text;
            lock (sync) text = sb.ToString();
            var m = MainServerLine.Match(text);
            if (m.Success) { port = int.Parse(m.Groups[1].Value); break; }
            // 辅助通道：本次启动后新写入的端口文件（避免误读陈旧文件）
            port = ReadFreshPortFile(spawnedAt);
            if (port is not null) break;
            if (_proc.HasExited) break;
            await Task.Delay(200);
        }
        if (port is null)
        {
            string tail;
            lock (sync) tail = sb.ToString();
            throw new TimeoutException("cdesktop 启动超时：" + tail[^Math.Min(400, tail.Length)..]);
        }

        var origin = $"http://127.0.0.1:{port}";
        while (DateTime.UtcNow < deadline)
        {
            if (await HealthOkAsync(origin, TimeSpan.FromSeconds(3))) { OpenUrl = origin + "/"; break; }
            if (_proc.HasExited) break;
            await Task.Delay(400);
        }
        if (OpenUrl is null) throw new TimeoutException("cdesktop readiness 超时：" + origin);
        Program.Log($"cdesktop 已启动（Arckeep 自有）{OpenUrl}");
    }

    private static int? ReadFreshPortFile(DateTime spawnedAt)
    {
        try
        {
            var path = PortFilePath();
            if (!File.Exists(path)) return null;
            if (File.GetLastWriteTimeUtc(path) < spawnedAt.AddSeconds(-2)) return null;
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            if (doc.RootElement.TryGetProperty("main_port", out var p) && p.ValueKind == JsonValueKind.Number)
                return p.GetInt32();
        }
        catch { }
        return null;
    }

    /// <summary>
    /// workspace 绑定（fail-closed）：先清空旧 Binding（旧 root 的 id 不得再被解释成新 root 的），
    /// ensure 成功才产生新 Binding；失败只置 WorkspaceError。绑定失败 ≠ 服务失败。
    /// </summary>
    private async Task BindWorkspaceSafeAsync(string projectRoot)
    {
        if (Binding is not null && SamePath(Binding.Root, projectRoot)) return;
        Binding = null;
        WorkspaceError = null;
        try
        {
            Binding = await EnsureWorkspaceAsync(projectRoot);
            WorkspaceError = null;
        }
        catch (Exception ex)
        {
            Binding = null;
            WorkspaceError = ex.Message;
            Program.Log("cdesktop workspace 绑定失败（服务仍健康）：" + ex.Message);
        }
    }

    /// <summary>
    /// 用 cdesktop 既有概念把项目根打开/创建为一个 workspace（普通目录模式，
    /// use_worktree=false，不引入 Team/Worktree 域）。幂等：repo 按路径复用，
    /// workspace 按 arckeep 命名约定复用。成功返回显式 Binding。
    /// </summary>
    private async Task<CdesktopWorkspaceBinding> EnsureWorkspaceAsync(string projectRoot)
    {
        if (OpenUrl is null) throw new InvalidOperationException("cdesktop 未就绪");
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        var baseUrl = OpenUrl.TrimEnd('/');
        var projectName = new DirectoryInfo(projectRoot.TrimEnd(Path.DirectorySeparatorChar)).Name;
        var workspaceName = "arckeep-" + Sanitize(projectName) + "-" + ShortHash(projectRoot);

        // repo：按真实路径复用，否则注册；保留上游探测的 default_target_branch
        string? repoId = null;
        string? defaultTargetBranch = null;
        using (var reposDoc = JsonDocument.Parse(await http.GetStringAsync(baseUrl + "/api/repos")))
        {
            if (reposDoc.RootElement.TryGetProperty("data", out var repos) && repos.ValueKind == JsonValueKind.Array)
                foreach (var r in repos.EnumerateArray())
                    if (r.TryGetProperty("path", out var p) && SamePath(p.GetString(), projectRoot)
                        && r.TryGetProperty("id", out var id))
                    {
                        repoId = id.GetString();
                        if (r.TryGetProperty("default_target_branch", out var db) && db.ValueKind == JsonValueKind.String)
                            defaultTargetBranch = db.GetString();
                    }
        }
        if (repoId is null)
        {
            var created = await PostJsonAsync(http, baseUrl + "/api/repos",
                new { path = projectRoot, display_name = projectName });
            repoId = created.GetProperty("data").GetProperty("id").GetString();
            if (created.GetProperty("data").TryGetProperty("default_target_branch", out var db)
                && db.ValueKind == JsonValueKind.String)
                defaultTargetBranch = db.GetString();
        }

        // target_branch 是必填字段（422 when omitted，实测）：优先上游探测值，
        // 否则用项目当前 git 分支（不假定 main），非 git 项目回退 main（is_git=false 时该值不被使用）。
        var targetBranch = !string.IsNullOrEmpty(defaultTargetBranch) ? defaultTargetBranch!
            : TryCurrentGitBranch(projectRoot) ?? "main";

        // workspace：按命名约定复用，否则创建并挂载 repo
        string? workspaceId = null;
        using (var wsDoc = JsonDocument.Parse(await http.GetStringAsync(baseUrl + "/api/workspaces")))
        {
            if (wsDoc.RootElement.TryGetProperty("data", out var list) && list.ValueKind == JsonValueKind.Array)
                foreach (var w in list.EnumerateArray())
                    if (w.TryGetProperty("name", out var n) && n.GetString() == workspaceName
                        && w.TryGetProperty("id", out var id))
                        workspaceId = id.GetString();
        }
        if (workspaceId is null)
        {
            var created = await PostJsonAsync(http, baseUrl + "/api/workspaces",
                new { name = workspaceName, use_worktree = false });
            workspaceId = created.GetProperty("data").GetProperty("id").GetString();
            await PostJsonAsync(http, baseUrl + $"/api/workspaces/{workspaceId}/repos",
                new { repo_id = repoId, target_branch = targetBranch });
        }
        var binding = new CdesktopWorkspaceBinding(
            projectRoot, workspaceId!, $"{baseUrl}/workspaces/{workspaceId}", targetBranch);
        Program.Log($"cdesktop workspace 绑定：{workspaceName} ({workspaceId}) target_branch={targetBranch}");
        return binding;
    }

    /// <summary>读项目当前 git 分支；非 git 仓库/失败返回 null（不引入 git workflow，只读事实）。</summary>
    private static string? TryCurrentGitBranch(string projectRoot)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "git",
                Arguments = "rev-parse --abbrev-ref HEAD",
                WorkingDirectory = projectRoot,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var proc = Process.Start(psi);
            if (proc is null) return null;
            var branch = proc.StandardOutput.ReadToEnd().Trim();
            proc.WaitForExit(5000);
            return proc.ExitCode == 0 && branch.Length > 0 && branch != "HEAD" ? branch : null;
        }
        catch { return null; }
    }

    private static async Task<JsonElement> PostJsonAsync(HttpClient http, string url, object body)
    {
        var res = await http.PostAsync(url,
            new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"));
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException($"POST {url} → {(int)res.StatusCode}: {text[..Math.Min(200, text.Length)]}");
        var doc = JsonDocument.Parse(text);
        return doc.RootElement.Clone();
    }

    private static string Sanitize(string name)
    {
        var chars = name.Select(c => char.IsLetterOrDigit(c) ? c : '-').ToArray();
        var s = new string(chars).Trim('-');
        return s.Length > 0 ? s : "project";
    }

    private static string ShortHash(string path)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(
            Encoding.UTF8.GetBytes(Path.GetFullPath(path).ToUpperInvariant()));
        return Convert.ToHexString(bytes)[..8].ToLowerInvariant();
    }

    private static bool SamePath(string? left, string? right) =>
        string.Equals(
            left is null ? null : Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar),
            right is null ? null : Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar),
            StringComparison.OrdinalIgnoreCase);

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
                Process.Start(new ProcessStartInfo("taskkill", $"/PID {_proc.Id} /T /F") { CreateNoWindow = true })
                    ?.WaitForExit(10000);
                _proc.WaitForExit(10000);
            }
        }
        catch { }
        _proc = null;
        OpenUrl = null;
        Mode = Ownership.None;
        Binding = null;
        WorkspaceError = null;
    }

    /// <summary>只清理 Arckeep 明确创建并拥有的进程树；attach 的用户实例绝不动。</summary>
    public void Dispose()
    {
        if (Mode == Ownership.Owned) TerminateOwned();
        else { _proc = null; OpenUrl = null; Mode = Ownership.None; }
    }
}
