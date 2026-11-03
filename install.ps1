# RoleCall Node-free Windows bootstrap (ADR 0023).
#
#   irm https://raw.githubusercontent.com/markporter/rolecall/main/install.ps1 | iex
#
# Downloads the platform binary + SHA256SUMS from GitHub Releases, verifies the
# checksum, then runs `<binary> install --from-dir ...`.

[CmdletBinding()]
param(
  [switch]$System,
  [switch]$User,
  [string]$Prefix,
  [string]$ConfigDir,
  [string]$StateDir,
  [switch]$NoService,
  [switch]$Yes,
  [switch]$DryRun,
  [string]$Version,
  [string]$FromDir
)

$ErrorActionPreference = "Stop"
$Repo = if ($env:ROLECALL_REPO) { $env:ROLECALL_REPO } else { "markporter/rolecall" }

$installArgs = @()
$scope = @()
if ($System) { $scope = @("--system") }
elseif ($User) { $scope = @("--user") }
if ($Prefix) { $installArgs += @("--prefix", $Prefix) }
if ($ConfigDir) { $installArgs += @("--config-dir", $ConfigDir) }
if ($StateDir) { $installArgs += @("--state-dir", $StateDir) }
if ($NoService) { $installArgs += "--no-service" }
if ($Yes) { $installArgs += "--yes" }
if ($DryRun) { $installArgs += "--dry-run" }

if ($FromDir) {
  $bin = Join-Path $FromDir "rolecall.exe"
  if (-not (Test-Path $bin)) { throw "install: $bin not found" }
  & $bin install --from-dir $FromDir @scope @installArgs
  exit $LASTEXITCODE
}

$arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
$target = "windows-$arch"

if (-not $Version) {
  $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=10" -Headers @{ "User-Agent" = "rolecall-install" }
  $release = $releases | Where-Object { -not $_.draft } | Select-Object -First 1
  if (-not $release) { throw "install: could not resolve the latest GitHub release" }
  $Version = $release.tag_name
}

$base = "https://github.com/$Repo/releases/download/$Version"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("rolecall-install-" + [Guid]::NewGuid().ToString("N"))
$stage = Join-Path $tmp "stage"
New-Item -ItemType Directory -Path $stage -Force | Out-Null
try {
  $artifact = Join-Path $tmp "rolecall.exe"
  Write-Host "install: fetching $Repo $Version ($target)"
  Invoke-WebRequest -Uri "$base/rolecall-$target" -OutFile $artifact -UseBasicParsing
  $sums = Join-Path $tmp "SHA256SUMS"
  Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile $sums -UseBasicParsing
  $line = (Get-Content $sums | Where-Object { ($_ -split '\s+')[1] -eq "rolecall-$target" } | Select-Object -First 1)
  if (-not $line) { throw "install: SHA256SUMS has no entry for rolecall-$target" }
  $expected = ($line -split '\s+')[0].ToLower()
  $actual = (Get-FileHash -Algorithm SHA256 $artifact).Hash.ToLower()
  if ($expected -ne $actual) { throw "install: checksum mismatch for rolecall-$target" }

  $stageBin = Join-Path $stage "rolecall.exe"
  Copy-Item $artifact $stageBin
  Set-Content -Path (Join-Path $stage "version.txt") -Value $Version.TrimStart("v") -NoNewline
  Set-Content -Path (Join-Path $stage "SHA256SUMS") -Value "$actual  rolecall.exe"
  & $stageBin install --from-dir $stage @scope @installArgs
  exit $LASTEXITCODE
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
