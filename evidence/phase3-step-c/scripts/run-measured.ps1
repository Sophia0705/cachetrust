param(
  [Parameter(Mandatory = $true)][string]$Workspace,
  [Parameter(Mandatory = $true)][string]$CacheDir,
  [Parameter(Mandatory = $true)][string]$RunName
)

$ErrorActionPreference = "Stop"
$logDir = Join-Path $PSScriptRoot "logs"
$stdoutPath = Join-Path $logDir "$RunName.stdout.log"
$stderrPath = Join-Path $logDir "$RunName.stderr.log"
$metricsPath = Join-Path $logDir "$RunName.metrics.json"
$existingNodeIds = @(Get-Process node -ErrorAction SilentlyContinue | ForEach-Object Id)
$environment = @{
  TURBO_TOKEN = $null
  TURBO_TEAM = $null
  TURBO_REMOTE_ONLY = $null
  CI = "1"
  NEXT_TELEMETRY_DISABLED = "1"
  PATH = (Join-Path $PSScriptRoot "tools") + ";" + $env:PATH
}
$arguments = @(
  '"C:\Program Files\nodejs\node_modules\corepack\dist\corepack.js"',
  "pnpm@11.25.0", "exec", "turbo", "run", "build",
  "--cache=local:rw", "--cache-dir", ('"' + $CacheDir + '"'),
  "--summarize", "--ui=stream", "--no-color", "--concurrency=2"
)
$startedAt = Get-Date
$stopwatch = [Diagnostics.Stopwatch]::StartNew()
$process = Start-Process -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList $arguments `
  -WorkingDirectory $Workspace -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath `
  -Environment $environment
$peakWorkingSet = 0L
while (-not $process.HasExited) {
  $workingSet = Get-Process node -ErrorAction SilentlyContinue |
    Where-Object { $_.Id -notin $existingNodeIds } |
    Measure-Object WorkingSet64 -Sum |
    Select-Object -ExpandProperty Sum
  if ($null -ne $workingSet -and $workingSet -gt $peakWorkingSet) {
    $peakWorkingSet = $workingSet
  }
  Start-Sleep -Milliseconds 100
  $process.Refresh()
}
$stopwatch.Stop()
[pscustomobject]@{
  run = $RunName
  exitCode = $process.ExitCode
  startedAt = $startedAt.ToString("o")
  durationMs = [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 1)
  observedPeakNodeWorkingSetBytes = $peakWorkingSet
  cacheDir = $CacheDir
} | ConvertTo-Json | Set-Content -Encoding utf8 $metricsPath
Get-Content $metricsPath
exit $process.ExitCode
