$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$TestExe = Join-Path ([System.IO.Path]::GetTempPath()) ("slop-grenade-desktop-tests-{0}.exe" -f [Guid]::NewGuid())
try {
    & 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /langversion:5 /target:exe /optimize+ `
        /r:System.dll,System.Drawing.dll,System.Windows.Forms.dll,System.Web.Extensions.dll `
        /main:SlopGrenadeDesktop.EffectHoverTests "/out:$TestExe" `
        "/recurse:$RepoRoot\desktop\*.cs" "$RepoRoot\tests\desktop\EffectHoverTests.cs"
    if ($LASTEXITCODE -ne 0) { throw 'Desktop test compilation failed.' }
    & $TestExe
    if ($LASTEXITCODE -ne 0) { throw 'Desktop hover tests failed.' }
} finally {
    if (Test-Path -LiteralPath $TestExe) { Remove-Item -LiteralPath $TestExe -Force }
}
