using System.Management;
using System.Text;
using System.Windows;

namespace OmenLite;

public partial class App : Application
{
    ManagementEventWatcher? _omenKey;
    Mutex? _single;
    EventWaitHandle? _showSignal;

    void OnStartup(object sender, StartupEventArgs e)
    {
        if (e.Args.Contains("--probe") || e.Args.Contains("--selftest"))
        {
            var log = Path.Combine(AppContext.BaseDirectory, e.Args.Contains("--selftest") ? "selftest.txt" : "probe.txt");
            File.WriteAllText(log, e.Args.Contains("--selftest") ? SelfTest() : Probe());
            Shutdown();
            return;
        }

        // One instance only: a second launch asks the running one to show itself, then exits.
        _single = new Mutex(true, "OmenLite.SingleInstance", out bool first);
        if (!first)
        {
            try { EventWaitHandle.OpenExisting("OmenLite.Show").Set(); } catch { }
            Shutdown();
            return;
        }

        if (!Bios.Available)
            MessageBox.Show("HP BIOS WMI interface not found. Hardware controls will be disabled.", "OmenLite");

        // Web UI is the default when its bundle is present; --classic keeps the WPF window.
        bool web = !e.Args.Contains("--classic") && File.Exists(Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html"));
        Window win = web ? new WebWindow() : new MainWindow();
        Action show = win is WebWindow w ? w.ShowFromTray : ((MainWindow)win).ShowFromTray;
        MainWindow = win;
        if (!e.Args.Contains("--tray")) win.Show();
        WatchOmenKey(show);
        _showSignal = new EventWaitHandle(false, EventResetMode.AutoReset, "OmenLite.Show");
        ThreadPool.RegisterWaitForSingleObject(_showSignal, (_, _) => Dispatcher.Invoke(show), null, -1, false);
    }

    /// OMEN key raises hpqBEvnt with EventData 0x21A5; bring our window up.
    void WatchOmenKey(Action show)
    {
        try
        {
            _omenKey = new ManagementEventWatcher(new ManagementScope(@"root\wmi"),
                new EventQuery("SELECT * FROM hpqBEvnt WHERE eventData = 8613"));
            _omenKey.EventArrived += (_, _) => Dispatcher.Invoke(show);
            _omenKey.Start();
        }
        catch { /* event class absent on non-OMEN */ }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _omenKey?.Stop();
        _omenKey?.Dispose();
        base.OnExit(e);
    }

    static string Try(string name, Func<object> f)
    {
        try { var v = f(); return $"{name}: {(v is byte[] b ? Convert.ToHexString(b) : v is Array a ? string.Join(",", a.Cast<object>()) : v)}"; }
        catch (Exception ex) { return $"{name}: ERROR {ex.Message}"; }
    }

    static string Probe()
    {
        var sb = new StringBuilder();
        sb.AppendLine(Try("Available", () => Bios.Available));
        sb.AppendLine(Try("DesignData", () => Bios.Call(0x20008, 0x28)));
        sb.AppendLine(Try("ThermalPolicyVersion", () => Bios.ThermalPolicyVersion));
        sb.AppendLine(Try("FanCount", () => Bios.FanCount));
        sb.AppendLine(Try("FanRpm", () => Bios.FanRpm()));
        sb.AppendLine(Try("MaxFan", () => Bios.MaxFan));
        sb.AppendLine(Try("FanCurve", () => $"{Bios.Curve.MinRpm}-{Bios.Curve.MaxRpm} rpm, gpu at min {Bios.Curve.GpuRpmFor(Bios.Curve.MinRpm)}, at max {Bios.Curve.GpuRpmFor(Bios.Curve.MaxRpm)}"));
        sb.AppendLine(Try("CpuTemp", () => Bios.CpuTemp));
        sb.AppendLine(Try("HasFourZone", () => Bios.HasFourZone));
        sb.AppendLine(Try("Zones", () => Bios.GetZones().Select(z => $"#{z.R:X2}{z.G:X2}{z.B:X2}").ToArray()));
        sb.AppendLine(Try("Backlight", () => Bios.Backlight));
        sb.AppendLine(Try("GpuMode", () => Bios.GetGpuMode()));
        sb.AppendLine(Try("Monitor", () => Monitor.Read()));
        return sb.ToString();
    }

    /// Reversible writes only; every value restored. MUX is never written here.
    static string SelfTest()
    {
        var sb = new StringBuilder();
        void Step(string name, Action a) { try { a(); sb.AppendLine($"{name}: OK"); } catch (Exception ex) { sb.AppendLine($"{name}: FAIL {ex.Message}"); } }

        var maxFan = Bios.MaxFan;
        Step("MaxFan on", () => { Bios.MaxFan = true; Thread.Sleep(3000); sb.AppendLine($"  readback={Bios.MaxFan} rpm={string.Join(",", Bios.FanRpm())}"); });
        Step("MaxFan restore", () => { Bios.MaxFan = maxFan; sb.AppendLine($"  readback={Bios.MaxFan}"); });

        var zones = Bios.GetZones();
        Step("Zones set red/green/blue/white", () =>
        {
            Bios.SetZones([(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 255)]);
            sb.AppendLine("  readback=" + string.Join(",", Bios.GetZones().Select(z => $"#{z.R:X2}{z.G:X2}{z.B:X2}")));
            Thread.Sleep(2000);
        });
        Step("Zones restore", () => { Bios.SetZones(zones); sb.AppendLine("  readback=" + string.Join(",", Bios.GetZones().Select(z => $"#{z.R:X2}{z.G:X2}{z.B:X2}"))); });

        Step("PerfMode Performance", () => { Bios.SetPerfMode(Bios.PerfMode.Performance); Thread.Sleep(2000); });
        Step("PerfMode Balanced (restore)", () => Bios.SetPerfMode(Bios.PerfMode.Balanced));
        return sb.ToString();
    }
}
