param(
  [Parameter(Mandatory = $true)][string]$Snapshot,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$files = foreach ($app in @("web", "docs")) {
  $next = Join-Path $Snapshot "apps\$app\.next"
  $buildId = (Get-Content -Raw (Join-Path $next "BUILD_ID")).Trim()
  $referenceManifest = Get-Content -Raw (Join-Path $next "server\server-reference-manifest.json") |
    ConvertFrom-Json
  $encryptionKey = $referenceManifest.encryptionKey
  $preview = (Get-Content -Raw (Join-Path $next "prerender-manifest.json") | ConvertFrom-Json).preview
  Get-ChildItem $next -Recurse -File |
    Where-Object {
      $_.FullName -notmatch '[\\/]\.next[\\/](cache|dev)([\\/]|$)' -and
      $_.Name -notin @("trace", "trace-build")
    } |
    ForEach-Object {
      $path = [IO.Path]::GetRelativePath($Snapshot, $_.FullName).Replace("\", "/")
      $path = $path.Replace($buildId, "<BUILD_ID>")
      $bytes = [IO.File]::ReadAllBytes($_.FullName)
      try {
        $text = $utf8.GetString($bytes).Replace($buildId, "<BUILD_ID>")
        if ($null -ne $encryptionKey) {
          $text = $text.Replace($encryptionKey, "<ENCRYPTION_KEY>")
        }
        foreach ($property in @("previewModeId", "previewModeSigningKey", "previewModeEncryptionKey")) {
          if ($null -ne $preview.$property) {
            $text = $text.Replace($preview.$property, "<$property>")
          }
        }
        $bytes = [Text.Encoding]::UTF8.GetBytes($text)
      } catch [Text.DecoderFallbackException] {
        # Binary output is hashed without normalization.
      }
      [pscustomobject]@{
        path = $path
        bytes = $bytes.Length
        sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
      }
    }
}
$files = @($files | Sort-Object path)
$json = ConvertTo-Json $files -Depth 3
$json | Set-Content -Encoding utf8 $OutputPath
$overall = [Convert]::ToHexString(
  [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($json))
).ToLowerInvariant()
[pscustomobject]@{ files = $files.Count; sha256 = $overall } | ConvertTo-Json
