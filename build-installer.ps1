# Builds dist\OmenLite-Setup-<version>.exe: web UI, self-contained app (no .NET install needed), then the installer.
param([string]$Version = "1.0.0")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Push-Location ui
npm ci; if ($LASTEXITCODE) { throw "npm ci failed" }
npm run build; if ($LASTEXITCODE) { throw "UI build failed" }
Pop-Location

if (Test-Path dist) { Remove-Item -Recurse -Force dist }
dotnet publish -c Release -r win-x64 --self-contained true -p:Version=$Version -o dist\app
if ($LASTEXITCODE) { throw "dotnet publish failed" }

$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "Inno Setup 6 not found (winget install JRSoftware.InnoSetup)" }
$env:OMENLITE_VERSION = $Version
& $iscc /Q installer.iss
if ($LASTEXITCODE) { throw "ISCC failed" }
Get-Item dist\OmenLite-Setup-$Version.exe
