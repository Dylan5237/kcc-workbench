using System.Text.Json.Nodes;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace Arckeep.Shell;

/// <summary>
/// D0-03 R3 人眼可见工作面组合契约探针（ARCKEEP_TEST_COMPOSITION=1 时激活，正常启动零开销）。
///
/// 背景：R0–R2 的 DOM/title/href/timeOrigin 探针可以在「已加载但被其他控件盖住」的 WebView2 上
/// 成功执行——真实机器截图证明 Claude/DSH/Viewer 激活（顶部按钮高亮）时，人眼看到的仍是
/// Project/Rail UI。DOM loaded ≠ human-visible surface。本探针把「人眼可见」翻译成可机检的
/// 宿主组合断言（H7），按 H6 序列逐站验证：
///
///   Project → Kimi → Claude → DSH → Viewer → Claude → Kimi → Project
///
/// 每站断言：
///   - 目标控件 Visible == true；
///   - 目标控件 bounds == contentHost 内容区（Kimi 按分栏规则：agent 占左、rail 宽 320 居右）；
///   - 目标控件是 contentHost 内最上层可见交互控件（GetChildIndex 最小且为首个可见子控件）；
///   - Claude/DSH/Viewer 激活时 Project/Kimi 布局在 z-order 中位于其下，不得盖住工作面；
///   - 目标 WebView2 上 DOM 探针同时成功（__arckeepMark + timeOrigin + href + title）。
/// 回访站（Claude/Kimi/Project）额外断言标记与 timeOrigin 不变——普通切换 no-reload（R2 回归，
/// 不产生任何付费 Claude session，只做宿主层导航与可见性动作）。
/// 证据写出到 ARCKEEP_TEST_OUT；退出码 0=通过，3=断言失败，4=异常。
/// </summary>
internal sealed partial class ShellWindow
{
    private async Task RunCompositionProbeAsync()
    {
        var proof = new JsonObject();
        var ok = true;
        try
        {
            await Task.Delay(2500);
            var projectDir = Environment.GetEnvironmentVariable("ARCKEEP_TEST_PROJECT") ?? "";
            if (!Directory.Exists(projectDir)) throw new Exception("ARCKEEP_TEST_PROJECT 无效：" + projectDir);

            // Project UI 必须先真实就绪（它是 H1 的证据对象，也是桥）
            var uiReady = false;
            var uiDeadline = DateTime.UtcNow.AddSeconds(30);
            while (DateTime.UtcNow < uiDeadline && !(uiReady = await ProjectUiAliveAsync()))
                await Task.Delay(500);
            proof["projectUiReady"] = uiReady;
            ok &= uiReady;

            await this.InvokeAsync(() => { SetProject(projectDir); return Task.CompletedTask; });

            // ---- H6 首访段：Project → Kimi → Claude → DSH → Viewer ----
            var first = new JsonObject();
            await SwitchToAsync(Workspace.Project);
            first["project"] = await CheckDestinationAsync(Workspace.Project, _uiView);
            ok &= CheckOk(first["project"]);

            await SwitchToAsync(Workspace.Kimi);
            var kimiLoaded = await WaitSurfaceLoadedAsync(_agentView, () => _kimiWeb.Failure, TimeSpan.FromSeconds(90));
            first["kimi"] = await CheckDestinationAsync(Workspace.Kimi, _agentView);
            first["kimi"]!["surfaceLoaded"] = kimiLoaded;
            ok &= kimiLoaded && CheckOk(first["kimi"]);

            await SwitchToAsync(Workspace.Claude);
            var claudeLoaded = await WaitSurfaceLoadedAsync(_claudeView, () => _cdesktop.Failure, TimeSpan.FromSeconds(120));
            first["claude"] = await CheckDestinationAsync(Workspace.Claude, _claudeView);
            first["claude"]!["surfaceLoaded"] = claudeLoaded;
            ok &= claudeLoaded && CheckOk(first["claude"]);

            await SwitchToAsync(Workspace.Dsh);
            var dshLoaded = await WaitSurfaceLoadedAsync(_dshView, () => _dsh.Failure, TimeSpan.FromSeconds(120));
            first["dsh"] = await CheckDestinationAsync(Workspace.Dsh, _dshView);
            first["dsh"]!["surfaceLoaded"] = dshLoaded;
            ok &= dshLoaded && CheckOk(first["dsh"]);

            await SwitchToAsync(Workspace.Viewer);
            var viewerLoaded = await WaitSurfaceLoadedAsync(_viewerView, () => _viewer.Failure, TimeSpan.FromSeconds(60));
            first["viewer"] = await CheckDestinationAsync(Workspace.Viewer, _viewerView);
            first["viewer"]!["surfaceLoaded"] = viewerLoaded;
            ok &= viewerLoaded && CheckOk(first["viewer"]);
            proof["first"] = first;

            // ---- H6 回访段：Viewer → Claude → Kimi → Project（标记/timeOrigin 不变 = 未 reload） ----
            var revisit = new JsonObject();
            await SwitchToAsync(Workspace.Claude);
            revisit["claude"] = await CheckDestinationAsync(Workspace.Claude, _claudeView);
            revisit["claude"]!["noReload"] = SameSurface(DomOf(first["claude"]), DomOf(revisit["claude"]));

            await SwitchToAsync(Workspace.Kimi);
            revisit["kimi"] = await CheckDestinationAsync(Workspace.Kimi, _agentView);
            revisit["kimi"]!["noReload"] = SameSurface(DomOf(first["kimi"]), DomOf(revisit["kimi"]));

            await SwitchToAsync(Workspace.Project);
            revisit["project"] = await CheckDestinationAsync(Workspace.Project, _uiView);
            revisit["project"]!["noReload"] = SameSurface(DomOf(first["project"]), DomOf(revisit["project"]));
            proof["revisit"] = revisit;
            ok &= CheckOk(revisit["claude"]) && CheckOk(revisit["kimi"]) && CheckOk(revisit["project"]);

            // 组合语义矩阵（进程 ownership 证据由外部探针在退出后核对，与 R2 相同）
            proof["matrix"] = MatrixJson();
        }
        catch (Exception ex)
        {
            Program.Log("d0-03 r3 composition-test 异常：" + ex);
            proof["error"] = ex.ToString();
            ok = false;
            Environment.ExitCode = 4;
        }
        await FinishProofAsync(proof, ok && Environment.ExitCode != 4);
    }

