# loom — 公共函数库（PowerShell）
# 被 install.ps1 和 uninstall.ps1 共享

$Repo = "xiqin/loom"
# AUTO-SYNC: updated by scripts/generate-tooling.mjs and scripts/sync-version.mjs
$DefaultVersion = "3.0.1"
if (-not $Version) { $Version = $DefaultVersion }
$SupportedTools = @("claude-code", "cursor", "copilot", "opencode", "codex")

# ── Color helpers ───────────────────────────────────────────────────────
$Esc = [char]27
function Say($msg)   { if ($NoColor) { Write-Host $msg } else { Write-Host "$Esc[38;5;39m$msg$Esc[0m" } }
function Note($msg)  { if ($NoColor) { Write-Host $msg } else { Write-Host "$Esc[2m$msg$Esc[0m" } }
function Ok($msg)    { if ($NoColor) { Write-Host $msg } else { Write-Host "$Esc[32m$msg$Esc[0m" } }
function Warn($msg)  { if ($NoColor) { Write-Host $msg } else { Write-Host "$Esc[33m$msg$Esc[0m" } }
function Err($msg)   { if ($NoColor) { [Console]::Error.WriteLine($msg) } else { [Console]::Error.WriteLine("$Esc[31m$msg$Esc[0m") } }

# ── Validate tool ───────────────────────────────────────────────────────
function Validate-Tools {
  $script:Tools = @()
  foreach ($t in $Tool) {
    foreach ($x in ($t -split ',')) {
      $trimmed = $x.Trim()
      if ($trimmed) {
        if ($SupportedTools -notcontains $trimmed) {
          Err "error: unsupported tool '$trimmed'. Supported: $($SupportedTools -join ', ')"
          exit 2
        }
        $script:Tools += $trimmed
      }
    }
  }

  if ($Tools.Count -eq 0) {
    Err "error: -Tool is required"
    Write-Host "  Supported: $($SupportedTools -join ', ')"
    Write-Host "  Example: $PSCommandPath -Tool claude-code"
    exit 2
  }
}

# ── Detect repo root ────────────────────────────────────────────────────
function Get-RepoRoot {
  $src = $PSCommandPath
  if ($src -and (Test-Path $src)) {
    $d = Split-Path -Parent $src
    if ((Test-Path (Join-Path $d "bin\loom.js")) -and (Test-Path (Join-Path $d "package.json"))) {
      return $d
    }
  }
  return $null
}

# ── Resolve loom source ───────────────────────────────────────────────────
$LoomCli = ""
$CleanupDir = ""
$Cleanup = $false

function Resolve-Source {
  $repoRoot = Get-RepoRoot

  if (-not $FromRelease -and $repoRoot) {
    Note "  mode: local ($repoRoot)"
    $script:LoomCli = Join-Path $repoRoot "bin\loom.js"
    return
  }

  # Remote: download from release tag
  Note "  mode: release (v$Version)"

  $curlCmd = $null
  if (Get-Command "curl.exe" -ErrorAction SilentlyContinue) {
    $curlCmd = "curl.exe"
  } elseif (Get-Command "curl" -ErrorAction SilentlyContinue) {
    $curlPath = (Get-Command "curl" -ErrorAction SilentlyContinue).Source
    if ($curlPath -and -not $curlPath.EndsWith("\WindowsPowerShell\v1.0\curl.exe", [StringComparison]::OrdinalIgnoreCase)) {
      $curlCmd = "curl"
    }
  }
  if (-not $curlCmd) {
    Err "error: curl is required for -FromRelease"
    exit 1
  }

  $script:CleanupDir = Join-Path $env:TEMP "loom-install-$([Guid]::NewGuid())"
  New-Item -ItemType Directory -Path $CleanupDir -Force | Out-Null
  $script:Cleanup = $true

  $tarball = Join-Path $CleanupDir "loom.tar.gz"
  Say "  downloading loom v$Version from $Repo..."
  & $curlCmd -fsSL "https://github.com/$Repo/archive/refs/tags/v$Version.tar.gz" -o $tarball 2>$null
  if ($LASTEXITCODE -ne 0) {
    Err "error: download failed"
    exit 1
  }

  Note "  extracting..."
  if (Get-Command "tar.exe" -ErrorAction SilentlyContinue) {
    & tar.exe xzf $tarball -C $CleanupDir
  } elseif (Get-Command "tar" -ErrorAction SilentlyContinue) {
    & tar xzf $tarball -C $CleanupDir
  } else {
    Err "error: tar is required for extraction"
    exit 1
  }
  if ($LASTEXITCODE -ne 0) {
    Err "error: extraction failed"
    exit 1
  }

  $extracted = Get-ChildItem -Path $CleanupDir -Directory | Select-Object -First 1
  if (-not $extracted -or -not (Test-Path (Join-Path $extracted.FullName "bin\loom.js"))) {
    Err "error: download appears incomplete — bin\loom.js not found"
    exit 1
  }

  Note "  installing dependencies..."
  Push-Location $extracted.FullName
  try {
    & npm install --production 2>$null
    if ($LASTEXITCODE -ne 0) { Warn "  warning: npm install failed, some features may not work" }
  } finally { Pop-Location }

  $script:LoomCli = Join-Path $extracted.FullName "bin\loom.js"
}

# ── Cleanup ─────────────────────────────────────────────────────────────
function Cleanup-Temp {
  if ($Cleanup -and $CleanupDir -and (Test-Path $CleanupDir)) {
    Remove-Item -Path $CleanupDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# ── Check Node.js ───────────────────────────────────────────────────────
function Check-Node {
  $node = Get-Command "node" -ErrorAction SilentlyContinue
  if (-not $node) {
    Err "error: Node.js is required (https://nodejs.org)"
    Err "  Install Node.js >= 22 and re-run"
    exit 1
  }
  $ver = & node -v
  $major = [int]($ver -replace 'v', '' -replace '\..*', '')
  if ($major -lt 22) {
    Err "error: Node.js >= 22 required (found: $ver)"
    exit 1
  }
}
