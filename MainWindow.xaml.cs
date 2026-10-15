using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Microsoft.Win32;
using Media = System.Windows.Media;
using WinForms = System.Windows.Forms;

namespace OmenLite;

public partial class MainWindow : Window
{
    const string TaskName = "OmenLite";
    const string RegPath = @"Software\OmenLite";
    static readonly string[] ZoneNames = ["Right", "Middle", "Left", "WASD"]; // by BIOS index
    static readonly Dictionary<Bios.PerfMode, string> PerfInfo = new()
    {
        [Bios.PerfMode.Quiet] = "Lowest fan noise. Good for browsing and video.",
        [Bios.PerfMode.Cool] = "Keeps the chassis cool. Slightly lower clocks.",
        [Bios.PerfMode.Balanced] = "Everyday default. BIOS balances heat and speed.",
        [Bios.PerfMode.Performance] = "Highest power limits for gaming. Fans run louder.",
    };

    readonly WinForms.NotifyIcon _tray;
    readonly DispatcherTimer _fanRefresh = new() { Interval = TimeSpan.FromSeconds(90) };
    readonly DispatcherTimer _fanDebounce = new() { Interval = TimeSpan.FromMilliseconds(300) };
    readonly CancellationTokenSource _cts = new();
    readonly bool _motion = SystemParameters.ClientAreaAnimation; // false when Windows animations are off
    AnimationClock? _cpuSpin, _gpuSpin;
    Bios.PerfMode _perf;
    bool _exiting;

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    public MainWindow()
    {
        InitializeComponent();
        _tray = BuildTray();
        (FanSlider.Minimum, FanSlider.Maximum) = (Bios.Curve.MinRpm, Bios.Curve.MaxRpm); // per-laptop, from the BIOS fan table
        GpuCombo.ItemsSource = Enum.GetValues<Bios.GpuMode>();
        // BIOS drops manual fan level after ~2 min; re-send while manual mode is on.
        _fanRefresh.Tick += (_, _) => ApplyFanLevel();
        // Slider fires per tick while dragging; only send the final value.
        _fanDebounce.Tick += (_, _) => { _fanDebounce.Stop(); ApplyFanLevel(); };
        SourceInitialized += (_, _) =>
        {
            int dark = 1; // dark title bar to match the canvas
            DwmSetWindowAttribute(new WindowInteropHelper(this).Handle, 20, ref dark, sizeof(int));
        };
        Loaded += (_, _) => { Reveal(); StartFanSpin(); };
        LoadState();
        _ = PollLoop(_cts.Token);
    }

    // ---------- motion helpers ----------

    static IEasingFunction Ease(string key) => (IEasingFunction)Application.Current.FindResource(key);

    /// One orchestrated entrance: cards fade up, 60 ms stagger.
    void Reveal()
    {
        Border[] cards = [C0, C1, C2, C3, C4, C5];
        for (int i = 0; i < cards.Length; i++)
        {
            var begin = TimeSpan.FromMilliseconds(i * 60);
            var t = new Media.TranslateTransform(0, _motion ? 10 : 0);
            cards[i].RenderTransform = t;
            cards[i].Opacity = 0;
            cards[i].BeginAnimation(OpacityProperty, new DoubleAnimation(1, TimeSpan.FromMilliseconds(_motion ? 420 : 150)) { BeginTime = begin });
            if (_motion) t.BeginAnimation(Media.TranslateTransform.YProperty, new DoubleAnimation(0, TimeSpan.FromMilliseconds(420)) { BeginTime = begin, EasingFunction = Ease("EaseOut") });
        }
    }

    /// Fan icons rotate at a rate proportional to real RPM (functional indicator, not decoration).
    void StartFanSpin()
    {
        if (!_motion) return;
        AnimationClock Spin(Media.RotateTransform r)
        {
            var c = new DoubleAnimation(0, 360, TimeSpan.FromSeconds(1)) { RepeatBehavior = RepeatBehavior.Forever }.CreateClock();
            r.ApplyAnimationClock(Media.RotateTransform.AngleProperty, c);
            c.Controller!.Pause();
            return c;
        }
        _cpuSpin = Spin(CpuFanRot);
        _gpuSpin = Spin(GpuFanRot);
    }

    static void SetSpin(AnimationClock? c, int rpm)
    {
        if (c?.Controller is not { } ctl) return;
        if (rpm <= 0) { ctl.Pause(); return; }
        ctl.SpeedRatio = Math.Clamp(rpm / 3000.0, 0.2, 2.5);
        ctl.Resume();
    }