    /// <summary>单站证据：宿主组合断言（UI 线程读取）+ 目标 WebView2 的 DOM 探针。</summary>
    private async Task<JsonObject> CheckDestinationAsync(Workspace ws, WebView2 domView)
    {
        await Task.Delay(400);   // 等 dock 布局落定后再读 bounds/z-order
        var host = await this.InvokeAsync(() =>
        {
            var client = _contentHost.ClientRectangle;
            var r = new JsonObject
            {
                ["workspace"] = ws.ToString(),
                ["activeMatches"] = _active == ws,
                ["hostClient"] = RectJson(client),
            };
            var overlays = new[] { _claudeView, _dshView, _viewerView };
            switch (ws)
            {
                case Workspace.Project:
                case Workspace.Kimi:
                    // Project/Kimi 布局必须填满内容区，且是最上层可见控件；三个整幅工作面全部隐藏
                    r["layoutVisible"] = _projectKimiLayout.Visible;
                    r["layoutBoundsMatch"] = _projectKimiLayout.Bounds == client;
                    r["layoutTopmostVisible"] = TopmostVisibleChild(_contentHost) == _projectKimiLayout;
                    r["overlaysHidden"] = overlays.All(o => !o.Visible);
                    r["uiVisible"] = _uiView.Visible;
                    if (ws == Workspace.Kimi)
                    {
                        var cols = _projectKimiLayout.GetColumnWidths();
                        r["agentVisible"] = _agentView.Visible;
                        r["agentBoundsMatch"] = _agentView.Bounds == new Rectangle(0, 0, cols[0], client.Height);
                        r["railBoundsMatch"] = _uiView.Bounds == new Rectangle(cols[0], 0, cols[1], client.Height);
                        r["splitRuleMatch"] = cols[1] == RailWidth && cols[0] == client.Width - RailWidth;
                    }
                    else
                    {
                        r["agentHidden"] = !_agentView.Visible;
                        r["uiBoundsMatch"] = _uiView.Bounds == client;
                    }
                    break;
                default:
                    var view = ws == Workspace.Claude ? _claudeView : ws == Workspace.Dsh ? _dshView : _viewerView;
                    var viewIndex = _contentHost.Controls.GetChildIndex(view);
                    // 目标 WebView2：可见、铺满内容区、z-order 最顶；Project/Kimi 布局被压在下面
                    r["viewVisible"] = view.Visible;
                    r["viewBoundsMatch"] = view.Bounds == client;
                    r["viewTopmost"] = viewIndex == 0;
                    r["viewTopmostVisible"] = TopmostVisibleChild(_contentHost) == view;
                    r["layoutBelowView"] = _contentHost.Controls.GetChildIndex(_projectKimiLayout) > viewIndex;
                    r["otherOverlaysHidden"] = overlays.Where(o => o != view).All(o => !o.Visible);
                    break;
            }
            return Task.FromResult(r);
        });
        host["dom"] = await ProbeSurfaceAsync(domView);
        host["domOk"] = host["dom"] is JsonObject d && d["href"] is not null && d["mark"] is not null;
        return host;
    }

    /// <summary>contentHost 内最上层的可见子控件（Controls[0] 为 z-order 顶端，向下找第一个 Visible）。</summary>
    private static Control? TopmostVisibleChild(Control parent)
    {
        for (var i = 0; i < parent.Controls.Count; i++)
            if (parent.Controls[i].Visible) return parent.Controls[i];
        return null;
    }

    private static JsonObject RectJson(Rectangle r) =>
        new() { ["x"] = r.X, ["y"] = r.Y, ["w"] = r.Width, ["h"] = r.Height };

    private static JsonObject? DomOf(JsonNode? node) => (node as JsonObject)?["dom"] as JsonObject;

    /// <summary>一站的全部布尔断言为真且 DOM 探针成功（domOk 本身是布尔项之一）。</summary>
    private static bool CheckOk(JsonNode? node)
    {
        if (node is not JsonObject o || o["dom"] is not JsonObject) return false;
        var ok = true;
        foreach (var kv in o)
            if (kv.Value is JsonValue v && v.TryGetValue<bool>(out var b)) ok &= b;
        return ok;
    }
}
