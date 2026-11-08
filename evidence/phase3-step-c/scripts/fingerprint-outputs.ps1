param(
  [Parameter(Mandatory = $true)][string]$Workspace,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
$files = Get-ChildItem (Join-Path $Workspace "apps") -Recurse -File |
  Where-Object {
    $_.FullName -match '[\\/]\.next[\\/]' -and
    $_.FullName -notmatch '[\\/]\.next[\\/](cache|dev)([\\/]|$)'
  } |
  ForEach-Object {
    [pscustomobject]@{
      path = [IO.Path]::GetRelativePath($Workspace, $_.FullName).Replace("\", "/")
      bytes = $_.Length
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  } |
  Sort-Object path
$manifestJson = ConvertTo-Json @($files) -Depth 3
$manifestJson | Set-Content -Encoding utf8 $OutputPath
$manifestBytes = [Text.Encoding]::UTF8.GetBytes($manifestJson)
$overall = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($manifestBytes)).ToLowerInvariant()
[pscustomobject]@{ files = @($files).Count; bytes = ($files | Measure-Object bytes -Sum).Sum; sha256 = $overall } |
  ConvertTo-Json
