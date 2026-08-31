using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Arckeep.Shell;

/// <summary>
/// 额度模块（移植自 v1 quota-*）。隐藏 WebView2 打开 kimi.com 额度页，
/// 双通道竞速：官方 stats API（页面内 fetch，复用 cookie）+ DOM 提取脚本兜底。
/// cookie 落在持久 UDF（udfs/quota），登录一次长期有效。
/// 不搬运 forecast（用量预测），留待后续按需。
/// </summary>
internal sealed class QuotaService : IDisposable
{
    public const string QuotaUrl = "https://www.kimi.com/membership/subscription?tab=quota";
    private static readonly string QuotaDirPrivate = Path.Combine(ProjectStore.ArckeepDataDir, "udfs", "quota");
    internal static string QuotaDir => QuotaDirPrivate;
    private static readonly string QuotaFile = Path.Combine(ProjectStore.ArckeepDataDir, "quota.json");
    private static readonly TimeSpan AutoRefreshInterval = TimeSpan.FromMinutes(30); // (T) 暂定

    public event Action? OnStateChanged;
    public QuotaState State { get; private set; } = new();

    private Form? _hostForm;
    private WebView2? _view;
    private bool _scraping;
    private System.Threading.Timer? _timer;

    public void Initialize()
    {
        LoadSnapshot();
        _timer = new System.Threading.Timer(_ => _ = RefreshAsync(), null, AutoRefreshInterval, AutoRefreshInterval);
    }

    private void LoadSnapshot()
    {
        try
        {
            if (!File.Exists(QuotaFile)) return;
            var doc = JsonDocument.Parse(File.ReadAllText(QuotaFile));
            JsonElement? Pick(params string[] names)
            {
                foreach (var name in names)
                    if (doc.RootElement.TryGetProperty(name, out var v)) return v;
                return null;
            }
            var s = Pick("snapshot", "Snapshot");
            if (s is not null)
            {
                State.Snapshot = JsonSerializer.Deserialize<QuotaSnapshot>(s.Value.GetRawText());
                State.UpdatedAt = Pick("updatedAt", "UpdatedAt") is { } u && u.ValueKind == JsonValueKind.String
                    ? u.GetDateTimeOffset() : null;
                if (Pick("history", "History") is { } h && h.ValueKind == JsonValueKind.Array)
                    State.History = JsonSerializer.Deserialize<List<QuotaSnapshot>>(h.GetRawText()) ?? new List<QuotaSnapshot>();
                if (State.Snapshot is not null) State.Status = "ready";
            }
        }
        catch { }
    }

