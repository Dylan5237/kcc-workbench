using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Arckeep.Shell;

/// <summary>
/// Arckeep 主窗口。空间模式：Arckeep UI 铺满；接入态：左侧 Kimi Web 原生界面（大块）
/// + 右侧 320px 项目侧轨（同一 UI 切 rail 模式）。
/// 控制平面走 ACP（简报交付证据），视觉平面是 agent 原生 Web UI（D-20 接入 ≠ 改造）。
/// </summary>
internal sealed class ShellWindow : Form
{
    private static readonly string UiDir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "ui"));
    private static readonly string UiDirDev = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "arckeep", "ui"));
    private const int RailWidth = 320;

    private readonly TableLayoutPanel _layout = new() { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1 };
    private readonly WebView2 _agentView = new() { Dock = DockStyle.Fill, Visible = false };
    private readonly WebView2 _uiView = new() { Dock = DockStyle.Fill };
    private readonly WebView2 _viewerView = new() { Dock = DockStyle.Fill, Visible = false };
    private readonly Panel _titleBar = new() { Dock = DockStyle.Top, Height = 36, BackColor = Color.FromArgb(0xF5, 0xF2, 0xEA) };
    private readonly Label _quotaChip = new() { AutoSize = false, TextAlign = ContentAlignment.MiddleCenter };

    private ProjectStore? _store;
    private AcpClient? _acp;
    private readonly KimiWebService _kimiWeb = new();
    private readonly QuotaService _quota = new();
    private readonly ViewerService _viewer = new();
    private string? _selectedNextId;
    private Dictionary<string, (long Ticks, long Length)>? _fsSnapshot;
    private SessionRecord? _session;
    private bool _attached;
    private bool _agentReady;
    private bool _viewerReady;
    private bool _viewerActive;
    private string? _viewerLoadedUrl;
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

        _layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 0F));   // agent（接入态展开）
        _layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));  // Arckeep UI
        _layout.Controls.Add(_agentView, 0, 0);
        _layout.Controls.Add(_uiView, 1, 0);
        _layout.Controls.Add(_viewerView, 0, 0);   // 与 agent 同格但跨两列，激活时置顶覆盖
        _layout.SetColumnSpan(_viewerView, 2);
        Controls.Add(_layout);
        Controls.Add(_titleBar);   // 后加入者先 dock：标题栏占顶部，内容铺满剩余

        Shown += async (_, _) => await OnShownAsync();
        FormClosed += (_, _) => { _acp?.Dispose(); _kimiWeb.Dispose(); _quota.Dispose(); _viewer.Dispose(); };
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

        _btnViewer = TitleButton("Viewer", 56);
        _btnViewer.Click += async (_, _) => await ToggleViewerAsync();

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
        _titleBar.Controls.Add(_quotaChip);
        _titleBar.Controls.Add(_btnViewer);
        _titleBar.Controls.Add(btnMin);
        _titleBar.Controls.Add(btnMax);
        _titleBar.Controls.Add(btnClose);
        _titleBar.Resize += (_, _) =>
        {
            btnClose.Left = _titleBar.Width - 40;
            btnMax.Left = _titleBar.Width - 80;
            btnMin.Left = _titleBar.Width - 120;
            _btnViewer.Left = _titleBar.Width - 182;
            _quotaChip.Width = Math.Max(60, _quotaChip.PreferredSize.Width == 0 ? 150 : _quotaChip.PreferredSize.Width + 16);
            _quotaChip.Left = _btnViewer.Left - _quotaChip.Width - 10;
            _quotaChip.Top = 7;
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
                    await ToggleViewerAsync();
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
                            _viewerView.Visible = false;   // ToggleViewerAsync 的关闭半段（UI 线程）
                            _viewerActive = false;
                            UpdateViewerButton();
                            return Task.CompletedTask;
                        });
                        await ToggleViewerAsync();   // 重新打开 = 重启 sidecar + 重新导航
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
            case "open-viewer": _ = ToggleViewerAsync(); break;
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
        _store = new ProjectStore(dialog.SelectedPath);
        _store.LoadOrCreate();
        Directory.CreateDirectory(ProjectStore.ArckeepDataDir);
        File.WriteAllText(
            Path.Combine(ProjectStore.ArckeepDataDir, "registry.json"),
            JsonSerializer.Serialize(new { lastProjectPath = _store.Root, lastProjectId = _store.Data.Project.ProjectId }, new JsonSerializerOptions { WriteIndented = true }));
        SyncViewerRoot();
        SendState();
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

        // 视觉平面：agent webview 初始化 + kimi web 后台启动
        await this.InvokeAsync(async () =>
        {
            await EnsureAgentViewAsync();
            _agentView.CoreWebView2.NavigateToString(
                "<body style='background:#F5F2EA;color:#66635D;font:13px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>正在启动 Kimi Code…</body>");
        });
        _ = Task.Run(async () =>
        {
            try
            {
                var url = await _kimiWeb.StartAsync(cwd);
                await this.InvokeAsync(() =>
                {
                    _agentView.CoreWebView2.Navigate(url);
                    return Task.CompletedTask;
                });
            }
            catch (Exception ex)
            {
                Program.Log("kimi web 启动失败：" + ex.Message);
                _kimiWeb.Failure = ex;
                await this.InvokeAsync(() =>
                {
                    _agentView.CoreWebView2.NavigateToString(
                        "<body style='background:#F5F2EA;color:#8E3C32;font:13px sans-serif;padding:32px'>Kimi Web 启动失败：" +
                        System.Net.WebUtility.HtmlEncode(ex.Message) + "</body>");
                    return Task.CompletedTask;
                });
            }
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

    // ---------- Viewer（KCC Viewer sidecar + WebView2，D0-04） ----------

    private async Task EnsureViewerViewAsync()
    {
        if (_viewerReady) return;
        var udf = Path.Combine(ProjectStore.ArckeepDataDir, "udfs", "viewer");
        var env = await CoreWebView2Environment.CreateAsync(userDataFolder: udf);
        await _viewerView.EnsureCoreWebView2Async(env);
        _viewerReady = true;
    }

    /// <summary>Viewer 模式开关：只切可见性，不销毁任何工作面（agent/UI webview 保持运行）。</summary>
    private async Task ToggleViewerAsync()
    {
        if (_viewerActive)
        {
            _viewerActive = false;
            _viewerView.Visible = false;
            UpdateViewerButton();
            return;
        }
        if (_store is null) return;   // 未打开项目时没有可检查的根目录

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
                _viewerView.CoreWebView2.NavigateToString(
                    "<body style='background:#F5F2EA;color:#8E3C32;font:13px sans-serif;padding:32px'>Viewer 启动失败：" +
                    System.Net.WebUtility.HtmlEncode(_viewer.Failure?.Message ?? "未知原因") +
                    "（工作面不受影响；关闭本面板即可继续）</body>");
            }
            _viewerActive = true;
            _viewerView.Visible = true;
            _viewerView.BringToFront();
            UpdateViewerButton();
        });
    }

    private void UpdateViewerButton()
    {
        if (_btnViewer is null) return;
        _btnViewer.Text = _viewerActive ? "← 返回" : "Viewer";
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
        _layout.ColumnStyles[0] = new ColumnStyle(SizeType.Percent, attached ? 100F : 0F);
        _layout.ColumnStyles[1] = new ColumnStyle(attached ? SizeType.Absolute : SizeType.Percent, attached ? RailWidth : 100F);
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
