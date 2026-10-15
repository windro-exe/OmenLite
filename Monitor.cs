using System.Diagnostics;
using System.Globalization;

namespace OmenLite;

/// NVIDIA GPU readings; every field is null when the driver doesn't report it (e.g. power limit on many laptops).
public record Gpu(int? Temp, int? PowerW, int? Clock, int? MemClock, int? VramUsed, int? VramTotal, int? Load, int? PowerLimit, string? State);

public record Snapshot(int CpuTemp, int CpuFan, int GpuFan, float CpuLoad, Gpu Gpu)
{
    public int? GpuTemp => Gpu.Temp;
    public int? GpuPowerW => Gpu.PowerW;
}

public static class Monitor
{
    static readonly PerformanceCounter Cpu = new("Processor Information", "% Processor Utility", "_Total");
    static readonly Gpu NoGpu = new(null, null, null, null, null, null, null, null, null);

    /// `gpu: false` skips nvidia-smi, which can keep a sleeping hybrid-mode GPU awake.
    public static Snapshot Read(bool gpu = true)
    {
        int cpuT = 0, f1 = 0, f2 = 0;
        try { cpuT = Bios.CpuTemp; } catch { }
        try { var r = Bios.FanRpm(); f1 = r[0]; f2 = r[1]; } catch { }
        return new(cpuT, f1, f2, Math.Min(100, Cpu.NextValue()), gpu ? NvidiaSmi() : NoGpu);
    }

    /// GPU details via nvidia-smi (ships with the NVIDIA driver). All null when absent or the GPU is asleep.
    static Gpu NvidiaSmi()
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo("nvidia-smi",
                "--query-gpu=temperature.gpu,power.draw,clocks.gr,clocks.mem,memory.used,memory.total,utilization.gpu,power.limit,pstate --format=csv,noheader,nounits")
            { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true })!;
            var line = p.StandardOutput.ReadLine();
            p.WaitForExit(2000);
            var f = line?.Split(',').Select(s => s.Trim()).ToArray();
            if (f is not { Length: 9 }) return NoGpu;
            int? I(int i) => double.TryParse(f[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? (int)Math.Round(v) : null; // "[N/A]" -> null
            return new(I(0), I(1), I(2), I(3), I(4), I(5), I(6), I(7), f[8].StartsWith('[') ? null : f[8]);
        }
        catch { return NoGpu; }
    }
}
