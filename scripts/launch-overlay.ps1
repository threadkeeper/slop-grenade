param(
    [switch]$OverlayOnly,
    [string]$Bind = "127.0.0.1:8090"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "==> Building Svelte 5 Monitor Overlay & Awareness UI..." -ForegroundColor Cyan
npm --prefix "$RepoRoot\web" run build

$env:HTTP_BIND = $Bind
$env:WEB_ASSET_DIR = "$RepoRoot\web\build"

$TargetUrl = if ($OverlayOnly) { "http://$Bind/?mode=overlay" } else { "http://$Bind/" }
Write-Host "==> Launching Slop Grenade UI at $TargetUrl" -ForegroundColor Green

Start-Job -ScriptBlock {
    param($url)
    Start-Sleep -Seconds 2
    Start-Process "msedge" "--app=$url"
} -ArgumentList $TargetUrl | Out-Null

cargo run --manifest-path "$RepoRoot\rust\Cargo.toml"
