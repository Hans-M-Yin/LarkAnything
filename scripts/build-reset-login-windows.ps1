param([string]$OutputPath = (Join-Path $PSScriptRoot '../.larkanything/Reset-LarkAnything-Login.exe'))
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework compiler not found.' }
$output = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
& $compiler /nologo /codepage:65001 /target:winexe /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll "/out:$output" (Join-Path $PSScriptRoot 'windows/ResetLogin.cs')
if ($LASTEXITCODE -ne 0) { throw 'Reset helper compilation failed.' }
Write-Output $output
