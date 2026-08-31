using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Arckeep.Shell;

/// <summary>
/// kimi.com 登录窗（移植 v1 loginWindow）：共享 quota UDF，cookie 持久。
/// 打开额度页让用户登录；每 2s 跑一次提取脚本，ready 即视为登录成功并自关。
/// </summary>
internal sealed class QuotaLoginWindow : Form
{
    private readonly WebView2 _view = new() { Dock = DockStyle.Fill };
    private readonly System.Windows.Forms.Timer _poll = new() { Interval = 2000 };
    private bool _done;

    public QuotaLoginWindow(string udf)
    {
        Text = "登录 Kimi 以同步额度";
        Width = 1080;
        Height = 800;
        StartPosition = FormStartPosition.CenterScreen;
        _view.DefaultBackgroundColor = Color.FromArgb(0xF5, 0xF2, 0xEA); // 初始化期间不白屏
        Controls.Add(_view);
        var captured = udf;
        Shown += async (_, _) =>
        {
            try
            {
                Program.Log("登录窗：打开，初始化 webview");
                var env = await CoreWebView2Environment.CreateAsync(userDataFolder: captured);
                if (IsDisposed || _view.IsDisposed) return;   // 用户在初始化期间关了窗
                await _view.EnsureCoreWebView2Async(env);
                if (IsDisposed || _view.IsDisposed) return;
                _view.CoreWebView2.Navigate(QuotaService.QuotaUrl);
                Program.Log("登录窗：已导航到额度页");
                _poll.Tick += async (_, _) => await CheckAsync();
                _poll.Start();
            }
            catch (Exception ex)
            {
                Program.Log("登录窗初始化失败：" + ex.Message);
                if (!IsDisposed) Close();
            }
        };
    }

    /// <summary>测试用：抓取登录窗当前画面。</summary>
    public async Task CaptureAsync(string path)
    {
        if (_view.CoreWebView2 is null) return;
        await using var fs = File.Create(path);
        await _view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);
    }

    private async Task CheckAsync()
    {
        if (_done || IsDisposed || _view.IsDisposed || _view.CoreWebView2 is null) return;
        try
        {
            var json = await _view.CoreWebView2.ExecuteScriptAsync(QuotaScripts.Extraction);
            if (_done || IsDisposed) return;
            if (string.IsNullOrEmpty(json) || json is "null") return;
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("ready", out var ready) && ready.GetBoolean())
            {
                _done = true;
                _poll.Stop();
                Close();
            }
        }
        catch (Exception ex) when (ex is ObjectDisposedException or InvalidOperationException) { }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _poll.Stop();
        base.OnFormClosed(e);
    }
}
