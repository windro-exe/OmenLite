using System.Diagnostics;
using System.Management;
using WinForms = System.Windows.Forms;

namespace OmenLite;

/// Read-only battery and charger readings: Windows power status, battery WMI, and the BIOS adapter check OMEN Gaming Hub uses.
public static class Power
{
    public static object Read()
    {
        var ps = WinForms.SystemInformation.PowerStatus;
        bool present = (ps.BatteryChargeStatus & WinForms.BatteryChargeStatus.NoSystemBattery) == 0;
        bool ac = ps.PowerLineStatus == WinForms.PowerLineStatus.Online;
        double? percent = ps.BatteryLifePercent is >= 0 and <= 1 ? Math.Round(ps.BatteryLifePercent * 100) : null;
        bool charging = (ps.BatteryChargeStatus & WinForms.BatteryChargeStatus.Charging) != 0;
        string state = charging ? "charging" : ac ? (percent >= 99 ? "full" : "plugged") : "discharging";

        double? watts = null, full = null, design = null;
        try
        {
            using var s = new ManagementObjectSearcher(@"root\wmi", "SELECT ChargeRate, DischargeRate, Charging, Discharging FROM BatteryStatus");
            if (s.Get().Cast<ManagementObject>().FirstOrDefault() is { } b)
            {
                long rate = Convert.ToInt64(Convert.ToBoolean(b["Charging"]) ? b["ChargeRate"] : b["DischargeRate"]); // mW
                if (rate > 0 && rate != int.MinValue) watts = Math.Round(rate / 1000.0, 1);
            }
        }
        catch { }
        try { full = Wh(@"root\wmi", "BatteryFullChargedCapacity", "FullChargedCapacity"); } catch { }
        try { design = Wh(@"root\wmi", "BatteryStaticData", "DesignedCapacity") ?? Wh(@"root\cimv2", "Win32_Battery", "DesignCapacity"); } catch { }
        // Many firmwares report design == full capacity, which says nothing about wear; only a real shortfall counts.
        int? wear = full > 0 && design > full ? (int)Math.Clamp(Math.Round((1 - full.Value / design.Value) * 100), 0, 100) : null;

        var (status, adapterWatts) = ac ? Adapter() : ("battery", null);
        return new
        {
            present, percent, state, acOnline = ac, watts,
            minutesLeft = !ac && ps.BatteryLifeRemaining > 0 ? (int?)(ps.BatteryLifeRemaining / 60) : null,
            capacityWh = full, designWh = design, wearPct = wear,
            adapterStatus = status, adapterWatts,
        };
    }

    /// mWh -> Wh; null when the property is missing or reports 0.
    static double? Wh(string scope, string cls, string prop)
    {
        using var s = new ManagementObjectSearcher(scope, $"SELECT {prop} FROM {cls}");
        var v = s.Get().Cast<ManagementObject>().Select(o => o[prop]).FirstOrDefault();
        return v != null && Convert.ToInt64(v) is > 0 and var mwh ? Math.Round(mwh / 1000.0, 1) : null;
    }

    /// BIOS legacy command 0x0F (as Hub): byte 0 adapter status, byte 2 Type-C design rating and byte 3 charger rating, both in 5 W steps.
    static (string, int?) Adapter()
    {
        try
        {
            var d = Bios.Call(1, 0x0F, null, 4);
            int rating = d[3] == 0xFF ? 0 : d[3] * 5, designRating = d[2] * 5;
            string status = d[0] switch
            {
                1 => "ok",
                2 => "below",
                3 => "battery",
                4 => "notFunctioning",
                5 => rating > 0 && rating < designRating ? "below" : "typeC",
                _ => "unknown",
            };
            return (status, rating > 0 ? rating : null);
        }
        catch { return ("unknown", null); }
    }
}

/// What the BIOS reports about this laptop, and whether HP's OMEN app agrees with the hardware.
public static class SystemReport
{
    public static object Read(string model, string bios, Bios.PerfMode? savedPerf)
    {
        T? Try<T>(Func<T> f) { try { return f(); } catch { return default; } }
        return new
        {
            model, bios,
            board = Wmi("Win32_BaseBoard", "Product"),
            appVersion = FileVersionInfo.GetVersionInfo(Environment.ProcessPath!).ProductVersion?.Split('+')[0] ?? "",
            thermalPolicy = Try<int?>(() => Bios.ThermalPolicyVersion),
            fanCount = Try<int?>(() => Bios.FanCount),
            fanMin = Bios.Curve.MinRpm, fanMax = Bios.Curve.MaxRpm,
            keyboardType = Try<int?>(() => Bios.KeyboardType),
            fourZone = Bios.HasFourZone,
            gpuModes = Bios.SupportedGpuModes(),
            gpuMode = Try<Bios.GpuMode?>(() => Bios.GetGpuMode()),
            hub = Hub(savedPerf),
        };
    }

    /// Compares what HP's app has saved with the hardware right now. `savedPerf` is null until OmenLite has set a mode
    /// (the BIOS can't be asked), in which case the mode isn't compared.
    static object Hub(Bios.PerfMode? mode)
    {
        if (!HubSync.Installed) return new { installed = false, inSync = (bool?)null, differences = Array.Empty<string>() };
        var diff = new List<string>();
        bool known = false;
        void Check(string what, int? hub, Func<int> hardware)
        {
            if (hub is not { } h) return;
            known = true;
            try { if (h != hardware()) diff.Add(what); } catch { }
        }
        var zones = Bios.GetZones();
        for (int i = 0; i < 4; i++)
        {
            int zi = i;
            Check("Keyboard colours", HubSync.Get("FourZoneLighting", "Z" + i), () => zones[zi].R << 16 | zones[zi].G << 8 | zones[zi].B);
        }
        Check("Keyboard backlight", HubSync.Get("FourZoneLighting", "DefaultMode"), () => Bios.Backlight ? 0 : 1);
        Check("Max fan", HubSync.Get("PerformanceControl", "MaxFan"), () => Bios.MaxFan ? 1 : 0);
        if (mode is { } m) Check("Performance mode", HubSync.Get("PerformanceControl", "Mode"), () => Bios.PerfCode(m));
        return new { installed = true, inSync = known ? diff.Count == 0 : (bool?)null, differences = diff.Distinct().ToArray() };
    }

    static string Wmi(string cls, string prop)
    {
        try
        {
            using var s = new ManagementObjectSearcher($"SELECT {prop} FROM {cls}");
            return s.Get().Cast<ManagementObject>().Select(o => o[prop]?.ToString()).FirstOrDefault() ?? "—";
        }
        catch { return "—"; }
    }
}
