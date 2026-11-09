param(
  [Parameter(Mandatory = $true)][string]$SourceRepository,
  [Parameter(Mandatory = $true)][string]$RuntimeRoot
)

$ErrorActionPreference = "Stop"
$expectedCommit = "17691acd9bc80171e5ef4b3532ff0748ba231813"
$source = (Resolve-Path $SourceRepository).Path
$head = (git -C $source rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -ne $expectedCommit) {
  throw "Source repository is not at the pinned upstream commit."
}
if ((git -C $source status --porcelain=v1).Length -ne 0) {
  throw "Source repository must be clean."
}
if (Test-Path $RuntimeRoot) {
  throw "RuntimeRoot already exists; refusing to overwrite it."
}

$root = [IO.Path]::GetFullPath($RuntimeRoot)
New-Item -ItemType Directory -Path $root | Out-Null
Copy-Item -Recurse -LiteralPath $PSScriptRoot -Destination (Join-Path $root "scenario")
New-Item -ItemType Directory -Path (Join-Path $root "mutations") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $root "evidence") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $root "tools") | Out-Null

$utf8 = [Text.UTF8Encoding]::new($false)
$corepackCandidates = @(
  $(if ($env:COREPACK_HOME) { $env:COREPACK_HOME }),
  (Join-Path $env:LOCALAPPDATA "node\corepack"),
  (Join-Path $env:USERPROFILE "AppData\Local\node\corepack")
) | Where-Object { $_ }
$pnpmEntry = $corepackCandidates |
  ForEach-Object { Join-Path $_ "v1\pnpm\11.25.0\bin\pnpm.mjs" } |
  Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1
