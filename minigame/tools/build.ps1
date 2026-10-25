param(
  [ValidateSet('web-mobile', 'wechatgame')][string]$Platform = 'web-mobile',
  [string]$CreatorPath = 'C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe'
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not (Test-Path -LiteralPath $CreatorPath)) { throw 'Cocos Creator 3.8.8 not found; set -CreatorPath.' }
$BuildConfig = Join-Path $ProjectRoot "build-config\$Platform.json"
$LogRoot = Join-Path $ProjectRoot 'output'
New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
$BuildProcess = Start-Process -FilePath $CreatorPath -ArgumentList @('--project', "`"$ProjectRoot`"", '--build', "`"configPath=$BuildConfig`"") -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $LogRoot "build-$Platform.log") -RedirectStandardError (Join-Path $LogRoot "build-$Platform-error.log")
# Creator returns 36 for a successful command-line build.
if ($BuildProcess.ExitCode -notin @(0, 36)) { throw "Creator build exit code: $($BuildProcess.ExitCode). Check output/build logs." }
if ($Platform -eq 'wechatgame') {
  $SourceConfig = Get-Content -LiteralPath $BuildConfig -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $SourceConfig.packages.wechatgame.appid) {
    $WechatProject = Join-Path $ProjectRoot 'build\wechatgame\project.config.json'
    $PreviewConfig = Get-Content -LiteralPath $WechatProject -Raw -Encoding UTF8 | ConvertFrom-Json
    $PreviewConfig.appid = 'touristappid'
    $PreviewConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $WechatProject -Encoding utf8
  }
}
Write-Output "Build complete: $ProjectRoot\build\$Platform"
