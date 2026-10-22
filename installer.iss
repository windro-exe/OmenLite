; Inno Setup script. Built by build-installer.ps1, which publishes the app to dist\app first.
#define Version GetEnv("OMENLITE_VERSION")
#if Version == ""
  #define Version "1.0.0"
#endif

[Setup]
AppId={{6B0C9C7E-4E0A-4E8B-9C55-0E3B1F6A7D21}
AppName=OmenLite
AppVersion={#Version}
AppPublisher=OmenLite
DefaultDirName={autopf}\OmenLite
DefaultGroupName=OmenLite
DisableProgramGroupPage=yes
; The app talks to the BIOS and always runs elevated, so it installs machine-wide.
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=dist
OutputBaseFilename=OmenLite-Setup-{#Version}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\OmenLite.exe
CloseApplications=force

[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "dist\app\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\OmenLite"; Filename: "{app}\OmenLite.exe"
Name: "{group}\Uninstall OmenLite"; Filename: "{uninstallexe}"
Name: "{autodesktop}\OmenLite"; Filename: "{app}\OmenLite.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\OmenLite.exe"; Description: "Launch OmenLite"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; The app keeps running in the tray, and "start with Windows" is a scheduled task; remove both.
Filename: "taskkill.exe"; Parameters: "/F /IM OmenLite.exe"; Flags: runhidden; RunOnceId: "KillApp"
Filename: "schtasks.exe"; Parameters: "/Delete /F /TN OmenLite"; Flags: runhidden; RunOnceId: "DelTask"

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\OmenLite"
