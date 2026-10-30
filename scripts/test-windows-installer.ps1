param(
    [Parameter(Mandatory = $true)][string]$Installer
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Assert-BrandedIcon([string]$path) {
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
    if ($null -eq $icon) { throw "No icon found in $path" }
    $bitmap = $icon.ToBitmap()
    try {
        $pink = 0
        for ($y = 0; $y -lt $bitmap.Height; $y++) {
            for ($x = 0; $x -lt $bitmap.Width; $x++) {
                $pixel = $bitmap.GetPixel($x, $y)
                if ($pixel.R -gt 150 -and $pixel.B -gt 75 -and $pixel.G -lt 100) { $pink++ }
            }
        }
        if ($pink -lt 5) { throw "The branded pink grenade icon is missing from $path" }
    } finally {
        $bitmap.Dispose()
        $icon.Dispose()
    }
}

Assert-BrandedIcon $Installer
$install = Join-Path $env:LOCALAPPDATA 'SlopGrenade'
$process = Start-Process -FilePath $Installer -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
foreach ($file in @('bin\slop-grenade.exe', 'bin\slop-grenade-overlay.exe', 'web\build\index.html', 'web\build\favicon.png', 'unins000.exe')) {
    if (-not (Test-Path (Join-Path $install $file))) { throw "Installed file missing: $file" }
}
Assert-BrandedIcon (Join-Path $install 'bin\slop-grenade-overlay.exe')
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Slop Grenade\Slop Grenade.lnk'
if (-not (Test-Path $shortcut)) { throw 'Start Menu shortcut is missing.' }
$env:HTTP_BIND = '127.0.0.1:18090'
$env:SLOP_AUTO_POLL = '0'
$env:GMAIL_ENABLED = '0'
$overlay = Start-Process -FilePath (Join-Path $install 'bin\slop-grenade-overlay.exe') -PassThru
try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        if ($overlay.HasExited) { throw 'Installed overlay exited before starting its daemon.' }
        try {
            $health = Invoke-WebRequest 'http://127.0.0.1:18090/api/v1/health' -TimeoutSec 1
            if ($health.StatusCode -eq 200) { $ready = $true; break }
        } catch [System.Net.Http.HttpRequestException] {
            # The daemon may still be starting.
        } catch [System.Threading.Tasks.TaskCanceledException] {
            # Retry a timed-out readiness probe.
        }
    }
    if (-not $ready) { throw 'Installed overlay did not start a healthy daemon.' }
    $dashboard = Invoke-WebRequest 'http://127.0.0.1:18090/' -TimeoutSec 5
    if ($dashboard.Content -notmatch '_app/') { throw 'Installed dashboard assets are not being served.' }
} finally {
    # Restrict cleanup to binaries installed by this smoke test.
    Get-Process | Where-Object { $_.Path -in @(
        (Join-Path $install 'bin\slop-grenade-overlay.exe'),
        (Join-Path $install 'bin\slop-grenade.exe')
    ) } | ForEach-Object { Stop-Process -Id $_.Id -Force }
}
$uninstall = Start-Process -FilePath (Join-Path $install 'unins000.exe') -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait -PassThru
if ($uninstall.ExitCode -ne 0) { throw "Uninstaller failed: $($uninstall.ExitCode)" }
if (Test-Path (Join-Path $install 'bin\slop-grenade.exe')) { throw 'Uninstaller left the installed daemon behind.' }
