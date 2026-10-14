using System.Diagnostics;
using System.Runtime.InteropServices;

namespace OmenLite;

public static class Booster
{
    [DllImport("dnsapi.dll")] static extern bool DnsFlushResolverCache();
    [DllImport("psapi.dll")] static extern bool EmptyWorkingSet(IntPtr hProcess);
    [DllImport("powrprof.dll")] static extern uint PowerSetActiveOverlayScheme(Guid scheme);
    [DllImport("powrprof.dll")] static extern uint PowerGetEffectiveOverlayScheme(out Guid scheme);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    static readonly Guid BestPerformance = new("ded574b5-45a0-4f42-8737-46345c09c238");

    public record CleanResult(double FreedMb, int Files, int Trimmed);
    public record BoostResult(string? Target, int Trimmed);

    /// Deletes temp files (skips locked ones), flushes DNS, trims process working sets.
    public static CleanResult CleanCache()
    {
        long freed = 0;
        int files = 0;
        foreach (var dir in new[] { Path.GetTempPath(), @"C:\Windows\Temp" })
        {
            if (!Directory.Exists(dir)) continue;
            foreach (var f in Directory.EnumerateFiles(dir, "*", new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true }))
            {
                try { var len = new FileInfo(f).Length; File.Delete(f); freed += len; files++; }
                catch { /* in use */ }
            }
            foreach (var d in Directory.EnumerateDirectories(dir))
                try { Directory.Delete(d, true); } catch { }
        }
        DnsFlushResolverCache();
        int trimmed = TrimWorkingSets(exceptPid: 0);
        return new(freed / 1048576.0, files, trimmed);
    }

    static int TrimWorkingSets(uint exceptPid)
    {
        int n = 0;
        foreach (var p in Process.GetProcesses())
        {
            using (p)
            {
                if (p.Id == exceptPid || p.Id <= 4 || p.Id == Environment.ProcessId) continue;
                try { if (EmptyWorkingSet(p.Handle)) n++; } catch { /* protected process */ }
            }
        }
        return n;
    }

    // ---- Game boost ----
    static Guid? _savedOverlay;
    static (int pid, ProcessPriorityClass prio)? _savedPrio;
    static Bios.PerfMode? _savedPerf;

    public static bool GameBoostActive => _savedOverlay != null;

    /// Performance thermal mode, Windows "best performance" overlay, game window High priority, trim the rest.
    public static BoostResult StartGameBoost(Bios.PerfMode currentPerf)
    {
        if (GameBoostActive) return new(null, 0);
        PowerGetEffectiveOverlayScheme(out var cur);
        _savedOverlay = cur;
        PowerSetActiveOverlayScheme(BestPerformance);

        _savedPerf = currentPerf;
        try { Bios.SetPerfMode(Bios.PerfMode.Performance); } catch { }

        uint pid = TopOtherAppPid();
        string? target = null;
        if (pid != 0)
        {
            try
            {
                var p = Process.GetProcessById((int)pid);
                _savedPrio = ((int)pid, p.PriorityClass);
                p.PriorityClass = ProcessPriorityClass.High;
                target = p.ProcessName;
            }
            catch { }
        }
        return new(target, TrimWorkingSets(pid));
    }

    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);

    /// The app the user was in: foreground window, or (when OmenLite itself is focused) the next visible titled window below it in z-order.
    static uint TopOtherAppPid()
    {
        const uint GW_HWNDNEXT = 2;
        for (var h = GetForegroundWindow(); h != IntPtr.Zero; h = GetWindow(h, GW_HWNDNEXT))
        {
            if (!IsWindowVisible(h) || GetWindowTextLength(h) == 0) continue;
            GetWindowThreadProcessId(h, out var pid);
            if (pid != 0 && pid != Environment.ProcessId) return pid;
        }
        return 0;
    }

    public static string StopGameBoost()
    {
        if (!GameBoostActive) return "Game boost already off";
        PowerSetActiveOverlayScheme(_savedOverlay!.Value);
        _savedOverlay = null;
        if (_savedPerf is { } perf) try { Bios.SetPerfMode(perf); } catch { }
        if (_savedPrio is { } sp)
            try { Process.GetProcessById(sp.pid).PriorityClass = sp.prio; } catch { }
        _savedPrio = null;
        return "Game boost off: settings restored";
    }
}