    void SetStatus(string text)
    {
        Status.Text = text;
        StatusBar.BeginAnimation(OpacityProperty, new DoubleAnimation(0.3, 1, TimeSpan.FromMilliseconds(220)) { EasingFunction = Ease("EaseOut") });
    }

    // ---------- tray ----------

    WinForms.NotifyIcon BuildTray()
    {
        var menu = new WinForms.ContextMenuStrip();
        menu.Items.Add("Open", null, (_, _) => ShowFromTray());
        foreach (var m in new[] { Bios.PerfMode.Cool, Bios.PerfMode.Balanced, Bios.PerfMode.Performance })
            menu.Items.Add($"Mode: {m}", null, (_, _) => SetPerf(m));
        menu.Items.Add("Game boost", null, (_, _) => Boost_Click(this, new RoutedEventArgs()));
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
        _cts.Cancel();
        if (Booster.GameBoostActive) Booster.StopGameBoost();
        if (ManualFanBox.IsChecked == true) RestoreAutoFan();
        _tray.Dispose();
        Application.Current.Shutdown();
    }

    // ---------- state ----------

    void LoadState()
    {
        Run(() => MaxFanBox.IsChecked = Bios.MaxFan, null);
        ManualFanBox.IsEnabled = MaxFanBox.IsChecked != true;
        Run(() => BacklightBox.IsChecked = Bios.Backlight, null);
        ZonePanel.Opacity = BacklightBox.IsChecked == true ? 1 : 0.35;
        Run(RefreshZones, null);
        Run(() => { var g = Bios.GetGpuMode(); GpuCombo.SelectedItem = g; GpuModeText.Text = $"Current: {g}"; }, null);
        AutostartBox.IsChecked = Schtasks($"/Query /TN {TaskName}") == 0;
        // BIOS has no "get thermal mode" call; show the last mode this app set.
        var saved = Registry.CurrentUser.OpenSubKey(RegPath)?.GetValue("PerfMode") as string;
        _perf = Enum.TryParse<Bios.PerfMode>(saved, out var p) ? p : Bios.PerfMode.Balanced;
        ShowPerf(animate: false);
    }

    void ShowPerf(bool animate)
    {
        PerfText.Text = PerfInfo[_perf];
        ModePill.Text = _perf.ToString();
        int idx = Array.IndexOf([Bios.PerfMode.Quiet, Bios.PerfMode.Cool, Bios.PerfMode.Balanced, Bios.PerfMode.Performance], _perf);
        foreach (Button b in PerfSeg.Children.OfType<Button>())
            b.Foreground = (string)b.Tag == _perf.ToString() ? Media.Brushes.White : (Media.Brush)FindResource("Muted");
        double x = idx * PerfSeg.ActualWidth / 4;
        if (animate && _motion)
            PerfShift.BeginAnimation(Media.TranslateTransform.XProperty, new DoubleAnimation(x, TimeSpan.FromMilliseconds(300)) { EasingFunction = Ease("EaseOut") });
        else { PerfShift.BeginAnimation(Media.TranslateTransform.XProperty, null); PerfShift.X = x; }
    }

    void PerfSeg_SizeChanged(object s, SizeChangedEventArgs e) => ShowPerf(animate: false);

