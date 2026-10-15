using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Shell;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Win32;
using WinForms = System.Windows.Forms;

namespace OmenLite;

/// Borderless window hosting the web UI (ui/ → wwwroot/) and bridging its commands to Bios/Booster/Monitor.
public sealed class WebWindow : Window
{
    const string Origin = "https://app.omenlite/";
    const string TaskName = "OmenLite";
    const string RegPath = @"Software\OmenLite";
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    readonly WebView2 _web = new() { DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 14, 15, 18) };
    readonly DispatcherTimer _telemetry = new() { Interval = TimeSpan.FromSeconds(1) };
    readonly DispatcherTimer _fanRefresh = new() { Interval = TimeSpan.FromSeconds(90) };
    readonly WinForms.NotifyIcon _tray;
    readonly (string Model, string Bios) _info = ReadSystemInfo();
    Bios.PerfMode _perf;
    int? _manualRpm;
    bool _exiting, _polling;

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    public WebWindow()
    {
        Title = "OmenLite";
        Width = 1240; Height = 820; MinWidth = 1000; MinHeight = 680;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(14, 15, 18));
        WindowStyle = WindowStyle.None;
        // Keep native resize borders and snap; the web page draws its own title bar.
        WindowChrome.SetWindowChrome(this, new WindowChrome { CaptionHeight = 0, ResizeBorderThickness = new Thickness(6), GlassFrameThickness = new Thickness(0), UseAeroCaptionButtons = false });
        Content = _web;

        var saved = Registry.CurrentUser.OpenSubKey(RegPath)?.GetValue("PerfMode") as string;
        _perf = Enum.TryParse<Bios.PerfMode>(saved, out var p) ? p : Bios.PerfMode.Balanced;

        _tray = BuildTray();
        _ = Task.Run(() => Try(SyncHubLighting)); // zones are readable from the BIOS; thermal mode is not, so it syncs on the first change
        _telemetry.Tick += async (_, _) => await PushTelemetry();
        _fanRefresh.Tick += (_, _) => { if (_manualRpm is { } r) Try(() => Bios.SetManualFan(r)); }; // BIOS drops manual level after ~2 min
        SourceInitialized += (_, _) =>
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            int dark = 1, round = 2; // dark frame + Win11 rounded corners
            DwmSetWindowAttribute(hwnd, 20, ref dark, sizeof(int));
            DwmSetWindowAttribute(hwnd, 33, ref round, sizeof(int));
        };
        Loaded += async (_, _) => await InitWebView();
        IsVisibleChanged += async (_, _) => await OnVisibilityChanged();
    }

    /// In the tray: stop telemetry, drop WebView2 to low memory and suspend its renderer.
    async Task OnVisibilityChanged()
    {
        var core = _web.CoreWebView2;
        if (IsVisible)
        {
            if (core != null) { core.Resume(); core.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Normal; }
            _telemetry.Start();
            return;
        }
        _telemetry.Stop();
        if (core == null) return;
        core.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Low;
        try { await core.TrySuspendAsync(); } catch (InvalidOperationException) { /* still visible to WebView2 for a frame */ }
    }

    async Task InitWebView()
    {
        var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OmenLite", "WebView2");
#if DEBUG
        // Debug builds only: CDP on localhost so UI tests can drive the real app. Never in Release (elevated process).
        var env = await CoreWebView2Environment.CreateAsync(null, data, new CoreWebView2EnvironmentOptions("--remote-debugging-port=9333"));
#else
        var env = await CoreWebView2Environment.CreateAsync(null, data);
#endif
        await _web.EnsureCoreWebView2Async(env);
        var core = _web.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
#if !DEBUG
        core.Settings.AreDevToolsEnabled = false;
#endif
        core.SetVirtualHostNameToFolderMapping("app.omenlite", Path.Combine(AppContext.BaseDirectory, "wwwroot"), CoreWebView2HostResourceAccessKind.Deny);
        // The page is the only trusted caller of BIOS commands: refuse to leave our origin or open windows.
        core.NavigationStarting += (_, e) => { if (!e.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) e.Cancel = true; };
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.WebMessageReceived += OnMessage;
        core.Navigate(Origin + "index.html");
        _telemetry.Start();
    }

    // ---------------- bridge ----------------

    async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!e.Source.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) return;
        int id; string cmd; JsonElement arg;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            id = doc.RootElement.GetProperty("id").GetInt32();
            cmd = doc.RootElement.GetProperty("cmd").GetString() ?? "";
            arg = doc.RootElement.GetProperty("arg").Clone();
        }
        catch { return; } // malformed message from our own page: nothing to reply to
        try
        {
            var data = cmd.StartsWith("win.") ? WindowCommand(cmd) : await Task.Run(() => { var r = Dispatch(cmd, arg); MirrorToHub(cmd); return r; });
            Post(new { id, ok = true, data });
        }
        catch (Exception ex)
        {
            Post(new { id, ok = false, error = ex.Message });
        }
    }

    void Post(object message)
    {
        if (_web.CoreWebView2 != null) _web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message, Json));
    }

    object? WindowCommand(string cmd)
    {
        switch (cmd)
        {
            case "win.drag":
                ReleaseCapture();
                SendMessage(new WindowInteropHelper(this).Handle, 0xA1 /* WM_NCLBUTTONDOWN */, 2 /* HTCAPTION */, IntPtr.Zero);
                break;
            case "win.minimize": WindowState = WindowState.Minimized; break;
            case "win.close": Hide(); break;
            default: throw new InvalidOperationException($"Unknown command {cmd}");
        }
        return null;
    }

    object? Dispatch(string cmd, JsonElement arg)
    {
        switch (cmd)
        {
            case "getState": return GetState();
            case "setPerf":
            {
                var m = Enum.Parse<Bios.PerfMode>(arg.GetString()!);
                Bios.SetPerfMode(m);
                _perf = m;
                Registry.CurrentUser.CreateSubKey(RegPath).SetValue("PerfMode", m.ToString());
                if (_manualRpm is { } r) Bios.SetManualFan(r); // applying a thermal mode resets fans to auto
                return null;
            }
            case "setMaxFan":
            {
                bool on = arg.GetBoolean();
                if (on) StopManual();
                Bios.MaxFan = on;
                return null;
            }
            case "setManualFan":
                if (arg.ValueKind == JsonValueKind.Null)
                {
                    StopManual();
                    Bios.SetPerfMode(_perf); // level 0 means 0 RPM; re-applying the mode hands fans back to BIOS (verified on F.27)
                }
                else
                {
                    if (Bios.MaxFan) Bios.MaxFan = false;
                    _manualRpm = Bios.SetManualFan(arg.GetInt32());
                    Dispatcher.Invoke(_fanRefresh.Start);
                }
                return null;
            case "setZones":
            {
                var hex = arg.EnumerateArray().Select(x => x.GetString()!).ToArray();
                if (hex.Length != 4) throw new ArgumentException("Expected 4 zone colours");
                Bios.SetZones(hex.Select(h =>
                {
                    var c = System.Drawing.ColorTranslator.FromHtml(h);
                    return (c.R, c.G, c.B);
                }).ToArray());
                return null;
            }
            case "setBacklight": Bios.Backlight = arg.GetBoolean(); return null;
            case "setGpuMode": Bios.SetGpuMode(Enum.Parse<Bios.GpuMode>(arg.GetString()!)); return null;
            case "setBoost":
                if (arg.GetBoolean())
                {
                    var r = Booster.StartGameBoost(_perf);
                    return new { on = true, target = r.Target ?? "", trimmed = r.Trimmed };
                }
                Booster.StopGameBoost(); // restores the thermal mode saved at boost start
                return new { on = false, target = "", trimmed = 0 };
            case "cleanCache":
            {
                var r = Booster.CleanCache();
                return new { freedMb = Math.Round(r.FreedMb, 1), files = r.Files, trimmed = r.Trimmed };
            }
            case "setAutostart":
            {
                int rc = arg.GetBoolean()
                    ? Schtasks($"/Create /F /RL HIGHEST /SC ONLOGON /TN {TaskName} /TR \"\\\"{Environment.ProcessPath}\\\" --tray\"")
                    : Schtasks($"/Delete /F /TN {TaskName}");
                if (rc != 0) throw new InvalidOperationException($"schtasks failed ({rc})");
                return null;
            }
            default: throw new InvalidOperationException($"Unknown command {cmd}");
        }
    }

    /// Mirrors what a command just changed into OMEN Gaming Hub's saved settings, so its screens agree with the hardware.
    void MirrorToHub(string cmd)
    {
        if (cmd is "setPerf" or "setMaxFan" or "setManualFan" or "setBoost") Try(SyncHubPerf);
        else if (cmd is "setZones" or "setBacklight") Try(SyncHubLighting);
    }

    void SyncHubPerf()
    {
        bool max = Bios.MaxFan;
        var mode = Booster.GameBoostActive ? Bios.PerfMode.Performance : _perf;
        // Hub saves Balanced/Performance as 48/49 and thermal control as Max 0, Auto 1. It has no way to store a fixed
        // fan rpm (its Manual is a slider that also changes the thermal level), so our manual fan shows there as Auto.
        HubSync.Set("PerformanceControl", ("Mode", Bios.PerfCode(mode)), ("MaxFan", max ? 1 : 0), ("ThermalControl", max ? 0 : 1));
    }

    void SyncHubLighting()
    {
        // Hub stores zone i as 0xRRGGBB; its DefaultMode 0 re-applies the colours with the backlight on, 1 leaves it off.
        var values = Bios.GetZones().Select((c, i) => ($"Z{i}", c.R << 16 | c.G << 8 | c.B))
            .Append(("Mode", 0)).Append(("DefaultMode", Bios.Backlight ? 0 : 1)).ToArray();
        HubSync.Set("FourZoneLighting", values);
    }

    void StopManual()
    {
        _manualRpm = null;
        Dispatcher.Invoke(_fanRefresh.Stop);
    }

    object GetState()
    {
        T? Read<T>(Func<T> f) { try { return f(); } catch { return default; } }
        var zones = Read(Bios.GetZones) ?? [(0, 0, 0), (0, 0, 0), (0, 0, 0), (0, 0, 0)];
        return new
        {
            available = Bios.Available,
            model = _info.Model,
            bios = _info.Bios,
            perf = Booster.GameBoostActive ? Bios.PerfMode.Performance : _perf,
            maxFan = Read(() => Bios.MaxFan),
            manualRpm = _manualRpm,
            fanMin = Bios.Curve.MinRpm,
            fanMax = Bios.Curve.MaxRpm,
            fourZone = Bios.HasFourZone, // laptops without RGB zones hide the Keyboard page
            zones = zones.Select(z => $"#{z.R:X2}{z.G:X2}{z.B:X2}").ToArray(),
            backlight = Read(() => Bios.Backlight),
            gpuMode = Read<Bios.GpuMode?>(() => Bios.GetGpuMode()), // null on laptops without a graphics switch
            gpuModes = Bios.SupportedGpuModes(),
            keyboardType = Read<int?>(() => Bios.KeyboardType), // null when the BIOS call fails
            boost = Booster.GameBoostActive,
            autostart = Schtasks($"/Query /TN {TaskName}") == 0,
        };
    }

    async Task PushTelemetry()
    {
        if (_polling || WindowState == WindowState.Minimized || _web.CoreWebView2 == null) return;
        _polling = true; // nvidia-smi can take >1 s when the GPU wakes; never overlap reads
        try
        {
            var s = await Task.Run(Monitor.Read);
            Post(new { @event = "telemetry", data = new { cpuTemp = s.CpuTemp, gpuTemp = s.GpuTemp, cpuFan = s.CpuFan, gpuFan = s.GpuFan, cpuLoad = s.CpuLoad, gpuPower = s.GpuPowerW } });
        }
        finally { _polling = false; }
    }

    // ---------------- window / tray ----------------

    WinForms.NotifyIcon BuildTray()
    {
        var menu = new WinForms.ContextMenuStrip();
        menu.Items.Add("Open", null, (_, _) => ShowFromTray());
        menu.Items.Add("Exit", null, (_, _) => { _exiting = true; Close(); });
        var icon = System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath!) ?? System.Drawing.SystemIcons.Application;
        var t = new WinForms.NotifyIcon { Icon = icon, Text = "OmenLite", ContextMenuStrip = menu, Visible = true };
        t.DoubleClick += (_, _) => ShowFromTray();
        return t;
    }

    public void ShowFromTray()
    {
        Show();
        WindowState = WindowState.Normal;
        Activate();
    }

    protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
    {
        if (!_exiting) { e.Cancel = true; Hide(); return; }
        _telemetry.Stop();
        if (Booster.GameBoostActive) Try(() => Booster.StopGameBoost());
        if (_manualRpm != null) { StopManual(); Try(() => Bios.SetPerfMode(_perf)); } // hand fans back to BIOS
        MirrorToHub("setPerf"); // boost and manual fan are now off
        _tray.Dispose();
        _web.Dispose();
        Application.Current.Shutdown();
    }

    static void Try(Action a) { try { a(); } catch { } }

    static int Schtasks(string args)
    {
        using var p = Process.Start(new ProcessStartInfo("schtasks", args) { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true })!;
        p.WaitForExit();
        return p.ExitCode;
    }

    static (string, string) ReadSystemInfo()
    {
        string Query(string cls, string prop)
        {
            try
            {
                using var s = new ManagementObjectSearcher($"SELECT {prop} FROM {cls}");
                return s.Get().Cast<ManagementObject>().Select(o => o[prop]?.ToString()).FirstOrDefault() ?? "—";
            }
            catch { return "—"; }
        }
        return (Query("Win32_ComputerSystem", "Model"), Query("Win32_BIOS", "SMBIOSBIOSVersion"));
    }
}
