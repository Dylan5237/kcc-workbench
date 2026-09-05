using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Arckeep.Shell;

/// <summary>
/// Arckeep 主窗口。D0-03 多工作面持久壳：Project（Arckeep UI）+ Kimi / Claude(cdesktop) /
/// DSH / Viewer 四个一级工作面，各自独立持久 WebView2；普通切换只做 Visible/置顶，
/// 不销毁、不 reload、不停 agent/session。
/// 控制平面走 ACP（简报交付证据），视觉平面是 agent 原生 Web UI（D-20 接入 ≠ 改造）。
/// R3 宿主组合：titleBar 之下由 _contentHost 独占内容区；Project/Kimi 共用分栏布局
/// _projectKimiLayout，Claude/DSH/Viewer 是与该布局平级的整幅兄弟控件（Dock=Fill），
/// 激活 = Visible + BringToFront，z-order 只由 _contentHost.Controls 顺序决定——
/// 不再让多个 WebView2 共享同一个 TableLayoutPanel 单元格（真实机器上该组合不可靠：
/// 覆盖层 DOM 已加载但仍被 Project/Rail 压在下面，DOM 探针产生 false positive）。
/// </summary>
internal sealed partial class ShellWindow : Form
{
    private static readonly string UiDir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "ui"));
    private static readonly string UiDirDev = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "arckeep", "ui"));
    private const int RailWidth = 320;

    /// <summary>一级工作面。普通切换只改宿主可见性，inactive WebView2 保持存活。</summary>
    private enum Workspace { Project, Kimi, Claude, Dsh, Viewer }

    // 内容宿主：Form 的唯二内容子控件之一（另一个是全宽 titleBar）。
    // 五个目的地全部是它的直接子控件；整幅工作面的 z-order 由 Controls 集合顺序确定。
    private readonly Panel _contentHost = new() { Dock = DockStyle.Fill };
    private readonly TableLayoutPanel _projectKimiLayout = new() { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Margin = Padding.Empty };
    private readonly WebView2 _agentView = new() { Dock = DockStyle.Fill, Visible = false, Margin = Padding.Empty };
    private readonly WebView2 _uiView = new() { Dock = DockStyle.Fill, Margin = Padding.Empty };
    private readonly WebView2 _viewerView = new() { Dock = DockStyle.Fill, Visible = false, Margin = Padding.Empty };
    private readonly WebView2 _claudeView = new() { Dock = DockStyle.Fill, Visible = false, Margin = Padding.Empty };
    private readonly WebView2 _dshView = new() { Dock = DockStyle.Fill, Visible = false, Margin = Padding.Empty };
    private readonly Panel _titleBar = new() { Dock = DockStyle.Top, Height = 36, BackColor = Color.FromArgb(0xF5, 0xF2, 0xEA) };
    private readonly Label _quotaChip = new() { AutoSize = false, TextAlign = ContentAlignment.MiddleCenter };
    private readonly Label _projectLabel = new() { AutoSize = true, ForeColor = Color.FromArgb(0x66, 0x63, 0x5D) };

    private ProjectStore? _store;
    private AcpClient? _acp;
    private readonly KimiWebService _kimiWeb = new();
    private readonly QuotaService _quota = new();
    private readonly ViewerService _viewer = new();
    private readonly CdesktopService _cdesktop = new();
    private readonly DshService _dsh = new();
    private string? _selectedNextId;
    private Dictionary<string, (long Ticks, long Length)>? _fsSnapshot;
    private SessionRecord? _session;
    private DateTime _shownAt;
    private bool _attached;
    private bool _agentReady;
    private bool _viewerReady;
    private bool _claudeReady;
    private bool _dshReady;
    private Workspace _active = Workspace.Project;
    // 各工作面已导航地址：非空且绑定根未变时，普通切回绝不重新导航（不 reload）
    private string? _kimiLoadedUrl;
    private string? _viewerLoadedUrl;
    private string? _claudeLoadedUrl;
    private string? _dshLoadedUrl;
    // Project binding（R1）：工作面当前绑定的项目根；显式项目切换时受控重绑
    private string? _kimiBoundRoot;
    private string? _claudeBoundRoot;
    private string? _dshBoundRoot;
    private string? _kimiBoundSessionId;
    private Task _rebindTask = Task.CompletedTask;
    private long _projectGeneration;       // 项目代际：每次显式项目切换 +1
    private int _staleApplyCount;          // 被 generation guard 丢弃的过期绑定结果数（A→B→C 证据）
    private Button? _btnProject;
    private Button? _btnKimi;
    private Button? _btnClaude;
    private Button? _btnDsh;
    private Button? _btnViewer;

    private static readonly JsonSerializerOptions SendOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public ShellWindow()
    {
        Text = "Arckeep";
        Width = 1520;
        Height = 950;
        BackColor = Color.FromArgb(0xF5, 0xF2, 0xEA);
        FormBorderStyle = FormBorderStyle.None;   // 原生标题栏条（全窗宽，额度在其上）
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(1024, 700);

        BuildTitleBar();

        _projectKimiLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 0F));   // agent（接入态展开）
        _projectKimiLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));  // Arckeep UI
        _projectKimiLayout.Controls.Add(_agentView, 0, 0);
        _projectKimiLayout.Controls.Add(_uiView, 1, 0);
        _contentHost.Controls.Add(_projectKimiLayout);
        // Claude / DSH / Viewer 整幅工作面：_projectKimiLayout 的兄弟控件（同一 contentHost 内），
        // 激活时 Visible + BringToFront 置顶；不与任何其他控件共享 TableLayoutPanel 单元格。
        foreach (var overlay in new[] { _viewerView, _claudeView, _dshView })
            _contentHost.Controls.Add(overlay);
        Controls.Add(_contentHost);
        Controls.Add(_titleBar);   // 后加入者先 dock：标题栏占顶部，内容铺满剩余

        Shown += async (_, _) => await OnShownAsync();
        FormClosed += (_, _) => { _acp?.Dispose(); _kimiWeb.Dispose(); _quota.Dispose(); _viewer.Dispose(); _cdesktop.Dispose(); _dsh.Dispose(); };
    }

    private void BuildTitleBar()
    {
        var iconPath = Path.Combine(AppContext.BaseDirectory, "assets", "app-icon.png");
        var icon = new PictureBox
        {
            Size = new Size(16, 16),
            Location = new Point(12, 10),
            SizeMode = PictureBoxSizeMode.StretchImage,
        };
        if (File.Exists(iconPath)) icon.Image = Image.FromFile(iconPath);

        var title = new Label
        {
            Text = "Arckeep",
            AutoSize = true,
            Location = new Point(34, 9),
            Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
            ForeColor = Color.FromArgb(0x23, 0x23, 0x23),
        };

        var btnClose = TitleButton("×", 40);
        btnClose.FlatAppearance.MouseOverBackColor = Color.FromArgb(0x8E, 0x3C, 0x32);
        btnClose.FlatAppearance.MouseDownBackColor = Color.FromArgb(0x8E, 0x3C, 0x32);
        btnClose.Click += (_, _) => Close();
        var btnMax = TitleButton("□", 40);
        btnMax.Click += (_, _) => WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
        var btnMin = TitleButton("—", 40);
        btnMin.Click += (_, _) => WindowState = FormWindowState.Minimized;

        // D0-03 一级工作面切换：Project / Kimi / Claude / DSH / Viewer（极简原生按钮，非设计系统）
        _btnViewer = WorkspaceButton("Viewer", 56, Workspace.Viewer);
        _btnDsh = WorkspaceButton("DSH", 52, Workspace.Dsh);
        _btnClaude = WorkspaceButton("Claude", 60, Workspace.Claude);
        _btnKimi = WorkspaceButton("Kimi", 52, Workspace.Kimi);
        _btnProject = WorkspaceButton("Project", 64, Workspace.Project);

        _projectLabel.Font = new Font("Segoe UI", 8.5f);
        _projectLabel.Text = "";

        _quotaChip.Text = "额度 · 点这里同步";
        _quotaChip.Font = new Font("Consolas", 8.5f);
        _quotaChip.ForeColor = Color.FromArgb(0x66, 0x63, 0x5D);
        _quotaChip.Height = 22;
        _quotaChip.Cursor = Cursors.Hand;
        _quotaChip.Click += async (_, _) =>
        {
            if (_quota.State.Status == "needs-login" || _quota.State.Snapshot is null)
                await _quota.ShowLoginAndRefreshAsync(this);
            else
                Send(new { type = "show-quota" });   // 打开额度面板（UI 视图）
        };

        _titleBar.Controls.Add(icon);
        _titleBar.Controls.Add(title);
        _titleBar.Controls.Add(_projectLabel);
        _titleBar.Controls.Add(_quotaChip);
        _titleBar.Controls.Add(_btnViewer);
        _titleBar.Controls.Add(_btnDsh);
        _titleBar.Controls.Add(_btnClaude);
        _titleBar.Controls.Add(_btnKimi);
        _titleBar.Controls.Add(_btnProject);
        _titleBar.Controls.Add(btnMin);
        _titleBar.Controls.Add(btnMax);
        _titleBar.Controls.Add(btnClose);
        _titleBar.Resize += (_, _) =>
        {
            btnClose.Left = _titleBar.Width - 40;
            btnMax.Left = _titleBar.Width - 80;
            btnMin.Left = _titleBar.Width - 120;
            // 工作面按钮从右往左排在窗口控件之前
            var x = _titleBar.Width - 128;
            foreach (var b in new[] { _btnViewer, _btnDsh, _btnClaude, _btnKimi, _btnProject })
            {
                x -= b!.Width + 4;
                b.Left = x;
            }
            _quotaChip.Width = Math.Max(60, _quotaChip.PreferredSize.Width == 0 ? 150 : _quotaChip.PreferredSize.Width + 16);
            _quotaChip.Left = Math.Max(140, x - _quotaChip.Width - 10);
            _quotaChip.Top = 7;
            _projectLabel.Left = 34 + title.PreferredWidth + 14;
            _projectLabel.Top = 11;
        };
        // 拖动与双击
        void Drag(object? s, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left) { ReleaseCapture(); SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero); }
        }
        _titleBar.MouseDown += Drag;
        title.MouseDown += Drag;
        icon.MouseDown += Drag;
        _titleBar.DoubleClick += (_, _) => WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
    }

    private static Button TitleButton(string text, int width) => new()
    {
        Text = text,
        Width = width,
        Dock = DockStyle.None,
        Height = 36,
        FlatStyle = FlatStyle.Flat,
        ForeColor = Color.FromArgb(0x66, 0x63, 0x5D),
        Font = new Font("Segoe UI", 9f),
        FlatAppearance = { BorderSize = 0 },
        Anchor = AnchorStyles.Top | AnchorStyles.Right,
    };

    private Button WorkspaceButton(string text, int width, Workspace workspace)
    {
        var button = TitleButton(text, width);
        button.Click += async (_, _) => await SwitchToAsync(workspace);
        return button;
    }

    /// <summary>当前工作面高亮（极简态：粗体 + 深色字），其余按钮恢复默认。</summary>
    private void UpdateWorkspaceButtons()
    {
        var map = new (Button? Button, Workspace Ws)[]
        {
            (_btnProject, Workspace.Project), (_btnKimi, Workspace.Kimi),
            (_btnClaude, Workspace.Claude), (_btnDsh, Workspace.Dsh), (_btnViewer, Workspace.Viewer),
        };
        foreach (var (button, ws) in map)
        {
            if (button is null) continue;
            var active = ws == _active;
            button.Font = new Font("Segoe UI", 9f, active ? FontStyle.Bold : FontStyle.Regular);
            button.ForeColor = active ? Color.FromArgb(0x23, 0x23, 0x23) : Color.FromArgb(0x66, 0x63, 0x5D);
        }
    }

    // 无边框窗口：边缘缩放 + 最大化不遮任务栏
    protected override void WndProc(ref Message m)
    {
        const int WM_NCHITTEST = 0x84;
        const int WM_GETMINMAXINFO = 0x24;
        if (m.Msg == WM_NCHITTEST && WindowState == FormWindowState.Normal)
        {
            base.WndProc(ref m);
            if (m.Result == (IntPtr)1) // HTCLIENT
            {
                var p = PointToClient(new Point(m.LParam.ToInt32() & 0xffff, m.LParam.ToInt32() >> 16));
                const int grip = 7;
                var left = p.X <= grip;
                var right = p.X >= Width - grip;
                var top = p.Y <= grip;
                var bottom = p.Y >= Height - grip;
                if (left && top) m.Result = (IntPtr)13;
                else if (right && top) m.Result = (IntPtr)14;
                else if (left && bottom) m.Result = (IntPtr)16;
                else if (right && bottom) m.Result = (IntPtr)17;
                else if (left) m.Result = (IntPtr)10;
                else if (right) m.Result = (IntPtr)11;
                else if (top) m.Result = (IntPtr)12;
                else if (bottom) m.Result = (IntPtr)15;
            }
            return;
        }
        if (m.Msg == WM_GETMINMAXINFO)
        {
            var area = Screen.FromHandle(Handle).WorkingArea;
            var mmi = System.Runtime.InteropServices.Marshal.PtrToStructure<MINMAXINFO>(m.LParam);
            mmi.ptMaxPosition = new POINT { X = area.Left, Y = area.Top };
            mmi.ptMaxSize = new POINT { X = area.Width, Y = area.Height };
            System.Runtime.InteropServices.Marshal.StructureToPtr(mmi, m.LParam, true);
            return;
        }
        base.WndProc(ref m);
    }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct MINMAXINFO
    {
        public POINT ptReserved;
        public POINT ptMaxSize;
        public POINT ptMaxPosition;
        public POINT ptMinTrackSize;
        public POINT ptMaxTrackSize;
    }

    private async Task OnShownAsync()
    {
        _shownAt = DateTime.UtcNow;
        var udf = Path.Combine(ProjectStore.ArckeepDataDir, "udfs", "ui");
        var env = await CoreWebView2Environment.CreateAsync(userDataFolder: udf);
        await _uiView.EnsureCoreWebView2Async(env);

        var uiPath = Directory.Exists(UiDir) ? UiDir : UiDirDev;
        _uiView.CoreWebView2.SetVirtualHostNameToFolderMapping("arckeep.local", uiPath, CoreWebView2HostResourceAccessKind.Allow);
        _uiView.CoreWebView2.WebMessageReceived += OnWebMessage;
        _uiView.CoreWebView2.Navigate("https://arckeep.local/index.html");

        // 额度：载入上次快照，推给 UI，启动自动刷新
        _quota.OnStateChanged += SendQuotaState;
        _quota.Initialize();
        SendQuotaState();

        var fixtureOut = Environment.GetEnvironmentVariable("ARCKEEP_QUOTA_FIXTURE");
        if (!string.IsNullOrEmpty(fixtureOut))
            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(3000);
                    Program.Log("fixture: start");
                    var result = await this.InvokeAsync(async () => await _quota.RunFixtureAsync());
                    await File.WriteAllTextAsync(fixtureOut, result);
                    Program.Log("quota fixture: " + result);
                    Environment.Exit(result.StartsWith("OK") ? 0 : 3);
                }
                catch (Exception ex)
                {
                    Program.Log("quota fixture 异常：" + ex);
                    Environment.Exit(4);
                }
            });

        // 测试钩子：直接跑一次真实额度抓取（用已登录的 cookie），把原始结果落日志
        if (Environment.GetEnvironmentVariable("ARCKEEP_QUOTA_REFRESH") == "1")
            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(2000);
                    await this.InvokeAsync(async () => await _quota.RefreshDebugAsync());
                }
                catch (Exception ex) { Program.Log("quota-debug 异常：" + ex); }
                Environment.Exit(0);
            });

        // 测试钩子：打开额度面板（截图验证版式）
        if (Environment.GetEnvironmentVariable("ARCKEEP_SHOW_QUOTA") == "1")
            _ = Task.Run(async () =>
            {
                await Task.Delay(3000);
                Program.Log("show-quota hook: firing");
                await this.InvokeAsync(() => { Send(new { type = "show-quota" }); return Task.CompletedTask; });
                Program.Log("show-quota hook: sent");
            });

        // 测试钩子：在页面里真实点击额度 chip（走完整桥接路径）→ 登录窗 → 抓图 → 秒关 → 刷新
        if (Environment.GetEnvironmentVariable("ARCKEEP_TEST_LOGIN") == "1")
            _ = Task.Run(async () =>
            {
                await Task.Delay(2500);
                await this.InvokeAsync(async () =>
                {
                    await _uiView.CoreWebView2.ExecuteScriptAsync("document.getElementById('quotaChip').click()");
                });
                await Task.Delay(8000);
                await this.InvokeAsync(async () =>
                {
                    foreach (Form f in Application.OpenForms)
                    {
                        if (f is QuotaLoginWindow login)
                        {
                            Program.Log("login-test: 登录窗存在，抓图");
                            await login.CaptureAsync(Path.Combine(ProjectStore.ArckeepDataDir, "..", "login-window.png"));
                            login.Close();
                        }
                    }
                });
                await Task.Delay(3000);
                Program.Log("login-test: status=" + _quota.State.Status + " error=" + _quota.State.Error);
                Environment.Exit(0);
            });

        // 测试钩子：真实启动 Viewer sidecar 并装进 WebView2，回采 /api/tree 作证据
        if (Environment.GetEnvironmentVariable("ARCKEEP_TEST_VIEWER") == "1")
            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(2500);
                    var projectDir = Environment.GetEnvironmentVariable("ARCKEEP_TEST_VIEWER_PROJECT") ?? "";
                    if (!Directory.Exists(projectDir)) throw new Exception("ARCKEEP_TEST_VIEWER_PROJECT 无效");
                    await this.InvokeAsync(() =>
                    {
                        _store = new ProjectStore(projectDir);
                        _store.LoadOrCreate();
                        SendState();
                        return Task.CompletedTask;
                    });
                    await SwitchToAsync(Workspace.Viewer);
                    // ExecuteScriptAsync 不 await Promise：先启动采集，再轮询 window._proof
                    await this.InvokeAsync(async () =>
                        await _viewerView.CoreWebView2.ExecuteScriptAsync(
                            "fetch('/api/tree').then(r=>r.json()).then(j=>{window._proof=JSON.stringify({href:location.href,title:document.title,root:j.root,treeChildren:(j.tree&&j.tree.children||[]).length,treeJson:JSON.stringify(j.tree).slice(0,600)})}).catch(e=>{window._proof='ERR:'+e})"));
                    string proof = "PENDING";
                    var deadline = DateTime.UtcNow.AddSeconds(30);
                    while (DateTime.UtcNow < deadline)
                    {
                        await Task.Delay(1500);
                        proof = await this.InvokeAsync(async () =>
                            await _viewerView.CoreWebView2.ExecuteScriptAsync("window._proof||'PENDING'"));
                        proof = proof.Trim('"').Replace("\\\"", "\"");
                        if (proof != "PENDING") break;
                    }
                    Program.Log("viewer-test: " + proof);
                    var killMode = Environment.GetEnvironmentVariable("ARCKEEP_TEST_VIEWER_KILL") == "1";
                    var finalProof = proof;
                    var ok = proof.Contains("treeChildren") && !proof.Contains("\"treeChildren\":0");
                    if (ok && killMode)
                    {
                        // V5：杀掉 sidecar，验证壳与工作面不崩、Viewer 可重启恢复
                        var pid = _viewer.SidecarPid;
                        if (pid is not null) try { System.Diagnostics.Process.GetProcessById(pid.Value).Kill(); } catch { }
                        await Task.Delay(1500);
                        await this.InvokeAsync(() =>
                        {
                            ShowProject();   // 关闭 Viewer 覆盖层（UI 线程，纯可见性）
                            return Task.CompletedTask;
                        });
                        await SwitchToAsync(Workspace.Viewer);   // 重新打开 = 重启 sidecar + 重新导航
                        await this.InvokeAsync(async () =>
                            await _viewerView.CoreWebView2.ExecuteScriptAsync(
                                "fetch('/api/tree').then(r=>r.json()).then(j=>{window._proof2=JSON.stringify({href:location.href,treeChildren:(j.tree&&j.tree.children||[]).length})}).catch(e=>{window._proof2='ERR:'+e})"));
                        string proof2 = "PENDING";
                        deadline = DateTime.UtcNow.AddSeconds(30);
                        while (DateTime.UtcNow < deadline)
                        {
                            await Task.Delay(1500);
                            proof2 = await this.InvokeAsync(async () =>
                                await _viewerView.CoreWebView2.ExecuteScriptAsync("window._proof2||'PENDING'"));
                            proof2 = proof2.Trim('"').Replace("\\\"", "\"");
                            if (proof2 != "PENDING") break;
                        }
                        // 主 UI 工作面探活
                        var uiAlive = await this.InvokeAsync(async () =>
                            await _uiView.CoreWebView2.ExecuteScriptAsync("document.getElementById('app')?'alive':'dead'"));
                        Program.Log("viewer-test-kill: proof2=" + proof2 + " ui=" + uiAlive);
                        var recovered = proof2.Contains("treeChildren") && !proof2.Contains("\"treeChildren\":0") && !proof2.StartsWith("ERR");
                        ok = recovered && uiAlive.Contains("alive");
                        finalProof = "{\"first\":" + proof + ",\"afterKill\":" + (proof2.StartsWith("{") ? proof2 : "\"" + proof2 + "\"") + ",\"uiAlive\":" + uiAlive + "}";
                    }
                    var outFile = Environment.GetEnvironmentVariable("ARCKEEP_TEST_VIEWER_OUT");
                    if (!string.IsNullOrEmpty(outFile)) await File.WriteAllTextAsync(outFile, finalProof);
                    Environment.Exit(ok ? 0 : 3);
                }
                catch (Exception ex)
                {
                    Program.Log("viewer-test 异常：" + ex);
                    Environment.Exit(4);
                }
            });

        // 测试钩子：D0-03 多工作面真实切换 + 持久化 + 真实 Claude 会话 + 真实关闭路径
        if (Environment.GetEnvironmentVariable("ARCKEEP_TEST_SWITCH") == "1")
            _ = Task.Run(RunSurfaceSwitchTestAsync);

        // 测试钩子：D0-03 故障隔离（ARCKEEP_TEST_FAIL=claude|dsh，其余工作面必须可用）
        var failTarget = Environment.GetEnvironmentVariable("ARCKEEP_TEST_FAIL");
        if (!string.IsNullOrEmpty(failTarget))
            _ = Task.Run(() => RunFailureIsolationTestAsync(failTarget));

        // 测试钩子：D0-03 R1 双项目重绑（A→B 受控重绑 + B 内普通切换仍 no-reload）
        if (Environment.GetEnvironmentVariable("ARCKEEP_TEST_REBIND") == "1")
            _ = Task.Run(RunProjectRebindTestAsync);

        // 测试钩子：D0-03 R2 A→B→C 竞态（旧 generation 绑定结果必须被丢弃）
        if (Environment.GetEnvironmentVariable("ARCKEEP_TEST_ABC") == "1")
            _ = Task.Run(RunRapidSwitchTestAsync);

        // 测试钩子：D0-03 R2 绑定失败 fail-closed（服务健康但 workspace/session 绑定失败）
        if (Environment.GetEnvironmentVariable("ARCKEEP_TEST_BINDFAIL") == "1")
            _ = Task.Run(RunBindFailureTestAsync);

        // 测试钩子：D0-03 R3 人眼可见工作面组合契约（Visible/bounds/z-order + DOM 探针，H6/H7）
        if (Environment.GetEnvironmentVariable("ARCKEEP_TEST_COMPOSITION") == "1")
            _ = Task.Run(RunCompositionProbeAsync);

        var shot = Environment.GetEnvironmentVariable("ARCKEEP_SHOT");
        if (!string.IsNullOrEmpty(shot))
        {
            var early = Environment.GetEnvironmentVariable("ARCKEEP_SHOT_EARLY");
            if (!string.IsNullOrEmpty(early))
            {
                var earlyMs = int.TryParse(Environment.GetEnvironmentVariable("ARCKEEP_SHOT_EARLY_MS"), out var ms) ? ms : 16000;
                _ = Task.Run(async () => { await Task.Delay(earlyMs); await CaptureTo(early); });
            }
            _ = Task.Run(async () =>
            {
                var auto = Environment.GetEnvironmentVariable("ARCKEEP_AUTO") == "1";
                var deadline = DateTime.UtcNow.AddSeconds(auto ? 90 : 8);
                while (DateTime.UtcNow < deadline && auto &&
                       (_session?.Lifecycle != "ended" || (_attached && _kimiWeb.OpenUrl is null && _kimiWeb.Failure is null)))
                    await Task.Delay(500);
                if (!auto) await Task.Delay(6000);
                await Task.Delay(2500);
                await CaptureTo(shot);
                Environment.Exit(0);
            });
        }
        if (Environment.GetEnvironmentVariable("ARCKEEP_AUTO") == "1")
            _ = Task.Run(async () => { await Task.Delay(4000); await StartSessionAsync(); });
    }

    private async Task CaptureTo(string path)
    {
        try
        {
            await this.InvokeAsync(async () =>
            {
                var dump = Environment.GetEnvironmentVariable("ARCKEEP_DUMP");
                if (!string.IsNullOrEmpty(dump))
                {
                    var info = await _uiView.CoreWebView2.ExecuteScriptAsync(
                        "JSON.stringify({cls:document.getElementById('app')?.className,views:[...document.querySelectorAll('.view')].map(v=>v.id+':'+v.className),rail:getComputedStyle(document.getElementById('brandRail')).display,lastErr:window._lastErr||null})");
                    await File.WriteAllTextAsync(dump, info);
                }
                await using var fs = File.Create(path);
                await _uiView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);
                if (_attached && _agentReady)
                {
                    var agentPath = path.Replace(".png", "-agentview.png");
                    await using var fs2 = File.Create(agentPath);
                    await _agentView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs2);
                }
            });
        }
        catch { }
    }

    // ---------- 桥消息 ----------

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonObject msg;
        try { msg = JsonNode.Parse(e.WebMessageAsJson) as JsonObject ?? new JsonObject(); }
        catch { return; }
        // WebView2 事件回调内禁止再初始化新 WebView2（E_ABORT 重入）：先出队，回消息循环再处理
        BeginInvoke(() => DispatchMessage(msg));
    }

    private void DispatchMessage(JsonObject msg)
    {
        var type = msg["type"]?.GetValue<string>() ?? "";
        switch (type)
        {
            case "ui-ready": LoadLastProject(); SendState(); SendQuotaState(); break;
            case "pick-directory": PickDirectory(); break;
            case "select-next": _selectedNextId = msg["id"]?.GetValue<string>(); break;
            case "edit-status": EditStatus(msg["text"]?.GetValue<string>() ?? ""); break;
            case "dismiss-next": if (_store is not null && msg["id"]?.GetValue<string>() is { } dn) { _store.DismissNext(dn); SendState(); } break;
            case "confirm-next": if (_store is not null && msg["id"]?.GetValue<string>() is { } cn) { _store.ConfirmNext(cn); SendState(); } break;
            case "add-next": if (_store is not null && msg["text"]?.GetValue<string>() is { Length: > 0 } an) { _store.AddNext(an); SendState(); } break;
            case "start": _ = StartSessionAsync(); break;
            case "send-prompt": _ = SendFollowUpAsync(msg["text"]?.GetValue<string>() ?? ""); break;
            case "back": BackToProject(); break;
            case "open-viewer": _ = SwitchToAsync(Workspace.Viewer); break;
            case "quota-refresh": _ = _quota.RefreshAsync(); break;
            case "quota-login": _ = _quota.ShowLoginAndRefreshAsync(this); break;
        }
    }

    private void SendQuotaState()
    {
        var s = _quota.State;
        var chipText = s.Status switch
        {
            "refreshing" => "额度 · 同步中…",
            "needs-login" => "额度 · 需要登录",
            _ when s.Snapshot is null => "额度 · 点这里同步",
            _ when s.Status == "error" => "额度 · 同步失败，点击重试",
            _ => $"额度 5h {s.Snapshot!.FiveHourPercent}% · 7d {s.Snapshot.SevenDayPercent}%",
        };
        if (_titleBar.InvokeRequired) _titleBar.BeginInvoke(() => _quotaChip.Text = chipText);
        else _quotaChip.Text = chipText;

        Send(new
        {
            type = "quota",
            s.Status,
            error = s.Error,
            history = s.History.Select(ToV1Snapshot).ToList(),
            snapshot = s.Snapshot is null ? null : ToV1Snapshot(s.Snapshot),
        });
    }

    // v1 快照形态（供 UI 面板与 forecast.js 原样使用）
    private static object ToV1Snapshot(QuotaSnapshot x) => new
    {
        x.MembershipPlan,
        updatedAt = (x.UpdatedAt ?? DateTimeOffset.Now).ToString("o"),
        total = new { usedPercent = x.TotalPercent, kimiPercent = x.KimiPercent, codePercent = x.CodePercent, resetAt = x.TotalReset },
        fiveHour = new { percent = x.FiveHourPercent, resetAt = x.FiveHourReset },
        sevenDay = new { percent = x.SevenDayPercent, resetAt = x.SevenDayReset },
    };

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    // ---------- 项目加载 ----------

    private void LoadLastProject()
    {
        var registryFile = Path.Combine(ProjectStore.ArckeepDataDir, "registry.json");
        try
        {
            if (File.Exists(registryFile))
            {
                var registry = JsonNode.Parse(File.ReadAllText(registryFile)) as JsonObject;
                var last = registry?["lastProjectPath"]?.GetValue<string>();
                if (!string.IsNullOrEmpty(last) && Directory.Exists(last))
                {
                    _store = new ProjectStore(last);
                    _store.LoadOrCreate();
                    SyncViewerRoot();
                }
            }
        }
        catch (Exception ex) { Console.WriteLine("[arckeep] registry 读取失败：" + ex.Message); }
    }

    private void PickDirectory()
    {
        using var dialog = new FolderBrowserDialog { Description = "选择项目目录（Arckeep 会在其中创建 .arckeep 文件夹）" };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        SetProject(dialog.SelectedPath);
    }

    /// <summary>
    /// 确定性项目切换：所有工作面（Kimi/Claude/DSH/Viewer）都以这里的根为上下文。
    /// 显式项目切换（A→B）是 context change：fail-closed（R2）——旧项目绑定立即作废，
    /// 已加载的项目作用域工作面立即进入「正在绑定到当前项目…」态，受控重绑完成前
    /// 绝不把 A 的 surface 当 B 展示。
    /// </summary>
    private void SetProject(string root)
    {
        var previousRoot = _store?.Root;
        _store = new ProjectStore(root);
        _store.LoadOrCreate();
        Directory.CreateDirectory(ProjectStore.ArckeepDataDir);
        File.WriteAllText(
            Path.Combine(ProjectStore.ArckeepDataDir, "registry.json"),
            JsonSerializer.Serialize(new { lastProjectPath = _store.Root, lastProjectId = _store.Data.Project.ProjectId }, new JsonSerializerOptions { WriteIndented = true }));
        SyncViewerRoot();
        if (previousRoot is not null && !SamePath(previousRoot, root))
        {
            _projectGeneration++;
            // fail-closed：先捕获哪些面已加载（决定重绑范围），再作废旧绑定 + 落绑定中页面
            var staleKimi = _kimiLoadedUrl is not null && !SamePath(_kimiBoundRoot, root);
            var staleClaude = _claudeLoadedUrl is not null && !SamePath(_claudeBoundRoot, root);
            var staleDsh = _dshLoadedUrl is not null && !SamePath(_dshBoundRoot, root);
            if (staleKimi)
            {
                _kimiLoadedUrl = null; _kimiBoundRoot = null; _kimiBoundSessionId = null;
                _agentView.CoreWebView2?.NavigateToString(BindingHtml());
            }
            if (staleClaude)
            {
                _claudeLoadedUrl = null; _claudeBoundRoot = null;
                _claudeView.CoreWebView2?.NavigateToString(BindingHtml());
            }
            if (staleDsh)
            {
                _dshLoadedUrl = null; _dshBoundRoot = null;
                _dshView.CoreWebView2?.NavigateToString(BindingHtml());
            }
            RebindSurfaces(root, _projectGeneration, staleKimi, staleClaude, staleDsh);
        }
        SendState();
    }

    private static string BindingHtml() => LoadingHtml("正在绑定到当前项目…");

    private static bool SamePath(string? left, string? right) =>
        string.Equals(
            left is null ? null : Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar),
            right is null ? null : Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar),
            StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// 只有「请求的 root 仍是当前项目」且「generation 未变」的异步绑定结果才允许落地
    /// （导航/绑定根/session id/loaded URL）。旧 generation 的结果一律丢弃并计数（A→B→C 证据）。
    /// </summary>
    private async Task ApplyIfCurrentAsync(long generation, string root, Action apply)
    {
        await this.InvokeAsync(() =>
        {
            if (generation != _projectGeneration || !SamePath(_store?.Root, root))
            {
                Interlocked.Increment(ref _staleApplyCount);
                Program.Log($"丢弃过期项目绑定结果（gen={generation} current={_projectGeneration} root={root}）");
                return Task.CompletedTask;
            }
            apply();
            return Task.CompletedTask;
        });
    }

    /// <summary>
    /// 项目 A→B：只重绑「已加载」的工作面（未打开的下次 Open 自然按 B 绑定）。
    /// 重绑串行链接（A→B→C 时 B 的绑定与 C 不并发），每个 apply 都过 generation guard。
    /// ARCKEEP_TEST_REBIND_DELAY_MS：测试缝，人为拉开绑定延迟以制造可观测的竞态窗口。
    /// </summary>
    private void RebindSurfaces(string root, long generation, bool kimi, bool claude, bool dsh)
    {
        Program.Log($"项目切换 → {root}（gen={generation}）；重绑 kimi={kimi} claude={claude} dsh={dsh}");
        if (!kimi && !claude && !dsh) return;
        var delayMs = int.TryParse(Environment.GetEnvironmentVariable("ARCKEEP_TEST_REBIND_DELAY_MS"), out var d) ? d : 0;
        _rebindTask = ChainAsync(_rebindTask);

        async Task ChainAsync(Task previous)
        {
            try { await previous; } catch { }
            if (delayMs > 0) await Task.Delay(delayMs);
            if (kimi) await RebindKimiAsync(root, generation);
            if (claude) await RebindClaudeAsync(root, generation);
            if (dsh) await RebindDshAsync(root, generation);
        }
    }

    /// <summary>
    /// Kimi：同一 kimi web 实例上绑定/创建 cwd=新根的 session 并导航（不重启进程、绝不 kill 用户实例）。
    /// 绑定失败 → fail-closed：受控未绑定页 + 绑定根置空（旧 session 页面不得冒充新项目）。
    /// </summary>
    private async Task RebindKimiAsync(string root, long generation)
    {
        KimiWebService.KimiBinding? binding = null;
        Exception? startFailure = null;
        try
        {
            await _kimiWeb.StartAsync(root);
            binding = await _kimiWeb.BindSessionAsync(root);
        }
        catch (Exception ex)
        {
            startFailure = ex;
            _kimiWeb.Failure = ex;
            Program.Log("kimi web 启动失败：" + ex.Message);
        }
        await ApplyIfCurrentAsync(generation, root, () =>
        {
            if (binding is not null)
            {
                if (_kimiLoadedUrl != binding.Url)
                {
                    _kimiLoadedUrl = binding.Url;
                    _agentView.CoreWebView2.Navigate(binding.Url);
                }
                _kimiBoundRoot = binding.Cwd;
                _kimiBoundSessionId = binding.SessionId;
            }
            else
            {
                _kimiLoadedUrl = null;
                _kimiBoundRoot = null;
                _kimiBoundSessionId = null;
                _agentView.CoreWebView2.NavigateToString(ErrorHtml(
                    startFailure is not null ? "Kimi Web 启动失败" : "Kimi 项目绑定失败",
                    startFailure?.Message ?? $"无法在当前项目根定位/创建 Kimi session：{root}"));
            }
        });
    }

    /// <summary>
    /// Claude：复用 cdesktop 进程，对新根做显式 workspace 绑定。
    /// 服务失败与绑定失败分流：服务坏 → 不可用页；服务健康但绑定失败 → 项目绑定失败页，
    /// 旧 workspace 路由绝不被当作新项目 surface（R2-3）。
    /// </summary>
    private async Task RebindClaudeAsync(string root, long generation)
    {
        var url = await _cdesktop.StartAsync(root);
        await ApplyIfCurrentAsync(generation, root, () =>
        {
            if (url is null)
            {
                _claudeLoadedUrl = null;
                _claudeBoundRoot = null;
                _claudeView.CoreWebView2.NavigateToString(
                    ErrorHtml("Claude 工作面不可用", _cdesktop.Failure?.Message));
                return;
            }
            if (_cdesktop.Binding is { } binding && SamePath(binding.Root, root))
            {
                if (_claudeLoadedUrl != binding.WorkspaceUrl)
                {
                    _claudeLoadedUrl = binding.WorkspaceUrl;
                    _claudeView.CoreWebView2.Navigate(binding.WorkspaceUrl);
                }
                _claudeBoundRoot = root;
                return;
            }
            // 服务健康但 workspace 绑定失败：受控不可用/重试态，不展示旧 A workspace
            _claudeLoadedUrl = null;
            _claudeBoundRoot = null;
            _claudeView.CoreWebView2.NavigateToString(ErrorHtml(
                "Claude 项目绑定失败", _cdesktop.WorkspaceError ?? "workspace ensure 未成功"));
        });
    }

    /// <summary>
    /// DSH：Owned 且 cwd 过期 → 安全 Dispose 自有实例并按新根重启（intentional）；
    /// Attached 用户实例 cwd 不匹配 → Detach 引用（绝不 kill）后由 StartAsync 落 owned（R2-4）；
    /// Attached 且 cwd 匹配 → 直接有效。
    /// </summary>
    private async Task RebindDshAsync(string root, long generation)
    {
        if (_dsh.Mode == DshService.Ownership.Attached && !SamePath(_dsh.BoundCwd, root))
            _dsh.Detach();
        if (_dsh.Mode == DshService.Ownership.Owned && !SamePath(_dsh.BoundCwd, root))
            _dsh.Dispose();
        if (_dsh.Mode != DshService.Ownership.None)
        {
            // 到达这里 = Attached 且 cwd 匹配（Owned 过期分支已在上面 Dispose）
            await ApplyIfCurrentAsync(generation, root, () => { _dshBoundRoot = _dsh.BoundCwd; });
            return;
        }
        var url = await _dsh.StartAsync(root,
            attachAuthority: Environment.GetEnvironmentVariable("ARCKEEP_DSH_ATTACH_AUTHORITY"));
        await ApplyIfCurrentAsync(generation, root, () =>
        {
            if (url is not null)
            {
                if (_dshLoadedUrl != url)
                {
                    _dshLoadedUrl = url;
                    _dshView.CoreWebView2.Navigate(url);
                }
                _dshBoundRoot = _dsh.BoundCwd;
            }
            else
            {
                _dshLoadedUrl = null;
                _dshBoundRoot = null;
                _dshView.CoreWebView2.NavigateToString(
                    ErrorHtml("DSH 工作面不可用", _dsh.Failure?.Message));
            }
        });
    }

    private void EditStatus(string text)
    {
        if (_store is null || string.IsNullOrWhiteSpace(text)) return;
        _store.SaveStatus(new StatusEntry { Text = text.Trim(), ConfirmedBy = "user", UpdatedAt = DateTimeOffset.Now });
        SendState();
    }

    // ---------- 状态推送 ----------

    private void SendState()
    {
        UpdateProjectLabel();
        if (_store is null)
        {
            Send(new { type = "state", empty = true });
            return;
        }
        var d = _store.Data;
        var artifacts = RecentArtifacts(_store.Root, 6);
        Send(new
        {
            type = "state",
            empty = false,
            project = new { d.Project.Name, path = _store.Root, id = d.Project.ProjectId },
            status = new { text = d.Status.Text, confirmedBy = d.Status.ConfirmedBy, updatedAt = d.Status.UpdatedAt.ToString("yyyy-MM-dd HH:mm") },
            next = d.Next.Select(n => new { n.Id, n.Text, n.Epistemic, source = DescribeSource(n.SourceRef), selected = n.Id == _selectedNextId }),
            decisions = d.Decisions.Select(x => new { x.Id, x.Text, x.Status, source = DescribeSource(x.SourceRef) }),
            artifacts,
        });
    }

    private static string DescribeSource(SourceRef? source)
    {
        if (source is null) return "";
        return source.Type == "user" ? "你自己写的" : $"我猜的 · 来自{source.Ref}";
    }

    /// <summary>标题栏当前项目上下文（极简：项目名 + 根路径 tooltip 语义）。</summary>
    private void UpdateProjectLabel()
    {
        void Apply() => _projectLabel.Text = _store is null ? "" : $"· {_store.Data.Project.Name} — {_store.Root}";
        if (_titleBar.InvokeRequired) _titleBar.BeginInvoke(Apply);
        else Apply();
    }

    private static readonly HashSet<string> SkipDirs = new(StringComparer.OrdinalIgnoreCase)
        { ".git", "node_modules", "bin", "obj", ".arckeep", "dist", "dist-fast", "dist-quota-fix", "dist-refresh" };

    private static List<object> RecentArtifacts(string root, int count) =>
        SafeWalk(root).OrderByDescending(f => f.Ticks).Take(count)
            .Select(f => (object)new { name = f.Path, modified = new DateTime(f.Ticks).ToString("MM-dd HH:mm") }).ToList();

    private static List<(string Path, long Ticks, long Length)> SafeWalk(string root)
    {
        var files = new List<(string, long, long)>();
        var queue = new Queue<string>();
        queue.Enqueue(root);
        while (queue.Count > 0 && files.Count < 20000)
        {
            var dir = queue.Dequeue();
            string[] subdirs;
            string[] fileList;
            try { subdirs = Directory.GetDirectories(dir); fileList = Directory.GetFiles(dir); }
            catch { continue; }
            foreach (var sub in subdirs)
                if (!SkipDirs.Contains(Path.GetFileName(sub))) queue.Enqueue(sub);
            foreach (var file in fileList)
            {
                try
                {
                    var info = new FileInfo(file);
                    files.Add((Path.GetRelativePath(root, file), info.LastWriteTimeUtc.Ticks, info.Length));
                }
                catch { }
            }
        }
        return files;
    }

    // ---------- 接入态（ACP 控制平面 + Kimi Web 视觉平面） ----------

    private async Task StartSessionAsync()
    {
        if (_store is null || _session?.Lifecycle == "active") return;
        var cwd = _store.Root;
        var d = _store.Data;

        // UI 切换必须在 UI 线程（AUTO 路径在线程池线程上，直接碰布局/同步上下文会炸）
        var pickedText = "";
        await this.InvokeAsync(() =>
        {
            _active = Workspace.Kimi;
            UpdateWorkspaceButtons();
            SetAttachedLayout(true);
            Send(new { type = "mode", mode = "rail" });
            return Task.CompletedTask;
        });

        var picked = d.Next.FirstOrDefault(n => n.Id == _selectedNextId);
        pickedText = picked?.Text ?? "";
        var brief = BuildBrief(d, picked);
        _store.SaveContextMd(brief);
        Send(new { type = "session", phase = "generated", note = "简报已写入 .arckeep/context.md", continuation = pickedText });

        _fsSnapshot = SafeWalk(cwd).ToDictionary(f => f.Path, f => (f.Ticks, f.Length));

        // 视觉平面：agent webview 初始化 + kimi web 后台启动/绑定（generation guard 在内部）
        // （已导航过则保持原页面——Brief 会话不再 reload 已打开的 Kimi 工作面）
        var generation = _projectGeneration;
        await this.InvokeAsync(async () =>
        {
            await EnsureAgentViewAsync();
            if (_kimiLoadedUrl is null)
                _agentView.CoreWebView2.NavigateToString(
                    "<body style='background:#F5F2EA;color:#66635D;font:13px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>正在启动 Kimi Code…</body>");
        });
        _ = Task.Run(async () =>
        {
            try { await _rebindTask; } catch { }
            await RebindKimiAsync(cwd, generation);   // 绑定/创建 cwd=当前项目的 session 并导航
        });

        // 控制平面：ACP 交付简报
        _acp?.Dispose();
        _acp = new AcpClient();
        _acp.OnSessionUpdate += (kind, text) => Send(new { type = "session-feed", kind, text = text.Length > 500 ? text[..500] : text });

        if (!_acp.Start(cwd) || !await _acp.InitializeAsync())
        {
            Send(new { type = "session", phase = "failed", note = "kimi acp 启动或握手失败（kimi CLI 需要在 PATH 中）" });
            return;
        }
        var sessionId = await _acp.NewSessionAsync(cwd);
        if (sessionId is null)
        {
            Send(new { type = "session", phase = "failed", note = "session/new 未返回 sessionId" });
            return;
        }

        _session = new SessionRecord
        {
            Id = Guid.NewGuid().ToString("N")[..12],
            AcpSessionId = sessionId,
            StartedAt = DateTimeOffset.Now,
        };
        Send(new { type = "session", phase = "delivered", sessionId });

        var stopReason = await _acp.PromptAsync(sessionId, brief);
        _session.StopReason = stopReason;   // turn 结束 ≠ 会话结束；会话在回到项目时才关闭
        Send(new { type = "session", phase = stopReason is not null ? "completed" : "failed", stopReason = stopReason ?? "无回执（进程失联）" });

        if (Environment.GetEnvironmentVariable("ARCKEEP_AUTO") == "1")
        {
            await Task.Delay(1500);
            await SendFollowUpAsync("请只回复两个字：收到。");   // 追问路径真实验证
            await Task.Delay(1500);
            await this.InvokeAsync(() => { BackToProject(); return Task.CompletedTask; });
        }
    }

    /// <summary>同一会话内追问（控制平面仍是 ACP；session 在回到项目前保持活跃）。</summary>
    private async Task SendFollowUpAsync(string text)
    {
        if (_acp is null || _session is null || string.IsNullOrWhiteSpace(text)) return;
        Send(new { type = "session", phase = "running", note = "追问中" });
        var stopReason = await _acp.PromptAsync(_session.AcpSessionId, text.Trim());
        _session.StopReason = stopReason;
        Send(new { type = "session", phase = stopReason is not null ? "completed" : "failed", stopReason = stopReason ?? "无回执（进程失联）" });
    }

    private async Task EnsureAgentViewAsync()
    {
        if (_agentReady) return;
        var udf = Path.Combine(ProjectStore.ArckeepDataDir, "udfs", "agent");
        var env = await CoreWebView2Environment.CreateAsync(userDataFolder: udf);
        await _agentView.EnsureCoreWebView2Async(env);
        _agentReady = true;
    }

    // ---------- 工作面切换（D0-03：纯可见性/布局切换，不销毁、不 reload、不停 session） ----------

    /// <summary>线程安全入口：布局操作封送回 UI 线程。</summary>
    private Task SwitchToAsync(Workspace target) => this.InvokeAsync(() => SwitchOnUiThreadAsync(target));

    private async Task SwitchOnUiThreadAsync(Workspace target)
    {
        switch (target)
        {
            case Workspace.Project: ShowProject(); break;
            case Workspace.Kimi: await OpenKimiAsync(); break;
            case Workspace.Claude: await OpenClaudeAsync(); break;
            case Workspace.Dsh: await OpenDshAsync(); break;
            case Workspace.Viewer: await OpenViewerAsync(); break;
        }
    }

    /// <summary>回到项目空间：只收覆盖层、恢复原布局；不动任何 agent/session。</summary>
    private void ShowProject()
    {
        HideOverlays();
        _active = Workspace.Project;
        SetAttachedLayout(false);
        Send(new { type = "mode", mode = "space" });
        UpdateWorkspaceButtons();
    }

    private void HideOverlays()
    {
        _viewerView.Visible = false;
        _claudeView.Visible = false;
        _dshView.Visible = false;
    }

    /// <summary>激活一个整幅覆盖工作面（Claude/DSH/Viewer 通用宿主动作）。</summary>
    private void ShowOverlay(WebView2 view, Workspace workspace)
    {
        HideOverlays();
        _active = workspace;
        // contentHost 内兄弟组合：BringToFront = Controls[0] = 确定的最上层，
        // Project/Kimi 布局与另外两个工作面被压在下面且不接收输入（R3 修复的核心不变量）
        view.Visible = true;
        view.BringToFront();
        UpdateWorkspaceButtons();
    }

    /// <summary>无项目时先选目录（所有工作面都以当前 Arckeep project 为上下文）。</summary>
    private bool EnsureProject()
    {
        if (_store is not null) return true;
        PickDirectory();
        return _store is not null;
    }

    private static string LoadingHtml(string text) =>
        "<body style='background:#F5F2EA;color:#66635D;font:13px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>" +
        System.Net.WebUtility.HtmlEncode(text) + "</body>";

    private static string ErrorHtml(string title, string? message) =>
        "<body style='background:#F5F2EA;color:#8E3C32;font:13px sans-serif;padding:32px'>" +
        System.Net.WebUtility.HtmlEncode(title) + "：" +
        System.Net.WebUtility.HtmlEncode(message ?? "未知原因") +
        "<br><span style='color:#66635D'>其他工作面不受影响；再次点击上方按钮可重试。</span></body>";

    /// <summary>
    /// Kimi 工作面：打开 ≠ 交付 Brief。这里只保证 Kimi Web 以当前项目根运行并嵌入；
    /// ACP Brief/follow-up 路径仍在「开始」里，二者共享同一持久 _agentView。
    /// </summary>
    private async Task OpenKimiAsync()
    {
        if (!EnsureProject()) return;
        HideOverlays();
        _active = Workspace.Kimi;
        SetAttachedLayout(true);
        Send(new { type = "mode", mode = "rail" });
        UpdateWorkspaceButtons();
        await EnsureAgentViewAsync();
        var cwd = _store!.Root;
        if (_kimiLoadedUrl is not null && SamePath(_kimiBoundRoot, cwd)) return;   // 已绑定当前项目：纯可见性切换
        if (_kimiLoadedUrl is null)
            _agentView.CoreWebView2.NavigateToString(LoadingHtml("正在启动 Kimi Code…"));
        var generation = _projectGeneration;
        _ = Task.Run(async () =>
        {
            try { await _rebindTask; } catch { }   // 项目级重绑优先；完成后可能已绑定
            if (_kimiLoadedUrl is not null && SamePath(_kimiBoundRoot, cwd)) return;
            await RebindKimiAsync(cwd, generation);   // generation guard + fail-closed 在内部
        });
    }

    private async Task OpenClaudeAsync()
    {
        if (!EnsureProject()) return;
        await EnsureClaudeViewAsync();
        ShowOverlay(_claudeView, Workspace.Claude);
        var cwd = _store!.Root;
        if (_claudeLoadedUrl is not null && SamePath(_claudeBoundRoot, cwd)) return;   // 已绑定当前项目：纯可见性切换
        if (_claudeLoadedUrl is null)
            _claudeView.CoreWebView2.NavigateToString(LoadingHtml("正在启动 Claude 工作面（cdesktop）…"));
        var generation = _projectGeneration;
        _ = Task.Run(async () =>
        {
            try { await _rebindTask; } catch { }
            if (_claudeLoadedUrl is not null && SamePath(_claudeBoundRoot, cwd)) return;
            await RebindClaudeAsync(cwd, generation);   // generation guard + fail-closed 在内部
        });
    }

    private async Task OpenDshAsync()
    {
        if (!EnsureProject()) return;
        await EnsureDshViewAsync();
        ShowOverlay(_dshView, Workspace.Dsh);
        var cwd = _store!.Root;
        if (_dshLoadedUrl is not null && SamePath(_dshBoundRoot, cwd)) return;   // 纯可见性切换
        if (_dshLoadedUrl is null)
            _dshView.CoreWebView2.NavigateToString(LoadingHtml("正在接入 DSH 工作面…"));
        var generation = _projectGeneration;
        _ = Task.Run(async () =>
        {
            try { await _rebindTask; } catch { }
            if (_dshLoadedUrl is not null && SamePath(_dshBoundRoot, cwd)) return;
            await RebindDshAsync(cwd, generation);   // generation guard + fail-closed 在内部
        });
    }

    private async Task EnsureClaudeViewAsync()
    {
        if (_claudeReady) return;
        var udf = Path.Combine(ProjectStore.ArckeepDataDir, "udfs", "claude");
        var env = await CoreWebView2Environment.CreateAsync(userDataFolder: udf);
        await _claudeView.EnsureCoreWebView2Async(env);
        _claudeReady = true;
    }

    private async Task EnsureDshViewAsync()
    {
        if (_dshReady) return;
        var udf = Path.Combine(ProjectStore.ArckeepDataDir, "udfs", "dsh");
        var env = await CoreWebView2Environment.CreateAsync(userDataFolder: udf);
        await _dshView.EnsureCoreWebView2Async(env);
        _dshReady = true;
    }

    // ---------- Viewer（KCC Viewer sidecar + WebView2，D0-04） ----------

    private async Task EnsureViewerViewAsync()
    {
        if (_viewerReady) return;
        var udf = Path.Combine(ProjectStore.ArckeepDataDir, "udfs", "viewer");
        var env = await CoreWebView2Environment.CreateAsync(userDataFolder: udf);
        await _viewerView.EnsureCoreWebView2Async(env);
        _viewerReady = true;
    }

    /// <summary>Viewer 工作面：只切可见性，不销毁任何工作面（agent/UI webview 保持运行）。</summary>
    private async Task OpenViewerAsync()
    {
        if (_store is null) { PickDirectory(); if (_store is null) return; }

        string? url = null;
        try
        {
            url = await _viewer.EnsureStartedAsync(_store.Root);   // V3：根目录确定性同步
        }
        catch (Exception ex)
        {
            Program.Log("viewer 启动失败：" + ex.Message);
            _viewer.Failure = ex;
        }
        await this.InvokeAsync(async () =>
        {
            await EnsureViewerViewAsync();
            if (url is not null)
            {
                // sidecar 重启后地址（端口/token）会变，需重新导航；根切换由 SSE 直播，不重载
                if (_viewerLoadedUrl != url)
                {
                    _viewerView.CoreWebView2.Navigate(url);
                    _viewerLoadedUrl = url;
                }
            }
            else
            {
                _viewerView.CoreWebView2.NavigateToString(ErrorHtml("Viewer 启动失败", _viewer.Failure?.Message));
                _viewerLoadedUrl = null;
            }
            ShowOverlay(_viewerView, Workspace.Viewer);
        });
    }

    /// <summary>项目切换时若 sidecar 在运行则同步根目录；未运行则下次打开时按新项目启动。</summary>
    private void SyncViewerRoot()
    {
        if (_store is null) return;
        var root = _store.Root;
        _ = Task.Run(async () =>
        {
            try { await _viewer.SyncRootAsync(root); }
            catch (Exception ex) { Program.Log("viewer 根同步失败：" + ex.Message); }
        });
    }

    private void SetAttachedLayout(bool attached)
    {
        // 只能在 UI 线程调用
        _attached = attached;
        _projectKimiLayout.ColumnStyles[0] = new ColumnStyle(SizeType.Percent, attached ? 100F : 0F);
        _projectKimiLayout.ColumnStyles[1] = new ColumnStyle(attached ? SizeType.Absolute : SizeType.Percent, attached ? RailWidth : 100F);
        _agentView.Visible = attached;
    }

    private static string BuildBrief(ProjectData d, NextItem? picked)
    {
        var decisions = d.Decisions.Where(x => x.Status == "当前").Take(3).Select(x => "- " + x.Text);
        var lines = new List<string>
        {
            "【Arckeep 简报】",
            $"项目状态：{d.Status.Text}",
            $"接续点：{(picked is null ? "无（自由开始）" : picked.Text)}",
        };
        if (decisions.Any())
        {
            lines.Add("当前关键判断（索引，全文见 .arckeep/decisions.md）：");
            lines.AddRange(decisions);
        }
        lines.Add("说明：本简报由 Arckeep 生成；如需更多上下文，可读 .arckeep/context.md 与工作目录。");
        return string.Join('\n', lines);
    }

    // ---------- 回流 ----------

    private void BackToProject()
    {
        if (_store is null) return;
        var changed = new List<object>();
        if (_fsSnapshot is not null)
        {
            var now = SafeWalk(_store.Root);
            var nowMap = now.ToDictionary(f => f.Path, f => (f.Ticks, f.Length));
            foreach (var (path, meta) in nowMap)
            {
                if (!_fsSnapshot.TryGetValue(path, out var old))
                    changed.Add(new { name = path, change = "新增" });
                else if (old.Ticks != meta.Ticks || old.Length != meta.Length)
                    changed.Add(new { name = path, change = "修改" });
            }
            foreach (var path in _fsSnapshot.Keys.Except(nowMap.Keys))
                changed.Add(new { name = path, change = "删除" });
        }
        _acp?.Dispose();
        _acp = null;
        if (_session is not null)
        {
            _session.EndedAt = DateTimeOffset.Now;
            _session.Lifecycle = "ended";
            _store.AppendSession(_session);   // 一次接入一条记录（含全部追问）
        }
        _session = null;
        SetAttachedLayout(false);
        _active = Workspace.Project;
        UpdateWorkspaceButtons();
        Send(new { type = "mode", mode = "space" });
        Send(new { type = "backflow", changed = changed.Take(50), evidence = "观察（文件系统差异，无归因）" });
        SendState();
    }

    // ---------- 桥 ----------

    private void Send(object message)
    {
        var json = JsonSerializer.Serialize(message, SendOpts);
        if (_uiView.InvokeRequired) _uiView.BeginInvoke(() => SafePost(json));
        else SafePost(json);
    }

    private void SafePost(string json)
    {
        try { _uiView.CoreWebView2?.PostWebMessageAsJson(json); } catch { }
    }
}

internal static class FormExtensions
{
    public static Task InvokeAsync(this Control control, Func<Task> action)
    {
        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        control.BeginInvoke(async () =>
        {
            try { await action(); tcs.SetResult(); }
            catch (Exception ex) { tcs.SetException(ex); }
        });
        return tcs.Task;
    }

    public static Task<T> InvokeAsync<T>(this Control control, Func<Task<T>> action)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        control.BeginInvoke(async () =>
        {
            try { tcs.SetResult(await action()); }
            catch (Exception ex) { tcs.SetException(ex); }
        });
        return tcs.Task;
    }
}
