using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.WinForms;

namespace Arckeep.Shell;

/// <summary>
/// D0-03 真实验证钩子（只在对应环境变量设置时激活，正常启动零开销）。
///
/// ARCKEEP_TEST_SWITCH=1：冷启动 → 设定项目（ARCKEEP_TEST_PROJECT）→
///   Project→Kimi→Claude→DSH→Viewer→Claude→Kimi→DSH→Project 全序列；
///   每个工作面注入 window.__arckeepMark + 记录 performance.timeOrigin，
///   回访时标记/timeOrigin 不变 = 未 reload（V1/V2/V4）；
///   Claude 加载后经 cdesktop 真实 API 创建 session + follow-up，切走切回后同 session 续跑（V3）；
///   最后记录 ownership 矩阵（V8 由外部探针核对 PID 存亡）。
///   ARCKEEP_TEST_SHUTDOWN=1 时走真实 Form.Close() 关闭路径（FormClosed → Dispose 各自有进程）。
///
/// ARCKEEP_TEST_FAIL=claude|dsh：强制对应服务真实失败（cdesktop 用 CDESKTOP_BIN +
///   ARCKEEP_CDESKTOP_PORT_FILE 指向不存在路径；DSH 由外部探针在 PATH 前置假 dsh.cmd +
///   ARCKEEP_DSH_ATTACH_AUTHORITY 指向空端口），验证其余工作面仍可真实切换（V7）。
///
/// 证据写出到 ARCKEEP_TEST_OUT（默认 %APPDATA%/Arckeep/d0-03-proof.json），
/// 进程退出码经 Environment.ExitCode + 真实 Close() 传递（0=通过，3=证据失败，4=异常）。
/// </summary>
internal sealed partial class ShellWindow
{
    private static string ProofOutPath() =>
        Environment.GetEnvironmentVariable("ARCKEEP_TEST_OUT")
        ?? Path.Combine(ProjectStore.ArckeepDataDir, "d0-03-proof.json");

    /// <summary>写证据 → 设退出码 → 真实 Close()（走 FormClosed 关机语义，不 Environment.Exit）。</summary>
    private async Task FinishProofAsync(JsonObject proof, bool ok)
    {
        try
        {
            await File.WriteAllTextAsync(ProofOutPath(), proof.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            Program.Log("d0-03 proof: " + ProofOutPath());
        }
        catch (Exception ex) { Program.Log("d0-03 proof 写出失败：" + ex.Message); }
        Environment.ExitCode = ok ? 0 : 3;
        await this.InvokeAsync(() => { Close(); return Task.CompletedTask; });
    }

    /// <summary>等待某工作面 WebView2 真实导航到其 loopback 服务；服务失败则提前判负。</summary>
    private async Task<bool> WaitSurfaceLoadedAsync(WebView2 view, Func<Exception?> failure, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (failure() is not null) return false;
            var href = await this.InvokeAsync(async () =>
                JsonSerializer.Deserialize<string>(
                    await view.CoreWebView2.ExecuteScriptAsync("location.href")) ?? "");
            if (href.StartsWith("http://127.0.0.1")) return true;
            await Task.Delay(500);
        }
        return false;
    }

    /// <summary>注入持久标记（已存在则保留）并采集 timeOrigin：回访对比证明未 reload。</summary>
    private async Task<JsonObject?> ProbeSurfaceAsync(WebView2 view)
    {
        var candidate = Guid.NewGuid().ToString("N")[..8];
        var raw = await this.InvokeAsync(async () =>
            await view.CoreWebView2.ExecuteScriptAsync(
                $"window.__arckeepMark = window.__arckeepMark || '{candidate}';" +
                "JSON.stringify({mark: window.__arckeepMark, t0: Math.round(performance.timeOrigin)," +
                " href: location.href, title: document.title, ready: document.readyState})"));
        var inner = JsonSerializer.Deserialize<string>(raw);
        if (inner is null) return null;
        try { return JsonNode.Parse(inner) as JsonObject; }
        catch { return null; }
    }

    private static bool SameSurface(JsonObject? first, JsonObject? second) =>
        first is not null && second is not null
        && first["mark"]?.GetValue<string>() == second["mark"]?.GetValue<string>()
        && first["t0"]?.GetValue<long>() == second["t0"]?.GetValue<long>();

    private async Task<bool> ProjectUiAliveAsync()
    {
        var raw = await this.InvokeAsync(async () =>
            await _uiView.CoreWebView2.ExecuteScriptAsync("document.getElementById('app')?'alive':'dead'"));
        return raw.Contains("alive");
    }

    // ---------- V1+V2+V3+V4：多工作面真实切换主序列 ----------

