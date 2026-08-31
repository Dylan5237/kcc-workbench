using System.Text.Json;
using System.Text.Json.Serialization;

namespace Arckeep.Shell;

/// <summary>
/// `.arckeep/` 纯文件存储（v0.3.1 M4）。理解类数据的 Markdown 列表语法本骨架暂不发明：
/// status.md 用 front-matter + 正文；next/decisions 用 JSON（避免造出以后要迁移的坏语法）。
/// 全部写入原子化（tmp + 覆盖式 Move）。
/// </summary>
internal sealed class ProjectStore
{
    public string Root { get; }
    public string ArcDir => Path.Combine(Root, ".arckeep");

    public ProjectData Data { get; private set; } = new();

    private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = true };

    public ProjectStore(string root) => Root = root;

    public static string ArckeepDataDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Arckeep");

    public void LoadOrCreate()
    {
        Directory.CreateDirectory(ArcDir);
        Directory.CreateDirectory(Path.Combine(ArcDir, "history"));

        var projectFile = Path.Combine(ArcDir, "project.json");
        if (File.Exists(projectFile))
        {
            Data.Project = ReadJson<ProjectIdentity>(projectFile) ?? new ProjectIdentity();
        }
        else
        {
            Data.Project = new ProjectIdentity
            {
                ProjectId = Guid.NewGuid().ToString("N")[..12],
                Name = new DirectoryInfo(Root).Name,
                CreatedAt = DateTimeOffset.Now,
            };
            WriteJsonAtomic(projectFile, Data.Project);
        }

        var statusFile = Path.Combine(ArcDir, "status.md");
        if (File.Exists(statusFile))
        {
            Data.Status = StatusEntry.Parse(File.ReadAllText(statusFile));
        }
        else
        {
            Data.Status = new StatusEntry
            {
                Text = "这是一个新项目，还没有工作记录。",
                ConfirmedBy = "system",
                UpdatedAt = DateTimeOffset.Now,
            };
            WriteTextAtomic(statusFile, Data.Status.Serialize());
        }

        Data.Next = ReadJson<List<NextItem>>(Path.Combine(ArcDir, "next.json")) ?? DefaultNext();
        if (!File.Exists(Path.Combine(ArcDir, "next.json")))
            WriteJsonAtomic(Path.Combine(ArcDir, "next.json"), Data.Next);

        Data.Decisions = ReadJson<List<Decision>>(Path.Combine(ArcDir, "decisions.json")) ?? new List<Decision>();
        if (!File.Exists(Path.Combine(ArcDir, "decisions.json")))
            WriteJsonAtomic(Path.Combine(ArcDir, "decisions.json"), Data.Decisions);
    }

    public void SaveStatus(StatusEntry status)
    {
        Data.Status = status;
        WriteTextAtomic(Path.Combine(ArcDir, "status.md"), status.Serialize());
    }

    public void SaveContextMd(string brief)
    {
        var meta = $"<!-- version:1\nwrittenAt:{DateTimeOffset.Now:o}\nbriefHash:{Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(brief)))[..12]}\n-->\n";
        WriteTextAtomic(Path.Combine(ArcDir, "context.md"), meta + brief);
    }

    public void AppendSession(SessionRecord record)
    {
        var file = Path.Combine(ArcDir, "sessions.json");
        var list = ReadJson<List<SessionRecord>>(file) ?? new List<SessionRecord>();
        list.Add(record);
        WriteJsonAtomic(file, list);
    }

    // ---------- 待办交互（M2：采用不升格；确认/忽略是显式动作） ----------

    public void DismissNext(string id)
    {
        var item = Data.Next.FirstOrDefault(n => n.Id == id);
        if (item is null) return;
        Data.Next.Remove(item);
        WriteJsonAtomic(Path.Combine(ArcDir, "next.json"), Data.Next);
        var archive = Path.Combine(ArcDir, "history", "next-archive.json");
        var list = ReadJson<List<NextItem>>(archive) ?? new List<NextItem>();
        item.Epistemic = "已忽略";
        list.Add(item);
        WriteJsonAtomic(archive, list);
    }

    public void ConfirmNext(string id)
    {
        var item = Data.Next.FirstOrDefault(n => n.Id == id);
        if (item is null) return;
        item.Epistemic = "确认";
        item.Author = "user";
        item.ConfirmedAt = DateTimeOffset.Now;
        WriteJsonAtomic(Path.Combine(ArcDir, "next.json"), Data.Next);
    }

    public void AddNext(string text)
    {
        Data.Next.Add(new NextItem
        {
            Id = "u-" + Guid.NewGuid().ToString("N")[..8],
            Text = text.Trim(),
            Epistemic = "确认",
            Author = "user",
            SourceRef = new SourceRef { Type = "user", Ref = "你添加的", At = DateTimeOffset.Now },
            ConfirmedAt = DateTimeOffset.Now,
        });
        WriteJsonAtomic(Path.Combine(ArcDir, "next.json"), Data.Next);
    }

    private static T? ReadJson<T>(string file)
    {
        try { return File.Exists(file) ? JsonSerializer.Deserialize<T>(File.ReadAllText(file), JsonOpts) : default; }
        catch { return default; }
    }

    private static void WriteJsonAtomic<T>(string file, T value) =>
        WriteTextAtomic(file, JsonSerializer.Serialize(value, JsonOpts) + "\n");

    private static void WriteTextAtomic(string file, string content)
    {
        var tmp = file + ".tmp";
        File.WriteAllText(tmp, content);
        if (File.Exists(file)) File.Delete(file);
        File.Move(tmp, file);
    }

    private static List<NextItem> DefaultNext() => new()
    {
        new NextItem
        {
            Id = "n-welcome",
            Text = "写下这个项目当前的状态（点右上「改写」）",
            Epistemic = "推测",
            SourceRef = new SourceRef { Type = "system", Ref = "arckeep 初始化", At = DateTimeOffset.Now },
            ExpiresAt = DateTimeOffset.Now.AddDays(14),
        },
    };
}

