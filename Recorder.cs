using System.Diagnostics;
using System.Text.Json;

namespace OmenLite;

/// Read-only bookkeeping fed one Snapshot per tick: a 6 h temperature/fan history, game sessions (the time Game Boost
/// is on) and the heat alert. History lives in memory; the last sessions are kept on disk.
public sealed class Recorder
{
    const int StepS = 10, Capacity = 6 * 3600 / StepS, HotC = 85, KeepSessions = 20;
    const double AlertAfterS = 20; // temperature must stay over the limit this long: spikes aren't throttling
    static readonly string SessionFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OmenLite", "sessions.json");

    sealed class Session
    {
        public string Game { get; set; } = "";
        public long StartMs { get; set; }
        public double Seconds { get; set; }
        public double CpuSum { get; set; }
        public int PeakCpu { get; set; }
        public double GpuSum { get; set; }
        public double GpuSeconds { get; set; }
        public int? PeakGpu { get; set; }
        public double SecondsHot { get; set; }
    }

    readonly object _lock = new();
    readonly List<(short Cpu, short Gpu, int Fan)> _history = [];
    readonly List<Session> _sessions = Load();
    readonly Action<string> _notify;
    readonly Stopwatch _clock = Stopwatch.StartNew();
    double _lastTick, _lastSample = double.NegativeInfinity, _hotFor;
    long _lastSampleMs;
    bool _alerted;
    Session? _active;

    /// Heat alert limit in C; 0 = off.
    public int AlertTemp { get; set; }

    public Recorder(Action<string> notify) => _notify = notify;

    public void Add(Snapshot s)
    {
        string? alert = null;
        lock (_lock)
        {
            double now = _clock.Elapsed.TotalSeconds, dt = Math.Clamp(now - _lastTick, 0, 30);
            _lastTick = now;

            if (now - _lastSample >= StepS - 0.5 && s.CpuTemp > 0)
            {
                _lastSample = now;
                _lastSampleMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                _history.Add(((short)s.CpuTemp, (short)(s.GpuTemp ?? -1), s.CpuFan));
                if (_history.Count > Capacity) _history.RemoveAt(0);
            }

            if (_active != null)
            {
                _active.Seconds += dt;
                _active.CpuSum += s.CpuTemp * dt;
                _active.PeakCpu = Math.Max(_active.PeakCpu, s.CpuTemp);
                if (s.GpuTemp is { } g)
                {
                    _active.GpuSum += g * dt;
                    _active.GpuSeconds += dt;
                    _active.PeakGpu = Math.Max(_active.PeakGpu ?? 0, g);
                }
                if (Math.Max(s.CpuTemp, s.GpuTemp ?? 0) >= HotC) _active.SecondsHot += dt;
            }

            int hottest = Math.Max(s.CpuTemp, s.GpuTemp ?? 0);
            if (AlertTemp > 0 && hottest >= AlertTemp)
            {
                _hotFor += dt;
                if (_hotFor >= AlertAfterS && !_alerted)
                {
                    _alerted = true;
                    alert = $"{(s.CpuTemp >= (s.GpuTemp ?? 0) ? "CPU" : "GPU")} has been at {hottest}°C for {(int)_hotFor} s (alert at {AlertTemp}°C). The laptop is probably throttling: check the vents, or lower the load.";
                }
            }
            else
            {
                _hotFor = 0;
                if (hottest < AlertTemp - 5 || AlertTemp == 0) _alerted = false; // re-arm once it has cooled a little
            }
        }
        if (alert != null) _notify(alert);
    }

    public void StartSession(string game)
    {
        lock (_lock)
        {
            EndLocked();
            _active = new Session { Game = game, StartMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
            _lastTick = _clock.Elapsed.TotalSeconds;
        }
    }

    public void EndSession() { lock (_lock) EndLocked(); }

    void EndLocked()
    {
        if (_active is not { } a) return;
        _active = null;
        if (a.Seconds < 10) return; // an accidental toggle isn't a session
        _sessions.Insert(0, a);
        if (_sessions.Count > KeepSessions) _sessions.RemoveRange(KeepSessions, _sessions.Count - KeepSessions);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(SessionFile)!);
            File.WriteAllText(SessionFile, JsonSerializer.Serialize(_sessions));
        }
        catch { /* history is a convenience: a read-only profile folder must not break boost */ }
    }

    public object History()
    {
        lock (_lock)
            return new
            {
                stepS = StepS,
                endMs = _lastSampleMs,
                cpu = _history.Select(h => (int)h.Cpu).ToArray(),
                gpu = _history.Select(h => h.Gpu < 0 ? (int?)null : h.Gpu).ToArray(),
                fan = _history.Select(h => h.Fan).ToArray(),
            };
    }

    public object[] Sessions()
    {
        lock (_lock)
        {
            static object Row(Session s, bool active) => new
            {
                game = s.Game, startMs = s.StartMs, seconds = (int)s.Seconds,
                avgCpu = s.Seconds > 0 ? (int)Math.Round(s.CpuSum / s.Seconds) : 0, peakCpu = s.PeakCpu,
                avgGpu = s.GpuSeconds > 0 ? (int?)Math.Round(s.GpuSum / s.GpuSeconds) : null, peakGpu = s.PeakGpu,
                secondsHot = (int)s.SecondsHot, active,
            };
            var rows = _sessions.Select(s => Row(s, false));
            return (_active != null ? rows.Prepend(Row(_active, true)) : rows).ToArray();
        }
    }

    static List<Session> Load()
    {
        try { return JsonSerializer.Deserialize<List<Session>>(File.ReadAllText(SessionFile)) ?? []; }
        catch { return []; }
    }
}