if (-not (Test-Path -LiteralPath $pnpmEntry)) {
  throw "Corepack-managed pnpm 11.25.0 is not already available; refusing to download it."
}
[IO.File]::WriteAllText(
  (Join-Path $root "tools\pnpm.cmd"),
  "@node `"$pnpmEntry`" %*`r`n",
  $utf8
)

$c1ConfigPath = Join-Path $root "scenario\c1.json"
$c1Config = Get-Content -Raw $c1ConfigPath | ConvertFrom-Json
$c1Config.install.command = "node"
$c1Config.install.commandArgs = @($pnpmEntry)
$c1Config | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 $c1ConfigPath

foreach ($case in @("c1", "c2", "c3", "c4")) {
  $target = Join-Path $root "targets\$case\examples\basic"
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  $tracked = git -C $source ls-files examples/basic
  if ($LASTEXITCODE -ne 0 -or $tracked.Count -eq 0) { throw "Unable to enumerate pinned Basic files." }
  foreach ($relative in $tracked) {
    $insideBasic = $relative.Substring("examples/basic/".Length)
    $destination = Join-Path $target $insideBasic
    New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $source $relative) -Destination $destination
  }
  git -C $target init --quiet
  git -C $target add .
  git -C $target -c user.name=CacheTrust -c user.email=cachetrust.invalid commit --quiet -m "Import Turborepo Basic $expectedCommit"
  if ($LASTEXITCODE -ne 0) { throw "Unable to commit isolated Basic snapshot for $case." }
}

$page = Join-Path $root "targets\c2\examples\basic\apps\web\app\page.tsx"
$pageText = [IO.File]::ReadAllText($page)
$c2 = $pageText.Replace(
  "<li>Save and see your changes instantly.</li>",
  "<li>CACHE_TRUST_C2_V2 source change detected.</li>"
)
[IO.File]::WriteAllText((Join-Path $root "mutations\c2-page.tsx"), $c2, $utf8)

$button = Join-Path $root "targets\c3\examples\basic\packages\ui\src\button.tsx"
$buttonText = [IO.File]::ReadAllText($button)
$c3 = $buttonText.Replace(
  'alert(`Hello from your ${appName} app!`)',
  'alert(`CACHE_TRUST_C3_V2 shared UI for ${appName}`)'
)
[IO.File]::WriteAllText((Join-Path $root "mutations\c3-button.tsx"), $c3, $utf8)

$c4Page = Join-Path $root "targets\c4\examples\basic\apps\web\app\page.tsx"
$c4PageText = [IO.File]::ReadAllText($c4Page).Replace(
  "<li>Save and see your changes instantly.</li>",
  "<li>CACHE_TRUST_C4_V2 must appear in a correct build.</li>"
)
[IO.File]::WriteAllText((Join-Path $root "mutations\c4-page.tsx"), $c4PageText, $utf8)

function Write-ScenarioConfig([string]$case, [scriptblock]$edit) {
  $config = Get-Content -Raw (Join-Path $root "scenario\c1.json") | ConvertFrom-Json
  & $edit $config
  $config | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 (Join-Path $root "scenario\$case.json")
}

Write-ScenarioConfig "c2" {
  param($config)
  $config.id = "phase3-basic-c2-app-source-change"
  $config.projectRoot = "../targets/c2/examples/basic"
  $config.evidenceFile = "../evidence/c2.json"
  $config.tasks[0].expectedAfterMutation = "HIT"
  $config.tasks[1].expectedAfterMutation = "MISS"
  $config.mutation = [ordered]@{
    kind = "replace-file"
    path = "apps/web/app/page.tsx"
    replacementFile = "../mutations/c2-page.tsx"
    expectedBeforeSha256 = "3a55473849c203cb6c066faef6e1f12e222419eab0277f8ada9ea3738bb8df89"
    expectedAfterSha256 = "3a9b5e86d7c959389faf66a31529d7fc5f7bd8128e199b3fbd8a16262f4a40ae"
  }
  $config | Add-Member functionalChecks @(
    [ordered]@{ target = "cache"; under = "apps/web/.next"; contains = "CACHE_TRUST_C2_V2 source change detected." },
    [ordered]@{ target = "baseline"; under = "apps/web/.next"; contains = "CACHE_TRUST_C2_V2 source change detected." }
  )
}

Write-ScenarioConfig "c3" {
  param($config)
  $config.id = "phase3-basic-c3-shared-ui-change"
  $config.projectRoot = "../targets/c3/examples/basic"
  $config.evidenceFile = "../evidence/c3.json"
  $config.tasks[0].expectedAfterMutation = "MISS"
  $config.tasks[1].expectedAfterMutation = "MISS"
  $config.mutation = [ordered]@{
    kind = "replace-file"
    path = "packages/ui/src/button.tsx"
    replacementFile = "../mutations/c3-button.tsx"
    expectedBeforeSha256 = "d68ca1b1982d49ea79f033a5018d61eeac3804bfa4033de828a73c761d0f8ad2"
    expectedAfterSha256 = "bafab903c961366e7513d423bcd10e3ea702e404fe7ba62047d61e636e34b911"
  }
  $config | Add-Member functionalChecks @(
    [ordered]@{ target = "cache"; under = "apps/docs/.next"; contains = "CACHE_TRUST_C3_V2" },
    [ordered]@{ target = "cache"; under = "apps/web/.next"; contains = "CACHE_TRUST_C3_V2" },
    [ordered]@{ target = "baseline"; under = "apps/docs/.next"; contains = "CACHE_TRUST_C3_V2" },
    [ordered]@{ target = "baseline"; under = "apps/web/.next"; contains = "CACHE_TRUST_C3_V2" }
  )
}

Write-ScenarioConfig "c4" {
  param($config)
  $config.id = "phase3-basic-c4-intentional-input-exclusion"
  $config.projectRoot = "../targets/c4/examples/basic"
  $config.evidenceFile = "../evidence/c4.json"
  $config.mutation = [ordered]@{
    kind = "replace-file"
    path = "apps/web/app/page.tsx"
    replacementFile = "../mutations/c4-page.tsx"
    expectedBeforeSha256 = "3a55473849c203cb6c066faef6e1f12e222419eab0277f8ada9ea3738bb8df89"
    expectedAfterSha256 = "3b6657f69df55030338b73c4b0f392eb142467ce0b7a25f5a4a3eee721d7e99c"
  }
  $config | Add-Member functionalChecks @(
    [ordered]@{ target = "cache"; under = "apps/web/.next"; notContains = "CACHE_TRUST_C4_V2 must appear in a correct build." },
    [ordered]@{ target = "baseline"; under = "apps/web/.next"; contains = "CACHE_TRUST_C4_V2 must appear in a correct build." }
  )
  $config | Add-Member preparedFault ([ordered]@{
    kind = "intentional-input-exclusion"
    description = "The disposable target excludes app/page.tsx from every build task input."
    configFiles = @("turbo.json")
  })
}

$turbo = Join-Path $root "targets\c4\examples\basic\turbo.json"
$turboText = [IO.File]::ReadAllText($turbo).Replace(
  '"inputs": ["$TURBO_DEFAULT$", ".env*"]',
  '"inputs": ["$TURBO_DEFAULT$", ".env*", "!app/page.tsx"]'
)
[IO.File]::WriteAllText($turbo, $turboText, $utf8)
git -C (Join-Path $root "targets\c4\examples\basic") add turbo.json
git -C (Join-Path $root "targets\c4\examples\basic") -c user.name=CacheTrust -c user.email=cachetrust.invalid commit --quiet -m "Inject intentional page input exclusion"
if ($LASTEXITCODE -ne 0) { throw "C4 prepared-fault commit failed." }

$observedPnpm = (node $pnpmEntry --version).Trim()
$manifest = [ordered]@{
  upstream = "vercel/turborepo"
  commit = $expectedCommit
  node = (node --version).TrimStart("v")
  pnpm = $observedPnpm
  turbo = "2.10.12"
  source = $source
}
$manifest | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $root "preparation.json")

foreach ($case in @("c1", "c2", "c3", "c4")) {
  if ((git -C (Join-Path $root "targets\$case\examples\basic") status --porcelain=v1).Length -ne 0) {
    throw "Prepared target is dirty: $case"
  }
}

Write-Output $root