internal sealed class ProjectData
{
    public ProjectIdentity Project { get; set; } = new();
    public StatusEntry Status { get; set; } = new();
    public List<NextItem> Next { get; set; } = new();
    public List<Decision> Decisions { get; set; } = new();
}

internal sealed class ProjectIdentity
{
    [JsonPropertyName("projectId")] public string ProjectId { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("createdAt")] public DateTimeOffset CreatedAt { get; set; }
}

internal sealed class StatusEntry
{
    public string Text { get; set; } = "";
    public string ConfirmedBy { get; set; } = "system";
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.Now;

    public string Serialize() =>
        $"---\nconfirmedBy: {ConfirmedBy}\nupdatedAt: {UpdatedAt:o}\n---\n{Text}\n";

    public static StatusEntry Parse(string raw)
    {
        var entry = new StatusEntry();
        var text = raw.Replace("\r\n", "\n");
        if (text.StartsWith("---\n"))
        {
            var end = text.IndexOf("\n---\n", 4, StringComparison.Ordinal);
            if (end > 0)
            {
                foreach (var line in text[4..end].Split('\n'))
                {
                    var kv = line.Split(':', 2);
                    if (kv.Length != 2) continue;
                    if (kv[0].Trim() == "confirmedBy") entry.ConfirmedBy = kv[1].Trim();
                    if (kv[0].Trim() == "updatedAt" && DateTimeOffset.TryParse(kv[1].Trim(), out var t)) entry.UpdatedAt = t;
                }
                entry.Text = text[(end + 5)..].Trim();
                return entry;
            }
        }
        entry.Text = text.Trim();
        return entry;
    }
}

internal sealed class NextItem
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("text")] public string Text { get; set; } = "";
    [JsonPropertyName("epistemic")] public string Epistemic { get; set; } = "推测";
    [JsonPropertyName("adoption")] public string Adoption { get; set; } = "未采用";
    [JsonPropertyName("author")] public string Author { get; set; } = "system";
    [JsonPropertyName("sourceRef")] public SourceRef? SourceRef { get; set; }
    [JsonPropertyName("confirmedAt")] public DateTimeOffset? ConfirmedAt { get; set; }
    [JsonPropertyName("expiresAt")] public DateTimeOffset? ExpiresAt { get; set; }
}

internal sealed class Decision
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("text")] public string Text { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "当前";
    [JsonPropertyName("sourceRef")] public SourceRef? SourceRef { get; set; }
    [JsonPropertyName("confirmedAt")] public DateTimeOffset? ConfirmedAt { get; set; }
}

internal sealed class SourceRef
{
    [JsonPropertyName("type")] public string Type { get; set; } = "user";
    [JsonPropertyName("ref")] public string Ref { get; set; } = "";
    [JsonPropertyName("at")] public DateTimeOffset At { get; set; }
}

internal sealed class SessionRecord
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("agent")] public string Agent { get; set; } = "kimi";
    [JsonPropertyName("acpSessionId")] public string AcpSessionId { get; set; } = "";
    [JsonPropertyName("startedAt")] public DateTimeOffset StartedAt { get; set; }
    [JsonPropertyName("endedAt")] public DateTimeOffset? EndedAt { get; set; }
    [JsonPropertyName("lifecycle")] public string Lifecycle { get; set; } = "active";
    [JsonPropertyName("stopReason")] public string? StopReason { get; set; }
    [JsonPropertyName("briefHash")] public string? BriefHash { get; set; }
}
