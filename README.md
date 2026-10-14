# OmenLite

A small, fast replacement for HP OMEN Gaming Hub on OMEN laptops: performance mode and fans, 4-zone keyboard lighting, graphics mode, and a game booster. It talks to the laptop's BIOS directly, the same way OMEN Gaming Hub does.

## Install

1. Download `OmenLite-Setup-x.y.z.exe` from [Releases](../../releases/latest).
2. Run it. Windows SmartScreen may say "Windows protected your PC" because the installer isn't code-signed: click **More info → Run anyway**.
3. OmenLite asks for administrator rights every time it starts; it needs them to talk to the BIOS.

Closing the window keeps OmenLite in the tray. Right-click the tray icon → **Exit** to quit. Uninstall from Windows Settings → Apps.

**Needs:** an HP OMEN or Victus laptop, Windows 10 or 11 (64-bit), and the Microsoft Edge WebView2 Runtime (built into Windows 11; [download](https://developer.microsoft.com/microsoft-edge/webview2/) if missing on Windows 10).

The Keyboard page draws your laptop's own keyboard from the type the BIOS reports. Keyboards it doesn't know yet show the four lighting zones as plain blocks.

## Build

Needs Node 24, the .NET 8 SDK, and Inno Setup 6 (`winget install JRSoftware.InnoSetup`).

```powershell
./build-installer.ps1 -Version 1.0.0   # writes dist/OmenLite-Setup-1.0.0.exe
```

UI source is in `ui/` (React + Vite, built into `wwwroot/`); the host and hardware code are the `.cs` files in the root.

Not affiliated with HP. Use at your own risk: fan and power settings change real hardware behaviour.
