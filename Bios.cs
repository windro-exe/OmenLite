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

    public static void SetPerfMode(PerfMode mode)
    {
        bool v1 = ThermalPolicyVersion >= 1;
        byte code = (mode, v1) switch
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
        Call(Gaming, 0x1A, [0xFF, code, 0x00, 0x00]);
    }

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
        get => Call(Lighting, 0x04)[0] == 0xE4;
        set => Call(Lighting, 0x05, [value ? (byte)0xE4 : (byte)0x64, 0, 0, 0]);
    }

    // ---- Graphics MUX ----
    public enum GpuMode : byte { Hybrid = 0, Discrete = 1, Optimus = 2 }
    public static GpuMode GetGpuMode() => (GpuMode)Call(Legacy, 0x52)[0];
    /// Takes effect after reboot.
    public static void SetGpuMode(GpuMode mode) => Call(LegacySet, 0x52, [(byte)mode, 0, 0, 0]);
}