    private async Task RunSurfaceSwitchTestAsync()
    {
        var proof = new JsonObject();
        var ok = true;
        try
        {
            await Task.Delay(2500);
            var projectDir = Environment.GetEnvironmentVariable("ARCKEEP_TEST_PROJECT") ?? "";
            if (!Directory.Exists(projectDir)) throw new Exception("ARCKEEP_TEST_PROJECT 无效：" + projectDir);

            // V1：项目 UI 已可用时，任何外部服务都尚未启动（主窗口不等待外部 surface）
            var v1 = new JsonObject
            {
                ["projectUiAlive"] = await ProjectUiAliveAsync(),
                ["elapsedMsSinceShown"] = (DateTime.UtcNow - _shownAt).TotalMilliseconds,
                ["kimiNotStarted"] = _kimiWeb.OpenUrl is null,
                ["claudeNotStarted"] = _cdesktop.OpenUrl is null && _cdesktop.Mode == CdesktopService.Ownership.None,
                ["dshNotStarted"] = _dsh.OpenUrl is null && _dsh.Mode == DshService.Ownership.None,
                ["viewerNotStarted"] = _viewer.ViewerUrl is null,
            };
            proof["v1"] = v1;
            ok &= v1["projectUiAlive"]!.GetValue<bool>()
               && v1["kimiNotStarted"]!.GetValue<bool>() && v1["claudeNotStarted"]!.GetValue<bool>()
               && v1["dshNotStarted"]!.GetValue<bool>() && v1["viewerNotStarted"]!.GetValue<bool>();

            await this.InvokeAsync(() => { SetProject(projectDir); return Task.CompletedTask; });

            // 首次到访：Project → Kimi → Claude → DSH → Viewer
            var first = new JsonObject();
            await SwitchToAsync(Workspace.Kimi);
            ok &= await WaitSurfaceLoadedAsync(_agentView, () => _kimiWeb.Failure, TimeSpan.FromSeconds(90));
            first["kimi"] = await ProbeSurfaceAsync(_agentView);

            await SwitchToAsync(Workspace.Claude);
            ok &= await WaitSurfaceLoadedAsync(_claudeView, () => _cdesktop.Failure, TimeSpan.FromSeconds(120));
            first["claude"] = await ProbeSurfaceAsync(_claudeView);

            // V3 前半：真实 Claude session（当前项目根的 cdesktop workspace 内）
            var v3 = await ClaudeSessionProbeAsync("arckeep-d0-03-claude-ok");
            proof["v3_first"] = v3;

            await SwitchToAsync(Workspace.Dsh);
            ok &= await WaitSurfaceLoadedAsync(_dshView, () => _dsh.Failure, TimeSpan.FromSeconds(120));
            first["dsh"] = await ProbeSurfaceAsync(_dshView);

            await SwitchToAsync(Workspace.Viewer);
            ok &= await WaitSurfaceLoadedAsync(_viewerView, () => _viewer.Failure, TimeSpan.FromSeconds(60));
            first["viewer"] = await ProbeSurfaceAsync(_viewerView);
            proof["first"] = first;

            // 回访：Viewer → Claude → Kimi → DSH → Project（标记/timeOrigin 不变 = 未 reload）
            var second = new JsonObject();
            await SwitchToAsync(Workspace.Claude);
            second["claude"] = await ProbeSurfaceAsync(_claudeView);

            // V3 后半：切走切回后同 session 续跑
            proof["v3_resume"] = await ClaudeSessionResumeAsync(v3);

            await SwitchToAsync(Workspace.Kimi);
            second["kimi"] = await ProbeSurfaceAsync(_agentView);
            await SwitchToAsync(Workspace.Dsh);
            second["dsh"] = await ProbeSurfaceAsync(_dshView);
            await SwitchToAsync(Workspace.Project);
            proof["projectAliveAtEnd"] = await ProjectUiAliveAsync();
            proof["second"] = second;

            var persistence = new JsonObject
            {
                ["claudeNoReload"] = SameSurface(first["claude"] as JsonObject, second["claude"] as JsonObject),
                ["kimiNoReload"] = SameSurface(first["kimi"] as JsonObject, second["kimi"] as JsonObject),
                ["dshNoReload"] = SameSurface(first["dsh"] as JsonObject, second["dsh"] as JsonObject),
            };
            proof["persistence"] = persistence;
            ok &= persistence["claudeNoReload"]!.GetValue<bool>()
               && persistence["kimiNoReload"]!.GetValue<bool>()
               && persistence["dshNoReload"]!.GetValue<bool>()
               && proof["projectAliveAtEnd"]!.GetValue<bool>();

            // V3 判定：首轮完成 + 续跑完成
            ok &= v3?["status"]?.GetValue<string>() == "completed"
               && (proof["v3_resume"] as JsonObject)?["status"]?.GetValue<string>() == "completed";

            // V8 输入：ownership 矩阵（进程存亡由外部探针在退出后核对）
            proof["matrix"] = new JsonObject
            {
                ["kimi"] = new JsonObject { ["url"] = _kimiWeb.OpenUrl, ["ownedPid"] = _kimiWeb.OwnedPid },
                ["claude"] = new JsonObject
                {
                    ["mode"] = _cdesktop.Mode.ToString(), ["url"] = _cdesktop.OpenUrl,
                    ["ownedPid"] = _cdesktop.OwnedProcessId,
                    ["workspaceId"] = _cdesktop.WorkspaceId, ["workspaceError"] = _cdesktop.WorkspaceError,
                },
                ["dsh"] = new JsonObject
                {
                    ["mode"] = _dsh.Mode.ToString(), ["url"] = _dsh.OpenUrl, ["ownedPid"] = _dsh.OwnedProcessId,
                },
                ["viewer"] = new JsonObject { ["url"] = _viewer.ViewerUrl, ["ownedPid"] = _viewer.SidecarPid },
            };
        }
        catch (Exception ex)
        {
            Program.Log("d0-03 switch-test 异常：" + ex);
            proof["error"] = ex.ToString();
            ok = false;
            Environment.ExitCode = 4;
        }
        await FinishProofAsync(proof, ok && Environment.ExitCode != 4);
    }

