param(
    [switch]$NoLaunch,
    [switch]$OpenDashboard
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$InstallRoot = Join-Path $env:LOCALAPPDATA "SlopGrenade"
$BinDir = Join-Path $InstallRoot "bin"
$WebDir = Join-Path $InstallRoot "web\build"

Write-Host "==> [1/4] Building Svelte 5 Web Dashboard..." -ForegroundColor Cyan
npm --prefix "$RepoRoot\web" run build

Write-Host "==> [2/4] Building Release Rust Background Daemon (slop-grenade.exe)..." -ForegroundColor Cyan
cargo build --manifest-path "$RepoRoot\rust\Cargo.toml" --release

Write-Host "==> [3/4] Compiling Native Windows Desktop Screen Overlay (slop-grenade-overlay.exe)..." -ForegroundColor Cyan
Get-Process slop-grenade-overlay, slop-grenade -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 500
New-Item -ItemType Directory -Force -Path $BinDir, $WebDir | Out-Null

$CscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $CscPath)) {
    throw "Windows C# compiler not found at $CscPath"
}

$OverlayExe = Join-Path $BinDir "slop-grenade-overlay.exe"
& $CscPath /nologo /target:winexe /optimize+ `
    /r:System.dll,System.Drawing.dll,System.Windows.Forms.dll,System.Web.Extensions.dll `
    /out:$OverlayExe `
    "/recurse:$RepoRoot\desktop\*.cs"
if ($LASTEXITCODE -ne 0) {
    throw "Desktop overlay failed to compile (see csc errors above)"
}

Copy-Item -Force "$RepoRoot\rust\target\release\slop-grenade.exe" (Join-Path $BinDir "slop-grenade.exe")
Copy-Item -Force -Recurse "$RepoRoot\web\build\*" $WebDir

Write-Host "==> [4/4] Creating Start Menu and Desktop Shortcuts..." -ForegroundColor Cyan
$WshShell = New-Object -ComObject WScript.Shell
$StartMenuShortcut = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\Slop Grenade.lnk"
$DesktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Slop Grenade.lnk"

foreach ($ShortcutPath in @($StartMenuShortcut, $DesktopShortcut)) {
    try {
        $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
        $Shortcut.TargetPath = $OverlayExe
        $Shortcut.WorkingDirectory = $BinDir
        $Shortcut.Description = "Slop Grenade - Native Windows Desktop Overlay and M365 AI Slop Detector"
        $Shortcut.Save()
    } catch {
        Write-Host "  (Skipped locked shortcut: $ShortcutPath)" -ForegroundColor DarkGray
    }
}

Write-Host "==> Configuring Slop Grenade to run automatically at Windows startup..." -ForegroundColor Cyan
$RunRegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
Set-ItemProperty -Path $RunRegPath -Name "SlopGrenade" -Value "`"$OverlayExe`""

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  SLOP GRENADE INSTALLED LOCALLY!" -ForegroundColor Green
Write-Host "  Install Path      : $InstallRoot"
Write-Host "  Desktop Overlay   : $OverlayExe"
Write-Host "  Background Daemon : $BinDir\slop-grenade.exe"
Write-Host "  Shortcuts Created : Start Menu and Desktop ('Slop Grenade')"
Write-Host "  Web Dashboard URL : http://127.0.0.1:8090/"
Write-Host "================================================================" -ForegroundColor Green

if (-not $NoLaunch) {
    Write-Host "==> Starting Native Windows Desktop Overlay + Background Daemon..." -ForegroundColor Cyan
    Start-Process -FilePath $OverlayExe -WorkingDirectory $BinDir
    if ($OpenDashboard) {
        Start-Sleep -Seconds 2
        Start-Process "http://127.0.0.1:8090/"
    }
}
