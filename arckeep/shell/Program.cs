using System.Windows.Forms;

namespace Arckeep.Shell;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        // 全局异常落日志：用户报"报错"时有现场可查
        Application.ThreadException += (_, e) => Log("UI 线程异常：" + e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log("未处理异常：" + e.ExceptionObject);
        TaskScheduler.UnobservedTaskException += (_, e) => { Log("未观察任务异常：" + e.Exception); e.SetObserved(); };
        Application.Run(new ShellWindow());
    }

    /// <summary>壳日志：%APPDATA%/Arckeep/shell.log（不记 token）。</summary>
    internal static void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(ProjectStore.ArckeepDataDir);
            File.AppendAllText(Path.Combine(ProjectStore.ArckeepDataDir, "shell.log"),
                $"[{DateTime.Now:HH:mm:ss.fff}] {message}\n");
        }
        catch { }
    }
}
