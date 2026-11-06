param(
    [Parameter(Mandatory = $true)][string]$ExePath,
    [string]$IconPath
)
$ErrorActionPreference = 'Stop'
if (-not $IconPath) { $IconPath = Join-Path $PSScriptRoot '../src-tauri/icons/icon.ico' }
Add-Type -AssemblyName System.Drawing
if (-not ('LarkAnythingIconCheck' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LarkAnythingIconCheck {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern uint PrivateExtractIconsW(string path, int index, int width, int height, IntPtr[] icons, uint[] ids, uint count, uint flags);
    [DllImport("user32.dll")]
    public static extern bool DestroyIcon(IntPtr icon);
}
'@
}
function Get-IconBitmap([string]$Path, [int]$Size) {
    $handles = [IntPtr[]]::new(1)
    $ids = [uint32[]]::new(1)
    $count = [LarkAnythingIconCheck]::PrivateExtractIconsW((Resolve-Path -LiteralPath $Path).Path, 0, $Size, $Size, $handles, $ids, 1, 0)
    if ($count -ne 1 -or $handles[0] -eq [IntPtr]::Zero) { throw "Cannot extract $Size px icon from $Path" }
    try {
        $icon = [System.Drawing.Icon]::FromHandle($handles[0])
        try { return $icon.ToBitmap() } finally { $icon.Dispose() }
    } finally {
        [void][LarkAnythingIconCheck]::DestroyIcon($handles[0])
    }
}
foreach ($size in @(16, 32, 48, 256)) {
    $actual = Get-IconBitmap $ExePath $size
    $expected = $null
    try {
        $expected = Get-IconBitmap $IconPath $size
        if ($actual.Size -ne $expected.Size) { throw "Icon size mismatch at $size px" }
        for ($y = 0; $y -lt $actual.Height; $y++) {
            for ($x = 0; $x -lt $actual.Width; $x++) {
                if ($actual.GetPixel($x, $y).ToArgb() -ne $expected.GetPixel($x, $y).ToArgb()) {
                    throw "Embedded EXE icon differs from source at $size px ($x, $y): $ExePath"
                }
            }
        }
        Write-Output "PASS: embedded $size px icon matches source"
    } finally {
        $actual.Dispose()
        if ($null -ne $expected) { $expected.Dispose() }
    }
}
