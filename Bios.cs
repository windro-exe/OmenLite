using System.Management;

namespace OmenLite;

/// HP BIOS WMI interface (root\wmi hpqBIntM.hpqBIOSInt128), same channel OMEN Gaming Hub uses.
/// Command IDs match the public Linux hp-wmi driver / OmenMon; confirmed on hardware via --probe.
public static class Bios
{
    const uint Legacy = 0x01, LegacySet = 0x02, Gaming = 0x20008, Lighting = 0x20009;
    static readonly byte[] Sign = "SECU"u8.ToArray();

    public sealed class BiosException(string msg) : Exception(msg);

    /// Returns output data; throws on non-zero BIOS return code.
    public static byte[] Call(uint command, uint type, byte[]? input = null, int outSize = 128)
    {
        input ??= new byte[4];
        using var cls = new ManagementClass(@"root\wmi", "hpqBIntM", null);
        using var inst = cls.GetInstances().Cast<ManagementObject>().First();
        using var dataIn = new ManagementClass(@"root\wmi", "hpqBDataIn", null).CreateInstance();
        dataIn["Sign"] = Sign;
        dataIn["Command"] = command;
        dataIn["CommandType"] = type;
        dataIn["Size"] = (uint)input.Length;
        dataIn["hpqBData"] = input; // BIOS rejects buffers longer than Size

        using var args = inst.GetMethodParameters("hpqBIOSInt128");
        args["InData"] = dataIn;
        using var result = inst.InvokeMethod("hpqBIOSInt128", args, null);
        var outData = (ManagementBaseObject)result["OutData"];
        var rc = Convert.ToUInt32(outData["rwReturnCode"]);
        if (rc != 0) throw new BiosException($"BIOS cmd 0x{command:X}/0x{type:X2} returned {rc}");
        var data = (byte[]?)outData["Data"] ?? [];
        return data.Length > outSize ? data[..outSize] : data;
    }

    public static bool Available
    {
        get { try { Call(Gaming, 0x28); return true; } catch { return false; } }
    }

    // ---- System design data / thermal policy ----
    /// Byte 3: thermal policy version. v0 uses legacy mode codes, v1+ uses 0x30/0x31/0x50.
    public static int ThermalPolicyVersion => Call(Gaming, 0x28)[3];

    // ---- Performance mode ----
    public enum PerfMode { Balanced, Performance, Cool, Quiet }

    /// BIOS code for a mode; OMEN Gaming Hub stores the same number as its saved "Mode".
    public static byte PerfCode(PerfMode mode)
    {
        bool v1 = ThermalPolicyVersion >= 1;
        return (mode, v1) switch
        {
            (PerfMode.Balanced, true) => 0x30,
            (PerfMode.Performance, true) => 0x31,
            (PerfMode.Cool, true) => 0x50,
            (PerfMode.Quiet, true) => 0x50, // v1 BIOS has no separate quiet code
            (PerfMode.Balanced, false) => 0x00,
            (PerfMode.Performance, false) => 0x01,
            (PerfMode.Cool, false) => 0x02,
            (PerfMode.Quiet, false) => 0x03,
            _ => 0x30
        };
    }

    public static void SetPerfMode(PerfMode mode) => Call(Gaming, 0x1A, [0xFF, PerfCode(mode), 0x00, 0x00]);

    // ---- Fans ----
    public static int FanCount => Call(Gaming, 0x10)[0];
    /// Fan speeds in RPM (BIOS reports level = RPM/100).
    public static int[] FanRpm()
    {
        var d = Call(Gaming, 0x2D);
        return [d[0] * 100, d[1] * 100];
    }
    public static bool MaxFan
    {
        get => Call(Gaming, 0x26)[0] == 1;
        set => Call(Gaming, 0x27, [(byte)(value ? 1 : 0), 0, 0, 0]);
    }
    /// Manual fan level (RPM/100) per fan; BIOS reverts to auto after ~120 s unless refreshed.
    public static void SetFanLevel(int cpuRpm, int gpuRpm) =>
        Call(Gaming, 0x2E, [(byte)Math.Clamp(cpuRpm / 100, 0, 255), (byte)Math.Clamp(gpuRpm / 100, 0, 255), 0, 0]);

