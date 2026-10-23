param(
    [switch]$OpenDashboard,
    [switch]$Showcase,
    [string]$Bind = "127.0.0.1:8090"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "==> Building Svelte 5 Web Dashboard..." -ForegroundColor Cyan
npm --prefix "$RepoRoot\web" run build

Write-Host "==> Compiling Native Windows Desktop Screen Overlay (slop-grenade-overlay.exe)..." -ForegroundColor Cyan
$CscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$OverlayExe = "$RepoRoot\desktop\slop-grenade-overlay.exe"
& $CscPath /nologo /target:winexe /optimize+ `
    /r:System.dll,System.Drawing.dll,System.Windows.Forms.dll `
    /out:$OverlayExe `
    "$RepoRoot\desktop\SlopGrenadeOverlay.cs"

$env:HTTP_BIND = $Bind
$env:WEB_ASSET_DIR = "$RepoRoot\web\build"

Write-Host "==> Launching Native Windows Desktop Monitor Overlay + System Tray Icon..." -ForegroundColor Green
$OverlayArgs = if ($Showcase) { @("--showcase") } else { @() }
if ($OverlayArgs.Count -gt 0) {
    Start-Process -FilePath $OverlayExe -ArgumentList $OverlayArgs -WorkingDirectory "$RepoRoot\desktop"
} else {
    Start-Process -FilePath $OverlayExe -WorkingDirectory "$RepoRoot\desktop"
}

if ($OpenDashboard) {
    Start-Sleep -Seconds 2
    Start-Process "http://$Bind/"
}

cargo run --manifest-path "$RepoRoot\rust\Cargo.toml"
