using System.Diagnostics;

namespace OmenLite;

public record Snapshot(int CpuTemp, int? GpuTemp, int CpuFan, int GpuFan, float CpuLoad, int? GpuPowerW);

public static class Monitor
{
    static readonly PerformanceCounter Cpu = new("Processor Information", "% Processor Utility", "_Total");

    public static Snapshot Read()
    {
        int cpuT = 0, f1 = 0, f2 = 0;
        try { cpuT = Bios.CpuTemp; } catch { }
        try { var r = Bios.FanRpm(); f1 = r[0]; f2 = r[1]; } catch { }
        var (gT, gP) = NvidiaSmi();
        return new(cpuT, gT, f1, f2, Math.Min(100, Cpu.NextValue()), gP);
    }

    /// GPU temp/power via nvidia-smi (ships with NVIDIA driver). Null when absent or GPU asleep.
    static (int?, int?) NvidiaSmi()
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo("nvidia-smi", "--query-gpu=temperature.gpu,power.draw --format=csv,noheader,nounits")
            { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true })!;
            var line = p.StandardOutput.ReadLine();
            p.WaitForExit(2000);
            var parts = line?.Split(',');
            if (parts is not { Length: 2 }) return (null, null);
            int? t = int.TryParse(parts[0].Trim(), out var tv) ? tv : null;
            int? w = double.TryParse(parts[1].Trim(), System.Globalization.CultureInfo.InvariantCulture, out var wv) ? (int)wv : null;
            return (t, w);
        }
        catch { return (null, null); }
    }
}