    async Task PollLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            if (IsVisible)
            {
                var s = await Task.Run(() => Monitor.Read(), ct);
                CpuGauge.AnimateTo(s.CpuTemp > 0 ? s.CpuTemp : null);
                GpuGauge.AnimateTo(s.GpuTemp);
                CpuSub.Text = $"{s.CpuLoad:F0}% load";
                GpuSub.Text = s.GpuPowerW is { } w ? $"{w} W" : "idle / not reported";
                CpuFanText.Text = s.CpuFan.ToString("N0");
                GpuFanText.Text = s.GpuFan.ToString("N0");
                SetSpin(_cpuSpin, s.CpuFan);
                SetSpin(_gpuSpin, s.GpuFan);
                _tray.Text = $"OmenLite  CPU {s.CpuTemp}°C  {_perf}";
            }
            try { await Task.Delay(2000, ct); } catch (TaskCanceledException) { }
        }
    }

    bool Run(Action a, string? ok)
    {
        try { a(); if (ok != null) SetStatus(ok); return true; }
        catch (Exception ex) { SetStatus("Error: " + ex.Message); return false; }
    }

    // ---------- performance ----------

    void SetPerf(Bios.PerfMode m)
    {
        if (!Run(() => Bios.SetPerfMode(m), $"Performance mode set to {m}")) return;
        _perf = m;
        Registry.CurrentUser.CreateSubKey(RegPath).SetValue("PerfMode", m.ToString());
        ShowPerf(animate: true);
    }
    void Perf_Click(object s, RoutedEventArgs e) => SetPerf(Enum.Parse<Bios.PerfMode>((string)((Button)s).Tag));

    // ---------- fans ----------

    void MaxFan_Click(object s, RoutedEventArgs e)
    {
        bool on = MaxFanBox.IsChecked == true;
        if (on) ManualFanBox.IsChecked = false; // Unchecked handler restores auto first
        if (!Run(() => Bios.MaxFan = on, $"Max fan {(on ? "on" : "off")}")) MaxFanBox.IsChecked = !on;
        ManualFanBox.IsEnabled = MaxFanBox.IsChecked != true;
    }

    // Checked/Unchecked (not Click) so keyboard, mouse and UI Automation toggles all take the same path.
    void ManualFan_Checked(object s, RoutedEventArgs e)
    {
        FanSlider.IsEnabled = true;
        if (ApplyFanLevel()) { SetStatus("Manual fan on"); _fanRefresh.Start(); }
        else ManualFanBox.IsChecked = false;
    }

    void ManualFan_Unchecked(object s, RoutedEventArgs e) => StopManualFan();

    void StopManualFan()
    {
        _fanRefresh.Stop();
        _fanDebounce.Stop();
        FanSlider.IsEnabled = false;
        RestoreAutoFan();
    }

    /// Level 0 means 0 RPM, not auto. Re-applying the thermal mode hands fans back to BIOS control (verified on F.27).
    void RestoreAutoFan() => Run(() => Bios.SetPerfMode(_perf), "Fans back to automatic");

    bool ApplyFanLevel() => Run(() => Bios.SetManualFan((int)FanSlider.Value), null);

    void FanSlider_Changed(object s, RoutedPropertyChangedEventArgs<double> e)
    {
        if (FanSliderText == null) return;
        FanSliderText.Text = $"{(int)e.NewValue:N0} RPM";
        if (ManualFanBox.IsChecked == true) { _fanDebounce.Stop(); _fanDebounce.Start(); }
    }

    // ---------- lighting ----------

    Button[] Zones => [Z0, Z1, Z2, Z3];

    void RefreshZones()
    {
        var z = Bios.GetZones();
        for (int i = 0; i < 4; i++)
        {
            var target = Media.Color.FromRgb(z[i].R, z[i].G, z[i].B);
            // Fresh (unfrozen) brush each time so the colour can crossfade.
            var from = (Zones[i].Background as Media.SolidColorBrush)?.Color ?? target;
            var brush = new Media.SolidColorBrush(from);
            Zones[i].Background = brush;
            Zones[i].BorderBrush = (Media.Brush)FindResource("Rule");
            Zones[i].ToolTip = $"{ZoneNames[i]}: #{z[i].R:X2}{z[i].G:X2}{z[i].B:X2}";
            if (_motion) brush.BeginAnimation(Media.SolidColorBrush.ColorProperty, new ColorAnimation(target, TimeSpan.FromMilliseconds(260)));
            else brush.Color = target;
        }
    }

    System.Drawing.Color? PickColor(Media.Brush current)
    {
        var c = ((Media.SolidColorBrush)current).Color;
        using var d = new WinForms.ColorDialog { FullOpen = true, Color = System.Drawing.Color.FromArgb(c.R, c.G, c.B) };
        // Owner keeps the dialog in front of the window and modal to it.
        var owner = new WinForms.NativeWindow();
        owner.AssignHandle(new WindowInteropHelper(this).Handle);
        try { return d.ShowDialog(owner) == WinForms.DialogResult.OK ? d.Color : null; }
        finally { owner.ReleaseHandle(); }
    }

    void Zone_Click(object s, RoutedEventArgs e)
    {
        int idx = int.Parse((string)((Button)s).Tag);
        if (PickColor(Zones[idx].Background) is not { } c) return;
        Run(() =>
        {
            var z = Bios.GetZones();
            z[idx] = (c.R, c.G, c.B);
            Bios.SetZones(z);
            RefreshZones();
        }, $"{ZoneNames[idx]} zone set");
    }

    void SetAllZones(byte r, byte g, byte b, string msg) =>
        Run(() => { Bios.SetZones([(r, g, b), (r, g, b), (r, g, b), (r, g, b)]); RefreshZones(); }, msg);

    void AllSame_Click(object s, RoutedEventArgs e)
    {
        if (PickColor(Z2.Background) is not { } c) return;
        SetAllZones(c.R, c.G, c.B, "All zones set");
    }

    void Preset_Click(object s, RoutedEventArgs e)
    {
        var c = (Media.Color)Media.ColorConverter.ConvertFromString((string)((Button)s).Tag);
        SetAllZones(c.R, c.G, c.B, $"All zones set to {(string)((Button)s).ToolTip}".Replace(", all zones", ""));
    }

    void Backlight_Click(object s, RoutedEventArgs e)
    {
        bool on = BacklightBox.IsChecked == true;
        if (!Run(() => Bios.Backlight = on, $"Backlight {(on ? "on" : "off")}")) BacklightBox.IsChecked = !on;
        ZonePanel.BeginAnimation(OpacityProperty, new DoubleAnimation(BacklightBox.IsChecked == true ? 1 : 0.35, TimeSpan.FromMilliseconds(220)));
    }

    // ---------- graphics ----------

    void GpuApply_Click(object s, RoutedEventArgs e)
    {
        if (GpuCombo.SelectedItem is not Bios.GpuMode m) return;
        var r = MessageBox.Show(this, $"Switch graphics to {m}? This takes effect after reboot. " +
            "If the screen stays black after reboot, connect an external monitor or reset BIOS defaults (F10).",
            "Graphics mode", MessageBoxButton.YesNo, MessageBoxImage.Warning);
        if (r != MessageBoxResult.Yes) return;
        Run(() => Bios.SetGpuMode(m), $"Graphics mode {m} saved. Reboot to apply.");
    }

    // ---------- booster ----------

    async void Clean_Click(object s, RoutedEventArgs e)
    {
        var btn = (Button)s;
        btn.IsEnabled = false;
        btn.Content = "Cleaning…";
        SetStatus("Cleaning temp files, DNS cache and memory…");
        try
        {
            var r = await Task.Run(Booster.CleanCache);
            SetStatus($"Freed {r.FreedMb:F1} MB in {r.Files} temp files, flushed DNS, trimmed {r.Trimmed} processes");
        }
        catch (Exception ex) { SetStatus("Error: " + ex.Message); }
        finally { btn.IsEnabled = true; btn.Content = "Clean cache"; }
    }

    void Boost_Click(object s, RoutedEventArgs e)
    {
        Run(() =>
        {
            if (Booster.GameBoostActive) { SetStatus(Booster.StopGameBoost()); return; }
            var r = Booster.StartGameBoost(_perf);
            SetStatus($"Game boost on: Performance mode, best-performance power, High priority for {r.Target ?? "none"}, trimmed {r.Trimmed}");
        }, null);
        bool on = Booster.GameBoostActive;
        BoostBtn.Content = on ? "Stop game boost" : "Start game boost";
        BoostBtn.Style = on ? (Style)FindResource("Primary") : (Style)FindResource(typeof(Button));
        BoostPill.Visibility = on ? Visibility.Visible : Visibility.Collapsed;
        if (on) { _perf = Bios.PerfMode.Performance; ShowPerf(animate: true); }
        else
        {
            var saved = Registry.CurrentUser.OpenSubKey(RegPath)?.GetValue("PerfMode") as string;
            if (Enum.TryParse<Bios.PerfMode>(saved, out var p)) { _perf = p; ShowPerf(animate: true); }
        }
    }

    void Autostart_Click(object s, RoutedEventArgs e)
    {
        // Scheduled task with highest privileges: starts elevated at logon without a UAC prompt.
        int rc = AutostartBox.IsChecked == true
            ? Schtasks($"/Create /F /RL HIGHEST /SC ONLOGON /TN {TaskName} /TR \"\\\"{Environment.ProcessPath}\\\" --tray\"")
            : Schtasks($"/Delete /F /TN {TaskName}");
        if (rc != 0) AutostartBox.IsChecked = !AutostartBox.IsChecked;
        SetStatus(rc == 0 ? "Autostart updated" : $"schtasks failed ({rc})");
    }

    static int Schtasks(string args)
    {
        using var p = Process.Start(new ProcessStartInfo("schtasks", args) { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true })!;
        p.WaitForExit();
        return p.ExitCode;
    }
}