    // ---------- V3：真实 Claude session 创建/续跑（cdesktop 既有 API，非 mock） ----------

    private async Task<JsonObject?> ClaudeSessionProbeAsync(string token)
    {
        if (_cdesktop.OpenUrl is null) return new JsonObject { ["skipped"] = "cdesktop 未就绪" };
        if (_cdesktop.WorkspaceId is null)
            return new JsonObject { ["skipped"] = "workspace 确保失败", ["workspaceError"] = _cdesktop.WorkspaceError };
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
            var baseUrl = _cdesktop.OpenUrl.TrimEnd('/');
            var sess = await PostJsonAsync(http, baseUrl + "/api/sessions",
                new { workspace_id = _cdesktop.WorkspaceId, executor = "CLAUDE_CODE", name = "arckeep-d0-03-v3" });
            var sessionId = sess.GetProperty("data").GetProperty("id").GetString();
            var (processId, status) = await ClaudeFollowUpAsync(http, baseUrl, sessionId!,
                $"Reply with exactly the token: {token}. Nothing else.");
            return new JsonObject
            {
                ["workspaceId"] = _cdesktop.WorkspaceId, ["sessionId"] = sessionId,
                ["processId"] = processId, ["status"] = status,
            };
        }
        catch (Exception ex)
        {
            Program.Log("d0-03 claude session probe 异常：" + ex.Message);
            return new JsonObject { ["error"] = ex.Message };
        }
    }

    private async Task<JsonObject?> ClaudeSessionResumeAsync(JsonObject? first)
    {
        var sessionId = first?["sessionId"]?.GetValue<string>();
        if (sessionId is null || _cdesktop.OpenUrl is null)
            return new JsonObject { ["skipped"] = "无首轮 session" };
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
            var (processId, status) = await ClaudeFollowUpAsync(http, _cdesktop.OpenUrl.TrimEnd('/'), sessionId,
                "Reply with exactly the token: arckeep-d0-03-resume-ok. Nothing else.");
            return new JsonObject { ["sessionId"] = sessionId, ["processId"] = processId, ["status"] = status };
        }
        catch (Exception ex)
        {
            return new JsonObject { ["sessionId"] = sessionId, ["error"] = ex.Message };
        }
    }

    private static async Task<(string? ProcessId, string Status)> ClaudeFollowUpAsync(
        HttpClient http, string baseUrl, string sessionId, string prompt)
    {
        var run = await PostJsonAsync(http, baseUrl + $"/api/sessions/{sessionId}/follow-up", new
        {
            prompt,
            executor_config = new { executor = "CLAUDE_CODE" },
        });
        var processId = run.GetProperty("data").GetProperty("id").GetString();
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(180);
        while (DateTime.UtcNow < deadline)
        {
            await Task.Delay(3000);
            using var doc = JsonDocument.Parse(
                await http.GetStringAsync(baseUrl + $"/api/execution-processes/{processId}"));
            var status = doc.RootElement.GetProperty("data").TryGetProperty("status", out var s)
                ? s.GetString() ?? "unknown" : "unknown";
            if (status is "completed" or "failed" or "killed") return (processId, status);
        }
        return (processId, "timeout");
    }

    private static async Task<JsonElement> PostJsonAsync(HttpClient http, string url, object body)
    {
        var res = await http.PostAsync(url,
            new StringContent(JsonSerializer.Serialize(body), System.Text.Encoding.UTF8, "application/json"));
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException($"POST {url} → {(int)res.StatusCode}: {text[..Math.Min(200, text.Length)]}");
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.Clone();
    }

    // ---------- V7：故障隔离（一个工作面真实失败，其余必须可用） ----------

    private async Task RunFailureIsolationTestAsync(string failTarget)
    {
        var proof = new JsonObject { ["failTarget"] = failTarget };
        var ok = true;
        try
        {
            await Task.Delay(2500);
            var projectDir = Environment.GetEnvironmentVariable("ARCKEEP_TEST_PROJECT") ?? "";
            if (!Directory.Exists(projectDir)) throw new Exception("ARCKEEP_TEST_PROJECT 无效：" + projectDir);
            await this.InvokeAsync(() => { SetProject(projectDir); return Task.CompletedTask; });

            // 触发目标工作面的真实失败路径
            Exception? failure = null;
            if (failTarget == "claude")
            {
                await SwitchToAsync(Workspace.Claude);
                failure = await WaitFailureAsync(() => _cdesktop.Failure, TimeSpan.FromSeconds(90));
                proof["claudeFailed"] = failure is not null;
            }
            else if (failTarget == "dsh")
            {
                await SwitchToAsync(Workspace.Dsh);
                failure = await WaitFailureAsync(() => _dsh.Failure, TimeSpan.FromSeconds(120));
                proof["dshFailed"] = failure is not null;
            }
            proof["failureMessage"] = failure?.Message?[..Math.Min(200, failure.Message.Length)];
            ok &= failure is not null;

            // 其余工作面必须真实可用
            var survivors = new JsonObject();
            if (failTarget != "claude")
            {
                await SwitchToAsync(Workspace.Claude);
                var loaded = await WaitSurfaceLoadedAsync(_claudeView, () => null, TimeSpan.FromSeconds(120));
                survivors["claude"] = loaded ? await ProbeSurfaceAsync(_claudeView) : null;
                ok &= loaded;
            }
            if (failTarget != "dsh")
            {
                await SwitchToAsync(Workspace.Dsh);
                var loaded = await WaitSurfaceLoadedAsync(_dshView, () => null, TimeSpan.FromSeconds(120));
                survivors["dsh"] = loaded ? await ProbeSurfaceAsync(_dshView) : null;
                ok &= loaded;
            }
            await SwitchToAsync(Workspace.Kimi);
            var kimiLoaded = await WaitSurfaceLoadedAsync(_agentView, () => _kimiWeb.Failure, TimeSpan.FromSeconds(90));
            survivors["kimi"] = kimiLoaded ? await ProbeSurfaceAsync(_agentView) : null;
            ok &= kimiLoaded;

            await SwitchToAsync(Workspace.Viewer);
            var viewerLoaded = await WaitSurfaceLoadedAsync(_viewerView, () => _viewer.Failure, TimeSpan.FromSeconds(60));
            survivors["viewer"] = viewerLoaded ? await ProbeSurfaceAsync(_viewerView) : null;
            ok &= viewerLoaded;

            await SwitchToAsync(Workspace.Project);
            proof["projectAlive"] = await ProjectUiAliveAsync();
            proof["survivors"] = survivors;
            ok &= proof["projectAlive"]!.GetValue<bool>();

            proof["matrix"] = new JsonObject
            {
                ["kimi"] = new JsonObject { ["url"] = _kimiWeb.OpenUrl, ["ownedPid"] = _kimiWeb.OwnedPid },
                ["claude"] = new JsonObject { ["mode"] = _cdesktop.Mode.ToString(), ["url"] = _cdesktop.OpenUrl, ["ownedPid"] = _cdesktop.OwnedProcessId },
                ["dsh"] = new JsonObject { ["mode"] = _dsh.Mode.ToString(), ["url"] = _dsh.OpenUrl, ["ownedPid"] = _dsh.OwnedProcessId },
                ["viewer"] = new JsonObject { ["url"] = _viewer.ViewerUrl, ["ownedPid"] = _viewer.SidecarPid },
            };
        }
        catch (Exception ex)
        {
            Program.Log("d0-03 fail-test 异常：" + ex);
            proof["error"] = ex.ToString();
            ok = false;
            Environment.ExitCode = 4;
        }
        await FinishProofAsync(proof, ok && Environment.ExitCode != 4);
    }

    private static async Task<Exception?> WaitFailureAsync(Func<Exception?> failure, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (failure() is { } ex) return ex;
            await Task.Delay(500);
        }
        return null;
    }

    /// <summary>等待某工作面 href 满足条件（重绑后的 intentional navigation 完成信号）。</summary>
    private async Task<bool> WaitSurfaceHrefAsync(WebView2 view, string mustContain, Func<Exception?> failure, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (failure() is not null) return false;
            var href = await this.InvokeAsync(async () =>
                JsonSerializer.Deserialize<string>(
                    await view.CoreWebView2.ExecuteScriptAsync("location.href")) ?? "");
            if (href.Contains(mustContain)) return true;
            await Task.Delay(500);
        }
        return false;
    }

    // ---------- R1：双项目重绑（A→B 受控重绑；B 内普通切换仍 no-reload） ----------

    private async Task RunProjectRebindTestAsync()
    {
        var proof = new JsonObject();
        var ok = true;
        try
        {
            await Task.Delay(2500);
            var dirA = Environment.GetEnvironmentVariable("ARCKEEP_TEST_PROJECT_A") ?? "";
            var dirB = Environment.GetEnvironmentVariable("ARCKEEP_TEST_PROJECT_B") ?? "";
            if (!Directory.Exists(dirA) || !Directory.Exists(dirB))
                throw new Exception("ARCKEEP_TEST_PROJECT_A/B 无效");
            if (SamePath(dirA, dirB)) throw new Exception("A/B 必须是不同项目");

            // ---- Phase A：在 A 打开全部四个工作面 ----
            await this.InvokeAsync(() => { SetProject(dirA); return Task.CompletedTask; });
            var a = await OpenAllAndCaptureAsync(dirA);
            proof["A"] = a;
            ok &= a["ok"]!.GetValue<bool>();

            // ---- 显式项目切换 A→B（context change：受控重绑） ----
            await SwitchToAsync(Workspace.Project);
            var dshAPid = _dsh.OwnedProcessId;
            var claudeWsA = _cdesktop.WorkspaceId;
            var kimiSessionA = _kimiBoundSessionId;
            await this.InvokeAsync(() => { SetProject(dirB); return Task.CompletedTask; });
            await _rebindTask;   // 等重绑完成（intentional navigate/restart 允许发生在这里）
            await Task.Delay(1500);

            // ---- Phase B：再打开全部四个工作面，必须全部指向 B ----
            var b = await OpenAllAndCaptureAsync(dirB);
            proof["B"] = b;
            ok &= b["ok"]!.GetValue<bool>();

            // 绑定断言
            var asserts = new JsonObject
            {
                ["currentRootIsB"] = SamePath(_store!.Root, dirB),
                ["viewerRootIsB"] = SamePath(_viewer.CurrentRoot, dirB),
                ["claudeWorkspaceChanged"] = _cdesktop.WorkspaceId is not null && _cdesktop.WorkspaceId != claudeWsA,
                ["claudeWorkspaceErrorNull"] = _cdesktop.WorkspaceError is null,
                ["claudeTargetBranch"] = _cdesktop.LastTargetBranch,
                ["kimiBoundRootIsB"] = SamePath(_kimiBoundRoot, dirB),
                ["kimiSessionChanged"] = _kimiBoundSessionId is not null && _kimiBoundSessionId != kimiSessionA,
            };
            // DSH：Owned 必须由 B cwd 重启（A 的 owned 进程已死）；Attached 诚实记录用户实例事实
            if (_dsh.Mode == DshService.Ownership.Owned)
            {
                asserts["dshMode"] = "Owned";
                asserts["dshBoundCwdIsB"] = SamePath(_dsh.BoundCwd, dirB);
                asserts["dshOwnedPidChanged"] = dshAPid is not null && _dsh.OwnedProcessId != dshAPid;
                asserts["dshAPidGone"] = dshAPid is null || !ProcessExists(dshAPid.Value);
            }
            else
            {
                asserts["dshMode"] = _dsh.Mode.ToString();
                asserts["dshAttachedNote"] = "用户实例不随项目切换（不伪造绑定），其实例 cwd=" + _dsh.BoundCwd;
            }
            proof["asserts"] = asserts;
            foreach (var kv in asserts)
                if (kv.Value is JsonValue v && v.TryGetValue<bool>(out var flag)) ok &= flag;

            // ---- 受 repair 影响的最小 Claude continuation：B workspace 内真实 session ----
            proof["claude_session_in_B"] = await ClaudeSessionProbeAsync("arckeep-d0-03-rebind-ok");
            ok &= (proof["claude_session_in_B"] as JsonObject)?["status"]?.GetValue<string>() == "completed";

            // ---- B 内普通工作面切换：Kimi→Claude→DSH→Viewer→Claude→Kimi，仍 no reload ----
            var cycle = new JsonObject();
            await SwitchToAsync(Workspace.Kimi);
            cycle["kimi"] = await ProbeSurfaceAsync(_agentView);
            await SwitchToAsync(Workspace.Claude);
            cycle["claude"] = await ProbeSurfaceAsync(_claudeView);
            await SwitchToAsync(Workspace.Dsh);
            cycle["dsh"] = await ProbeSurfaceAsync(_dshView);
            await SwitchToAsync(Workspace.Viewer);
            cycle["viewer"] = await ProbeSurfaceAsync(_viewerView);
            await SwitchToAsync(Workspace.Claude);
            var claudeAgain = await ProbeSurfaceAsync(_claudeView);
            await SwitchToAsync(Workspace.Kimi);
            var kimiAgain = await ProbeSurfaceAsync(_agentView);
            proof["cycleInB"] = cycle;
            var cycleOk = SameSurface(b["claudeProbe"] as JsonObject, claudeAgain)
                       && SameSurface(b["kimiProbe"] as JsonObject, kimiAgain);
            proof["ordinarySwitchNoReloadInB"] = cycleOk;
            ok &= cycleOk;

            proof["matrix"] = new JsonObject
            {
                ["kimi"] = new JsonObject { ["url"] = _kimiWeb.OpenUrl, ["ownedPid"] = _kimiWeb.OwnedPid, ["boundSession"] = _kimiBoundSessionId },
                ["claude"] = new JsonObject
                {
                    ["mode"] = _cdesktop.Mode.ToString(), ["url"] = _cdesktop.OpenUrl,
                    ["ownedPid"] = _cdesktop.OwnedProcessId,
                    ["workspaceId"] = _cdesktop.WorkspaceId, ["workspaceError"] = _cdesktop.WorkspaceError,
                    ["targetBranch"] = _cdesktop.LastTargetBranch,
                },
                ["dsh"] = new JsonObject
                {
                    ["mode"] = _dsh.Mode.ToString(), ["url"] = _dsh.OpenUrl,
                    ["ownedPid"] = _dsh.OwnedProcessId, ["boundCwd"] = _dsh.BoundCwd,
                },
                ["viewer"] = new JsonObject { ["url"] = _viewer.ViewerUrl, ["ownedPid"] = _viewer.SidecarPid, ["root"] = _viewer.CurrentRoot },
            };
        }
        catch (Exception ex)
        {
            Program.Log("d0-03 rebind-test 异常：" + ex);
            proof["error"] = ex.ToString();
            ok = false;
            Environment.ExitCode = 4;
        }
        await FinishProofAsync(proof, ok && Environment.ExitCode != 4);
    }

    /// <summary>打开四个工作面并采集绑定事实 + 持久化标记（A/B 两阶段共用）。</summary>
    private async Task<JsonObject> OpenAllAndCaptureAsync(string expectedRoot)
    {
        var phase = new JsonObject { ["root"] = expectedRoot };
        var ok = true;

        await SwitchToAsync(Workspace.Kimi);
        ok &= await WaitSurfaceHrefAsync(_agentView, "/sessions/", () => _kimiWeb.Failure, TimeSpan.FromSeconds(90));
        phase["kimiProbe"] = await ProbeSurfaceAsync(_agentView);
        phase["kimiBoundRoot"] = _kimiBoundRoot;
        phase["kimiSessionId"] = _kimiBoundSessionId;
        ok &= SamePath(_kimiBoundRoot, expectedRoot);

        await SwitchToAsync(Workspace.Claude);
        ok &= await WaitSurfaceLoadedAsync(_claudeView, () => _cdesktop.Failure, TimeSpan.FromSeconds(120));
        // Claude 必须落在当前项目的 workspace 路由上
        if (_cdesktop.WorkspaceId is not null)
        {
            ok &= await WaitSurfaceHrefAsync(_claudeView, "/workspaces/" + _cdesktop.WorkspaceId,
                () => _cdesktop.Failure, TimeSpan.FromSeconds(30));
        }
        else ok = false;
        phase["claudeProbe"] = await ProbeSurfaceAsync(_claudeView);
        phase["claudeWorkspaceId"] = _cdesktop.WorkspaceId;
        phase["claudeTargetBranch"] = _cdesktop.LastTargetBranch;

        await SwitchToAsync(Workspace.Dsh);
        ok &= await WaitSurfaceLoadedAsync(_dshView, () => _dsh.Failure, TimeSpan.FromSeconds(120));
        phase["dshProbe"] = await ProbeSurfaceAsync(_dshView);
        phase["dshMode"] = _dsh.Mode.ToString();
        phase["dshBoundCwd"] = _dsh.BoundCwd;
        if (_dsh.Mode == DshService.Ownership.Owned) ok &= SamePath(_dsh.BoundCwd, expectedRoot);

        await SwitchToAsync(Workspace.Viewer);
        ok &= await WaitSurfaceLoadedAsync(_viewerView, () => _viewer.Failure, TimeSpan.FromSeconds(60));
        phase["viewerProbe"] = await ProbeSurfaceAsync(_viewerView);
        phase["viewerRoot"] = _viewer.CurrentRoot;
        ok &= SamePath(_viewer.CurrentRoot, expectedRoot);

        phase["ok"] = ok;
        return phase;
    }

    private static bool ProcessExists(int pid)
    {
        try { using var p = System.Diagnostics.Process.GetProcessById(pid); return !p.HasExited; }
        catch { return false; }
    }

    private async Task<string> HrefAsync(WebView2 view) =>
        await this.InvokeAsync(async () =>
            JsonSerializer.Deserialize<string>(await view.CoreWebView2.ExecuteScriptAsync("location.href")) ?? "");

    private async Task<bool> WaitUntilAsync(Func<bool> condition, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (condition()) return true;
            await Task.Delay(400);
        }
        return false;
    }

    // ---------- R2-5：A→B→C 快速项目切换（旧 generation 的绑定结果必须被丢弃） ----------

    private async Task RunRapidSwitchTestAsync()
    {
        var proof = new JsonObject();
        var ok = true;
        try
        {
            await Task.Delay(2500);
            var dirA = Environment.GetEnvironmentVariable("ARCKEEP_TEST_PROJECT_A") ?? "";
            var dirB = Environment.GetEnvironmentVariable("ARCKEEP_TEST_PROJECT_B") ?? "";
            var dirC = Environment.GetEnvironmentVariable("ARCKEEP_TEST_PROJECT_C") ?? "";
            if (!Directory.Exists(dirA) || !Directory.Exists(dirB) || !Directory.Exists(dirC))
                throw new Exception("ARCKEEP_TEST_PROJECT_A/B/C 无效");

            // Phase A：完整绑定
            await this.InvokeAsync(() => { SetProject(dirA); return Task.CompletedTask; });
            var a = await OpenAllAndCaptureAsync(dirA);
            proof["A"] = a;
            ok &= a["ok"]!.GetValue<bool>();

            // A→B→C：B 的绑定被人为延迟（测试缝），B 完成前切到 C
            Environment.SetEnvironmentVariable("ARCKEEP_TEST_REBIND_DELAY_MS", "8000");
            var staleBefore = _staleApplyCount;
            await this.InvokeAsync(() => { SetProject(dirB); return Task.CompletedTask; });
            await Task.Delay(1200);   // B 仍在延迟窗口内
            await this.InvokeAsync(() => { SetProject(dirC); return Task.CompletedTask; });
            Environment.SetEnvironmentVariable("ARCKEEP_TEST_REBIND_DELAY_MS", null);
            await _rebindTask;        // B（将被丢弃）→ C 串行完成
            await Task.Delay(1000);

            // Phase C：全部工作面必须落在 C
            var c = await OpenAllAndCaptureAsync(dirC);
            proof["C"] = c;
            ok &= c["ok"]!.GetValue<bool>();

            var asserts = new JsonObject
            {
                ["currentRootIsC"] = SamePath(_store!.Root, dirC),
                ["viewerRootIsC"] = SamePath(_viewer.CurrentRoot, dirC),
                ["kimiBoundRootIsC"] = SamePath(_kimiBoundRoot, dirC),
                ["kimiSessionDiffersFromA"] = _kimiBoundSessionId is not null
                    && _kimiBoundSessionId != a["kimiSessionId"]?.GetValue<string>(),
                ["claudeBoundRootIsC"] = SamePath(_claudeBoundRoot, dirC),
                ["claudeWorkspaceDiffersFromA"] = _cdesktop.WorkspaceId is not null
                    && _cdesktop.WorkspaceId != a["claudeWorkspaceId"]?.GetValue<string>(),
                ["viewerRootC"] = SamePath(_viewer.CurrentRoot, dirC),
                ["staleCompletionIgnored"] = _staleApplyCount > staleBefore,
                ["staleApplyCount"] = _staleApplyCount,
            };
            if (_dsh.Mode == DshService.Ownership.Owned)
                asserts["dshBoundCwdIsC"] = SamePath(_dsh.BoundCwd, dirC);
            else
                asserts["dshBoundCwdIsC"] = SamePath(_dsh.BoundCwd, dirC);   // attached 也只可能 cwd 匹配（R2-4）
            proof["asserts"] = asserts;
            foreach (var kv in asserts)
                if (kv.Value is JsonValue v && v.TryGetValue<bool>(out var flag)) ok &= flag;

            // C 内普通切换仍 no-reload
            await SwitchToAsync(Workspace.Claude);
            var claudeAgain = await ProbeSurfaceAsync(_claudeView);
            await SwitchToAsync(Workspace.Kimi);
            var kimiAgain = await ProbeSurfaceAsync(_agentView);
            var cycleOk = SameSurface(c["claudeProbe"] as JsonObject, claudeAgain)
                       && SameSurface(c["kimiProbe"] as JsonObject, kimiAgain);
            proof["ordinarySwitchNoReloadInC"] = cycleOk;
            ok &= cycleOk;

            proof["matrix"] = MatrixJson();
        }
        catch (Exception ex)
        {
            Program.Log("d0-03 abc-test 异常：" + ex);
            proof["error"] = ex.ToString();
            ok = false;
            Environment.ExitCode = 4;
        }
        await FinishProofAsync(proof, ok && Environment.ExitCode != 4);
    }

    // ---------- R2-3/R2-6（Claude/Kimi 侧）：服务健康但项目绑定失败 → fail-closed + retry ----------

    private async Task RunBindFailureTestAsync()
    {
        var proof = new JsonObject();
        var ok = true;
        try
        {
            await Task.Delay(2500);
            var dirA = Environment.GetEnvironmentVariable("ARCKEEP_TEST_PROJECT_A") ?? "";
            var dirB = Environment.GetEnvironmentVariable("ARCKEEP_TEST_PROJECT_B") ?? "";
            if (!Directory.Exists(dirA) || !Directory.Exists(dirB))
                throw new Exception("ARCKEEP_TEST_PROJECT_A/B 无效");

            // Phase A：Claude + Kimi 成功绑定 A
            await this.InvokeAsync(() => { SetProject(dirA); return Task.CompletedTask; });
            await SwitchToAsync(Workspace.Claude);
            ok &= await WaitSurfaceHrefAsync(_claudeView, "/workspaces/", () => _cdesktop.Failure, TimeSpan.FromSeconds(120));
            await SwitchToAsync(Workspace.Kimi);
            ok &= await WaitSurfaceHrefAsync(_agentView, "/sessions/", () => _kimiWeb.Failure, TimeSpan.FromSeconds(90));
            var wsA = _cdesktop.WorkspaceId;
            var sessA = _kimiBoundSessionId;
            proof["A"] = new JsonObject
            {
                ["claudeWorkspaceId"] = wsA, ["kimiSessionId"] = sessA,
                ["claudeBoundA"] = SamePath(_claudeBoundRoot, dirA), ["kimiBoundA"] = SamePath(_kimiBoundRoot, dirA),
            };
            ok &= SamePath(_claudeBoundRoot, dirA) && SamePath(_kimiBoundRoot, dirA);

            // Phase B-fail：SetProject(B) 后在绑定延迟窗口内删掉 B 目录
            // → cdesktop 服务仍健康但 POST /api/repos 400；kimi POST sessions 被拒（root 不存在）
            Environment.SetEnvironmentVariable("ARCKEEP_TEST_REBIND_DELAY_MS", "6000");
            await this.InvokeAsync(() => { SetProject(dirB); return Task.CompletedTask; });
            await Task.Delay(800);
            Directory.Delete(dirB, recursive: true);
            await _rebindTask;
            Environment.SetEnvironmentVariable("ARCKEEP_TEST_REBIND_DELAY_MS", null);
            await Task.Delay(500);

            var claudeHref = await HrefAsync(_claudeView);
            var kimiHref = await HrefAsync(_agentView);
            var serviceHealthy = _cdesktop.OpenUrl is not null
                && await CdesktopService.HealthOkAsync(_cdesktop.OpenUrl.TrimEnd('/'), TimeSpan.FromSeconds(5));
            var fail = new JsonObject
            {
                ["currentRootIsB"] = SamePath(_store!.Root, dirB),
                ["claudeServiceHealthy"] = serviceHealthy,
                ["claudeBindingNull"] = _cdesktop.Binding is null,
                ["claudeWorkspaceError"] = _cdesktop.WorkspaceError,
                ["claudeBoundRootIsNotB"] = !SamePath(_claudeBoundRoot, dirB),
                ["claudeHrefNotAWorkspace"] = wsA is null || !claudeHref.Contains("/workspaces/" + wsA),
                ["claudeHref"] = claudeHref,
                ["kimiBoundRootIsNotB"] = !SamePath(_kimiBoundRoot, dirB),
                ["kimiHrefNotASession"] = sessA is null || !kimiHref.Contains(sessA),
                ["kimiHref"] = kimiHref,
                ["kimiServerAlive"] = _kimiWeb.OpenUrl is not null,
            };
            proof["failState"] = fail;
            foreach (var kv in fail)
                if (kv.Value is JsonValue v && v.TryGetValue<bool>(out var flag)) ok &= flag;
            ok &= fail["claudeWorkspaceError"]!.GetValue<string?>() is not null;

            // 恢复条件后 Retry：重建 B 目录 → 重新打开 → 必须正常绑定 B
            Directory.CreateDirectory(dirB);
            await File.WriteAllTextAsync(Path.Combine(dirB, ".arckeep-test-project-b"), "marker\n");
            await SwitchToAsync(Workspace.Claude);
            ok &= await WaitUntilAsync(() => SamePath(_claudeBoundRoot, dirB), TimeSpan.FromSeconds(90));
            if (_cdesktop.WorkspaceId is not null)
                ok &= await WaitSurfaceHrefAsync(_claudeView, "/workspaces/" + _cdesktop.WorkspaceId, () => null, TimeSpan.FromSeconds(30));
            await SwitchToAsync(Workspace.Kimi);
            ok &= await WaitUntilAsync(() => SamePath(_kimiBoundRoot, dirB), TimeSpan.FromSeconds(60));
            ok &= await WaitSurfaceHrefAsync(_agentView, "/sessions/", () => null, TimeSpan.FromSeconds(30));
            proof["retry"] = new JsonObject
            {
                ["claudeBoundRootIsB"] = SamePath(_claudeBoundRoot, dirB),
                ["claudeWorkspaceId"] = _cdesktop.WorkspaceId,
                ["claudeWorkspaceDiffersFromA"] = _cdesktop.WorkspaceId != wsA,
                ["kimiBoundRootIsB"] = SamePath(_kimiBoundRoot, dirB),
                ["kimiSessionId"] = _kimiBoundSessionId,
                ["kimiSessionDiffersFromA"] = _kimiBoundSessionId != sessA,
            };
            foreach (var kv in (JsonObject)proof["retry"]!)
                if (kv.Value is JsonValue v && v.TryGetValue<bool>(out var flag)) ok &= flag;

            // 恢复后普通切换仍 no-reload
            var claudeProbe = await ProbeSurfaceAsync(_claudeView);
            await SwitchToAsync(Workspace.Kimi);
            var kimiProbe = await ProbeSurfaceAsync(_agentView);
            await SwitchToAsync(Workspace.Claude);
            var claudeAgain = await ProbeSurfaceAsync(_claudeView);
            await SwitchToAsync(Workspace.Kimi);
            var kimiAgain = await ProbeSurfaceAsync(_agentView);
            var cycleOk = SameSurface(claudeProbe, claudeAgain) && SameSurface(kimiProbe, kimiAgain);
            proof["ordinarySwitchNoReloadAfterRetry"] = cycleOk;
            ok &= cycleOk;

            proof["matrix"] = MatrixJson();
        }
        catch (Exception ex)
        {
            Program.Log("d0-03 bindfail-test 异常：" + ex);
            proof["error"] = ex.ToString();
            ok = false;
            Environment.ExitCode = 4;
        }
        await FinishProofAsync(proof, ok && Environment.ExitCode != 4);
    }

    private JsonObject MatrixJson() => new()
    {
        ["kimi"] = new JsonObject { ["url"] = _kimiWeb.OpenUrl, ["ownedPid"] = _kimiWeb.OwnedPid, ["boundSession"] = _kimiBoundSessionId, ["boundRoot"] = _kimiBoundRoot },
        ["claude"] = new JsonObject
        {
            ["mode"] = _cdesktop.Mode.ToString(), ["url"] = _cdesktop.OpenUrl,
            ["ownedPid"] = _cdesktop.OwnedProcessId,
            ["workspaceId"] = _cdesktop.WorkspaceId, ["workspaceError"] = _cdesktop.WorkspaceError,
            ["targetBranch"] = _cdesktop.LastTargetBranch, ["boundRoot"] = _claudeBoundRoot,
        },
        ["dsh"] = new JsonObject
        {
            ["mode"] = _dsh.Mode.ToString(), ["url"] = _dsh.OpenUrl,
            ["ownedPid"] = _dsh.OwnedProcessId, ["boundCwd"] = _dsh.BoundCwd, ["boundRoot"] = _dshBoundRoot,
        },
        ["viewer"] = new JsonObject { ["url"] = _viewer.ViewerUrl, ["ownedPid"] = _viewer.SidecarPid, ["root"] = _viewer.CurrentRoot },
    };
}
