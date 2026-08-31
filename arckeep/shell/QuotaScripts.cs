namespace Arckeep.Shell;

/// <summary>移植自 v1 的页面脚本。DOM 提取脚本以资产文件原样携带（assets/quota-extract.js，与 src/main/quota-extract.js 的 String.raw 内容逐字节一致）。</summary>
internal static class QuotaScripts
{
    private static string? _extraction;

    public static string Extraction => _extraction ??= File.ReadAllText(
        Path.Combine(AppContext.BaseDirectory, "assets", "quota-extract.js"));
    public const string StatsApiPath = "/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats";

    public const string StatsRequest = """
    (async () => {
      try {
        const token = localStorage.getItem('access_token') || localStorage.getItem('auth-token') || ''
        const headers = {
          'Content-Type': 'application/json',
          'x-msh-platform': 'web',
          'x-msh-version': '2.0.0',
          'R-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
          'X-Language': document.documentElement?.lang || 'zh-CN'
        }
        try {
          const tokenInfo = JSON.parse(localStorage.getItem('volcano-token-info') || 'null')
          if (tokenInfo?.userId) headers['X-Traffic-Id'] = tokenInfo.userId
          if (tokenInfo?.webId) headers['x-msh-device-id'] = tokenInfo.webId
          if (tokenInfo?.ssid) headers['x-msh-session-id'] = tokenInfo.ssid
        } catch {}
        if (token) headers.Authorization = 'Bearer ' + token
        const response = await fetch('/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats', {
          method: 'POST',
          headers,
          credentials: 'include',
          cache: 'no-store',
          body: '{}'
        })
        const text = await response.text()
        let payload = null
        try { payload = JSON.parse(text) } catch {}
        return { ok: response.ok, status: response.status, payload }
      } catch (error) {
        return { ok: false, status: null, payload: null, error: String(error) }
      }
    })()
    """;
}