    private void SaveSnapshot()
    {
        try
        {
            Directory.CreateDirectory(ProjectStore.ArckeepDataDir);
            var tmp = QuotaFile + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(new { version = 2, State.Snapshot, State.UpdatedAt, State.History }, new JsonSerializerOptions { WriteIndented = true }));
            if (File.Exists(QuotaFile)) File.Delete(QuotaFile);
            File.Move(tmp, QuotaFile);
        }
        catch { }
    }

    private void SetStatus(string status, string error = "")
    {
        State.Status = status;
        State.Error = error;
        OnStateChanged?.Invoke();
    }

    public async Task RefreshAsync()
    {
        if (_scraping) return;
        _scraping = true;
        SetStatus("refreshing");
        try
        {
            var snapshot = await ScrapeAsync();
            State.Snapshot = snapshot;
            State.UpdatedAt = DateTimeOffset.Now;
            snapshot.UpdatedAt = State.UpdatedAt;
            State.History.Add(snapshot);
            if (State.History.Count > 60) State.History.RemoveRange(0, State.History.Count - 60);
            SaveSnapshot();
            SetStatus("ready");
        }
        catch (QuotaLoginRequiredException ex)
        {
            SetStatus("needs-login", ex.Message);
        }
        catch (Exception ex)
        {
            Program.Log("quota 刷新失败：" + ex.Message);
            SetStatus(State.Snapshot is not null ? "ready" : "error", ex.Message);
        }
        finally
        {
            _scraping = false;
        }
    }

    // ---------- 抓取 ----------

    private async Task EnsureViewAsync()
    {
        if (_view is not null) return;
        Program.Log("quota: EnsureViewAsync start");
        // WebView2 需要有宿主持久层才能合成渲染；用一个离屏小窗承载
        _hostForm = new Form
        {
            Width = 1200,
            Height = 900,
            StartPosition = FormStartPosition.Manual,
            Location = new Point(-32000, -32000),
            ShowInTaskbar = false,
            FormBorderStyle = FormBorderStyle.None,
        };
        _view = new WebView2 { Dock = DockStyle.Fill };
        _hostForm.Controls.Add(_view);
        _hostForm.Show();
        Program.Log("quota: host form shown");
        var env = await CoreWebView2Environment.CreateAsync(userDataFolder: QuotaDir);
        Program.Log("quota: env created");
        await _view.EnsureCoreWebView2Async(env);
        Program.Log("quota: webview ready");
        _view.CoreWebView2.Settings.AreDefaultScriptDialogsEnabled = false;
    }

    private async Task<QuotaSnapshot> ScrapeAsync()
    {
        await EnsureViewAsync();
        await NavigateWithRetryAsync();
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(40);
        QuotaSnapshot? lastDom = null;
        QuotaSnapshot? apiReady = null;
        DateTime? apiReadyAt = null;
        var nextApiAt = DateTime.MinValue;

        while (DateTime.UtcNow < deadline)
        {
            var dom = await RunScriptAsync<QuotaSnapshot>(QuotaScripts.Extraction);
            if (dom is not null) lastDom = dom;

            if (DateTime.UtcNow >= nextApiAt)
            {
                var api = await RunScriptAsync<StatsApiResult>(QuotaScripts.StatsRequest);
                if (api is { Ok: true, Payload: not null })
                {
                    var mapped = MapQuotaStats(api.Payload.Value, lastDom?.MembershipPlan ?? "");
                    if (mapped.Ready)
                    {
                        apiReady = mapped;
                        apiReadyAt ??= DateTime.UtcNow;
                        // 等 DOM 一小段时间补会员名（v1 同款竞速逻辑）
                        if (mapped.MembershipPlan.Length > 0 || DateTime.UtcNow - apiReadyAt.Value >= TimeSpan.FromMilliseconds(2500))
                            return mapped;
                    }
                }
                nextApiAt = DateTime.UtcNow + TimeSpan.FromMilliseconds(1500);
            }

            if (lastDom is { Ready: true } && (lastDom.MembershipPlan.Length > 0 || apiReady is null))
                return lastDom;
            if (lastDom is { LikelyLoggedOut: true })
                throw new QuotaLoginRequiredException(lastDom.Error);

            await Task.Delay(700);
        }
        throw new TimeoutException(lastDom?.Error ?? "额度页面加载超时。");
    }

    private async Task NavigateWithRetryAsync()
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var tcs = new TaskCompletionSource<bool>();
            void Handler(object? s, CoreWebView2NavigationCompletedEventArgs e) => tcs.TrySetResult(e.IsSuccess);
            _view!.CoreWebView2.NavigationCompleted += Handler;
            try
            {
                var url = attempt == 0 ? QuotaUrl : $"{QuotaUrl}&__kcc_refresh={DateTimeOffset.Now.ToUnixTimeMilliseconds()}-{attempt}";
                _view.CoreWebView2.Navigate(url);
                var done = await Task.WhenAny(tcs.Task, Task.Delay(15000));
                if (done == tcs.Task && tcs.Task.Result) return;
            }
            finally
            {
                _view!.CoreWebView2.NavigationCompleted -= Handler;
            }
            await Task.Delay(500 * (attempt + 1));
        }
        throw new TimeoutException("额度页面导航失败。");
    }

    private async Task<T?> RunScriptAsync<T>(string script) where T : class
    {
        try
        {
            var json = await _view!.CoreWebView2.ExecuteScriptAsync(script);
            if (string.IsNullOrEmpty(json) || json is "null" or "undefined") return null;
            return JsonSerializer.Deserialize<T>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch { return null; }
    }

    // ---------- 登录 ----------

    /// <summary>打开 kimi.com 登录窗（共享 quota UDF，cookie 持久）。登录成功后自动刷新。</summary>
    public async Task ShowLoginAndRefreshAsync(Form owner)
    {
        try
        {
            using var login = new QuotaLoginWindow(QuotaDir);
            login.ShowDialog(owner);
            await Task.Delay(800); // 等登录窗的 WebView2 进程释放 UDF，避免与抓取视图争锁
            await RefreshAsync();
        }
        catch (Exception ex)
        {
            Program.Log("登录/刷新失败：" + ex);
        }
    }

    /// <summary>调试：真实抓取一次，把 DOM 提取、stats API、页面文本三个通道的原始结果落日志。</summary>
    public async Task RefreshDebugAsync()
    {
        await EnsureViewAsync();
        await NavigateWithRetryAsync();
        await Task.Delay(4000); // 等 SPA 渲染
        var dom = await _view!.CoreWebView2.ExecuteScriptAsync(QuotaScripts.Extraction);
        Program.Log("quota-debug DOM: " + (dom.Length > 1200 ? dom[..1200] : dom));
        var api = await _view.CoreWebView2.ExecuteScriptAsync(QuotaScripts.StatsRequest);
        Program.Log("quota-debug API: " + (api.Length > 1200 ? api[..1200] : api));
        var probe = await _view.CoreWebView2.ExecuteScriptAsync("document.body ? document.body.innerText.slice(0, 500) : ''");
        Program.Log("quota-debug text: " + (probe.Length > 600 ? probe[..600] : probe));
    }

    /// <summary>v1 同款 fixture 自测：静态 HTML 跑提取脚本，验证移植正确性（ARCKEEP_QUOTA_FIXTURE=<out.json>）。</summary>
    public async Task<string> RunFixtureAsync()
    {
        await EnsureViewAsync();
        var tcs = new TaskCompletionSource();
        _view!.CoreWebView2.NavigationCompleted += (_, _) => tcs.TrySetResult();
        _view.CoreWebView2.NavigateToString(FixtureHtml);
        await Task.WhenAny(tcs.Task, Task.Delay(10000));
        var json = await _view.CoreWebView2.ExecuteScriptAsync(QuotaScripts.Extraction);
        using var doc = JsonDocument.Parse(json);
        var ready = doc.RootElement.TryGetProperty("ready", out var r) && r.GetBoolean();
        if (!ready) return "FAIL: " + json[..Math.Min(300, json.Length)];
        return "OK " + json[..Math.Min(500, json.Length)];
    }

    private const string FixtureHtml = """
        <!doctype html>
        <html lang="zh-CN"><head><meta charset="utf-8"><style>
        body { font-family: sans-serif; padding: 24px; }
        .panel { width: 720px; }
        .total-label { font-size: 18px; }
        .track { display: flex; width: 640px; height: 18px; margin: 18px 0; background: #eee; }
        .kimi { width: 14.70%; background: rgb(28,28,28); }
        .code { width: 3.92%; background: rgb(55,124,246); }
        .remaining { flex: 1; }
        .section { margin-top: 28px; padding-top: 18px; border-top: 1px solid #ddd; }
        </style></head><body>
        <div class="panel">
          <div class="membership-plan" data-active="true">Allegretto</div>
          <div class="total-label">总额度 <span>18.62%</span></div>
          <div class="track"><div class="kimi"></div><div class="code"></div><div class="remaining"></div></div>
          <div>Kimi　14.70%</div>
          <div>Code　3.92%</div>
          <div>2026-08-25 后重置</div>
          <div class="section"><div>5 小时用量</div><div>Code　31.37%</div><div>07-27 13:13 后重置</div></div>
          <div class="section"><div>7 天用量</div><div>Code　18.41%</div><div>08-01 11:13 后重置</div></div>
        </div></body></html>
        """;

    public void Dispose()
    {
        _timer?.Dispose();
        try { _hostForm?.Close(); } catch { }
    }

    // ---------- stats API 映射（移植自 v1 quota-api.js） ----------

    private static QuotaSnapshot MapQuotaStats(JsonElement payload, string planHint)
    {
        var source = payload.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object ? data : payload;
        var balance = FirstObject(source, "subscription_balance", "subscriptionBalance");
        var total = PercentFromRatio(FirstValue(balance, "amount_used_ratio", "amountUsedRatio"));
        var code = PercentFromRatio(FirstValue(balance, "kimi_code_used_ratio", "kimiCodeUsedRatio"));
        double? codePercent = code ?? (total is null ? null : 0);
        double? kimiPercent = total is null || codePercent is null ? null : Math.Max(total.Value - codePercent.Value, 0);
        var five = FirstObject(source, "ratelimit_code_5h", "ratelimitCode5h");
        var seven = FirstObject(source, "ratelimit_code_7d", "ratelimitCode7d");

        var plan = NormalizePlan(planHint);
        if (plan.Length == 0) plan = FindPlan(source);

        var snap = new QuotaSnapshot
        {
            MembershipPlan = plan,
            TotalPercent = total ?? 0,
            KimiPercent = kimiPercent ?? 0,
            CodePercent = codePercent ?? 0,
            FiveHourPercent = PercentFromRatio(FirstValue(five, "ratio")) ?? 0,
            SevenDayPercent = PercentFromRatio(FirstValue(seven, "ratio")) ?? 0,
            TotalReset = FormatResetDate(FirstValue(balance, "expire_time", "expireTime")),
            FiveHourReset = FormatResetTime(FirstValue(five, "reset_time", "resetTime")),
            SevenDayReset = FormatResetTime(FirstValue(seven, "reset_time", "resetTime")),
        };
        snap.Ready = total is not null && kimiPercent is not null && codePercent is not null
            && PercentFromRatio(FirstValue(five, "ratio")) is not null
            && PercentFromRatio(FirstValue(seven, "ratio")) is not null
            && snap.TotalReset.Length > 0 && snap.FiveHourReset.Length > 0 && snap.SevenDayReset.Length > 0;
        if (!snap.Ready) snap.Error = "官方额度接口未返回完整数据。";
        return snap;
    }

    private static JsonElement? FirstObject(JsonElement? source, params string[] keys)
    {
        var value = FirstValue(source, keys);
        return value is { ValueKind: JsonValueKind.Object } ? value : null;
    }

    private static JsonElement? FirstValue(JsonElement? source, params string[] keys)
    {
        if (source is null || source.Value.ValueKind != JsonValueKind.Object) return null;
        foreach (var key in keys)
            if (source.Value.TryGetProperty(key, out var value) && value.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined)
                return value;
        return null;
    }

    private static double? PercentFromRatio(JsonElement? value)
    {
        if (value is null) return null;
        double number;
        if (value.Value.ValueKind == JsonValueKind.Number) number = value.Value.GetDouble();
        else if (value.Value.ValueKind == JsonValueKind.String && double.TryParse(value.Value.GetString(), out var parsed)) number = parsed;
        else return null;
        if (number < 0) return null;
        var percent = number <= 1 ? number * 100 : number;
        return percent <= 100 ? Math.Round(percent, 2) : null;
    }

    private static DateTime? TimestampToDate(JsonElement? value)
    {
        if (value is null) return null;
        try
        {
            if (value.Value.ValueKind == JsonValueKind.Number)
            {
                var number = value.Value.GetDouble();
                if (number <= 0) return null;
                return DateTimeOffset.FromUnixTimeMilliseconds(number < 1e12 ? (long)number * 1000 : (long)number).LocalDateTime;
            }
            if (value.Value.ValueKind == JsonValueKind.String)
            {
                if (double.TryParse(value.Value.GetString(), out var number) && number > 0)
                    return DateTimeOffset.FromUnixTimeMilliseconds(number < 1e12 ? (long)number * 1000 : (long)number).LocalDateTime;
                if (DateTime.TryParse(value.Value.GetString(), out var parsed)) return parsed;
            }
            if (value.Value.ValueKind == JsonValueKind.Object)
            {
                var seconds = FirstValue(value, "seconds");
                if (seconds is { ValueKind: JsonValueKind.Number })
                    return DateTimeOffset.FromUnixTimeSeconds(seconds.Value.GetInt64()).LocalDateTime;
            }
        }
        catch { }
        return null;
    }

    private static string FormatResetDate(JsonElement? value)
    {
        var date = TimestampToDate(value);
        return date is null ? "" : date.Value.ToString("yyyy-MM-dd");
    }

    private static string FormatResetTime(JsonElement? value)
    {
        var date = TimestampToDate(value);
        return date is null ? "" : date.Value.ToString("MM-dd HH:mm");
    }

    private static readonly string[] Plans = { "Allegretto", "Allegro", "Moderato", "Vivace" };

    private static string NormalizePlan(string value)
    {
        var trimmed = (value ?? "").Trim();
        if (trimmed.Length == 0 || trimmed == "会员") return "";
        return Plans.FirstOrDefault(p => string.Equals(p, trimmed, StringComparison.OrdinalIgnoreCase)) ?? "";
    }

    private static string FindPlan(JsonElement? source)
    {
        if (source is null || source.Value.ValueKind != JsonValueKind.Object) return "";
        foreach (var prop in source.Value.EnumerateObject())
        {
            if (prop.Value.ValueKind == JsonValueKind.String &&
                System.Text.RegularExpressions.Regex.IsMatch(prop.Name, "plan|subscription|tier|level", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            {
                var plan = NormalizePlan(prop.Value.GetString() ?? "");
                if (plan.Length > 0) return plan;
            }
            if (prop.Value.ValueKind == JsonValueKind.Object)
            {
                var nested = FindPlan(prop.Value);
                if (nested.Length > 0) return nested;
            }
        }
        return "";
    }
}

internal sealed class QuotaState
{
    public string Status { get; set; } = "idle"; // idle / refreshing / ready / needs-login / error
    public QuotaSnapshot? Snapshot { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public List<QuotaSnapshot> History { get; set; } = new();
    public string Error { get; set; } = "";
}

internal sealed class QuotaSnapshot
{
    public bool Ready { get; set; }
    public bool LikelyLoggedOut { get; set; }
    public string MembershipPlan { get; set; } = "";
    public double TotalPercent { get; set; }
    public double KimiPercent { get; set; }
    public double CodePercent { get; set; }
    public double FiveHourPercent { get; set; }
    public double SevenDayPercent { get; set; }
    public string TotalReset { get; set; } = "";
    public string FiveHourReset { get; set; } = "";
    public string SevenDayReset { get; set; } = "";
    public string Error { get; set; } = "";
    public DateTimeOffset? UpdatedAt { get; set; }
}

internal sealed class StatsApiResult
{
    public bool Ok { get; set; }
    public JsonElement? Payload { get; set; }
}

internal sealed class QuotaLoginRequiredException : Exception
{
    public QuotaLoginRequiredException(string message) : base(message) { }
}
