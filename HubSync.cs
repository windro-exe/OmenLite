using System.Security.Principal;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace OmenLite;

/// HP OMEN Gaming Hub shows, and its background service re-applies, its own saved copy of the settings: a plain JSON
/// file (crypter is a no-op) guarded by two global mutexes. Mirroring our changes into it keeps both apps in
/// agreement. Best effort: without Hub, or if the file changes shape, it does nothing and never affects the hardware path.
public static class HubSync
{
    const string ZeroId = "00000000-0000-0000-0000-000000000000";
    static readonly string Folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Publishers", "v10z8vjag6ke6", "OMEN");
    static readonly string Sid = WindowsIdentity.GetCurrent().User!.Value;
    static readonly JsonSerializerOptions Compact = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// Sets DWord values in one Hub module (e.g. "PerformanceControl", "FourZoneLighting") of the default and active profiles.
    /// Keys Hub hasn't created yet are added; a module Hub never created is skipped.
    public static void Set(string module, params (string Key, int Value)[] values)
    {
        var path = Path.Combine(Folder, "profiles.json");
        if (!File.Exists(path)) return;
        var held = new List<Mutex>();
        try
        {
            foreach (var name in new[] { "ProfileJsonWrapperLock_", "ProfilesMutex_" })
            {
                // Join HP's lock if an HP process holds it. Never create it: made by us (elevated) it would deny HP's
                // non-elevated app. If none exists, no HP process is running, so nothing can race the write.
                if (!Mutex.TryOpenExisting(@"Global\" + name + Sid, out var m)) continue;
                if (!Wait(m)) { m.Dispose(); return; }
                held.Add(m);
            }
            using var fs = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.Read);
            var root = JsonNode.Parse(fs)!;
            var active = root["ACTIVEPROFILE"]?.GetValue<string>();
            var changed = false;
            foreach (var user in root["ALLPROFILES"]!.AsArray())
                foreach (var profile in user!["profiles"]!.AsArray())
                {
                    var id = profile!["profileId"]!.GetValue<string>();
                    if (id != ZeroId && id != active) continue;
                    var data = profile["modules"]!.AsArray()
                        .FirstOrDefault(m => m!["module"]!.GetValue<string>() == module)?["moduleValue"]?[0]?["data"]?.AsArray();
                    if (data == null) continue;
                    foreach (var (key, value) in values)
                    {
                        var entry = data.FirstOrDefault(d => d!.AsObject().ContainsKey(key))?.AsObject();
                        if (entry == null) data.Add(entry = new JsonObject());
                        entry[key] = "DWord+" + value;
                        changed = true;
                    }
                }
            if (!changed) return;
            fs.SetLength(0); // Hub rewrites the file in place the same way
            JsonSerializer.Serialize(fs, root, Compact);
            fs.Flush();
            // Open Hub windows reload when this file's content changes.
            File.WriteAllText(Path.Combine(Folder, "profileschanged.json"), JsonSerializer.Serialize(DateTime.Now.ToString("dd-MM-yyyy HH:mm:ss")));
        }
        catch { /* Hub missing, locked, or a different file layout: leave its settings alone */ }
        finally
        {
            foreach (var m in held) { m.ReleaseMutex(); m.Dispose(); }
        }
    }
    static bool Wait(Mutex m)
    {
        try { return m.WaitOne(3000); }
        catch (AbandonedMutexException) { return true; } // previous owner died; we now own it
    }
}