    /// Manual-fan range and CPU→GPU pairing for this laptop, from the BIOS fan table (0x2F) like OMEN Gaming Hub.
    /// Table rows are [level per fan…, noise dB] in rising order (8A44: 2,15, 0,0,16, 21,0,18, 24,22,22 … 58,60,50).
    public sealed record FanCurve(int MinRpm, int MaxRpm, byte[][] Rows)
    {
        /// GPU speed for a CPU speed: keeps the CPU/GPU offset of the table row it falls in.
        public int GpuRpmFor(int cpuRpm)
        {
            var row = Rows.LastOrDefault(r => cpuRpm / 100 >= r[0]);
            return row is { Length: >= 3 } ? cpuRpm + (row[1] - row[0]) * 100 : cpuRpm;
        }
    }
    static readonly Lazy<FanCurve> _curve = new(ReadFanCurve);
    public static FanCurve Curve => _curve.Value;

    static FanCurve ReadFanCurve()
    {
        try
        {
            var raw = Call(Gaming, 0x2F);
            int width = raw[0] + 1;
            var rows = new List<byte[]>();
            for (int i = 2; raw[0] > 0 && i + width <= raw.Length; i += width)
            {
                var row = raw[i..(i + width)];
                if (row.All(b => b == 0)) break;
                rows.Add(row);
            }
            // Lowest row where every fan spins: below it the BIOS parks a fan at 0 RPM.
            var min = rows.FirstOrDefault(r => r[..^1].All(l => l > 0));
            if (min != null) return new(min[0] * 100, rows[^1][0] * 100, [.. rows]);
        }
        catch (BiosException) { }
        return new(2000, 5500, []); // table unreadable: the range verified on OMEN 16 (8A44) before tables were read
    }

    /// Holds both fans at a manual speed, clamped to this laptop's range. Returns the CPU RPM applied.
    public static int SetManualFan(int cpuRpm)
    {
        int rpm = Math.Clamp(cpuRpm, Curve.MinRpm, Curve.MaxRpm);
        SetFanLevel(rpm, Curve.GpuRpmFor(rpm));
        return rpm;
    }

    // ---- Temperature ----
    public static int CpuTemp => Call(Gaming, 0x23, [0x01, 0, 0, 0])[0];

    /// Physical keyboard type the BIOS reports (1 with number pad, 2 without; read 2 on OMEN 16 board 8A44).
    public static int KeyboardType => Call(Gaming, 0x2B)[0];

    // ---- Keyboard 4-zone lighting ----
    const int ZoneOffset = 25;
    public static bool HasFourZone
    {
        get { try { Call(Lighting, 0x01); return true; } catch { return false; } }
    }
    public static (byte R, byte G, byte B)[] GetZones()
    {
        var t = Call(Lighting, 0x02);
        return Enumerable.Range(0, 4).Select(i => (t[ZoneOffset + i * 3], t[ZoneOffset + i * 3 + 1], t[ZoneOffset + i * 3 + 2])).ToArray();
    }
    public static void SetZones((byte R, byte G, byte B)[] zones)
    {
        var t = Call(Lighting, 0x02); // read-modify-write keeps BIOS header bytes intact
        for (int i = 0; i < 4; i++)
        {
            t[ZoneOffset + i * 3] = zones[i].R;
            t[ZoneOffset + i * 3 + 1] = zones[i].G;
            t[ZoneOffset + i * 3 + 2] = zones[i].B;
        }
        Call(Lighting, 0x03, t);
    }
    public static bool Backlight
    {
        get => (Call(Lighting, 0x04)[0] & 0x80) != 0; // HP tests bit 7 (on = 0xE4, off = 0x64)
        set => Call(Lighting, 0x05, [value ? (byte)0xE4 : (byte)0x64, 0, 0, 0]);
    }

    // ---- Graphics MUX ----
    public enum GpuMode : byte { Hybrid = 0, Discrete = 1, Optimus = 2 }
    public static GpuMode GetGpuMode() => (GpuMode)Call(Legacy, 0x52)[0];
    /// Takes effect after reboot.
    public static void SetGpuMode(GpuMode mode) => Call(LegacySet, 0x52, [(byte)mode, 0, 0, 0]);

    /// Modes this laptop's BIOS offers, read the way OMEN Gaming Hub does: bits of byte 7 in the system design data
    /// (2 Hybrid, 4 Discrete, 8 Optimus). If the BIOS won't say, Hybrid and Discrete, which every graphics switch has.
    public static GpuMode[] SupportedGpuModes()
    {
        int bits;
        try { bits = Call(Gaming, 0x28)[7]; } catch (BiosException) { bits = 6; }
        return new[] { (2, GpuMode.Hybrid), (4, GpuMode.Discrete), (8, GpuMode.Optimus) }.Where(m => (bits & m.Item1) != 0).Select(m => m.Item2).ToArray();
    }
}
