<#
.SYNOPSIS
  Runs Fount's font-grabber and fetches its portable binary on first use.

.DESCRIPTION
  Nothing is installed. The release build for this machine is downloaded once
  from GitHub Releases into a per-user cache, checked against the release's
  SHA256SUMS.txt and run from there: no admin rights, no PATH changes, no
  package manager. A newer release is picked up at most once a day.

  Every argument is passed to font-grabber unchanged.

  Environment:
    FOUNT_BIN      run this font-grabber binary instead of downloading one
    FOUNT_VERSION  a release tag such as v3.2.0 instead of the latest release
    FOUNT_CACHE    cache folder (default: %LOCALAPPDATA%\fount)
    CHROME         the Chrome, Chromium or Edge used for dynamic discovery

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File fount.ps1 grab https://example.com
#>

$Repo = 'Piwqust/font-grabber'
$Asset = 'font-grabber-windows-x64.zip'
$ExeName = 'font-grabber.exe'
$CheckEvery = [TimeSpan]::FromHours(24)

$ProgressPreference = 'SilentlyContinue'
# Family names can be in any script; keep the binary's UTF-8 output intact.
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

function Write-Note([string]$Message) {
    [Console]::Error.WriteLine("fount: $Message")
}

if (-not ($null -eq $IsWindows -or $IsWindows)) {
    # PowerShell 7 on macOS or Linux: the shell launcher handles those builds.
    & sh (Join-Path $PSScriptRoot 'fount.sh') @args
    exit $LASTEXITCODE
}

function Get-Download([string]$Url, [string]$Path) {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing -TimeoutSec 120 `
        -Headers @{ 'User-Agent' = 'fount-skill' }
}

function Get-ExpectedHash([string]$SumsPath) {
    foreach ($line in Get-Content -LiteralPath $SumsPath) {
        if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$' -and $Matches[2] -eq $Asset) {
            return $Matches[1].ToLowerInvariant()
        }
    }
    return $null
}

function Find-Binary([string]$Folder) {
    if (-not (Test-Path -LiteralPath $Folder)) { return $null }
    $found = Get-ChildItem -LiteralPath $Folder -Recurse -Filter $ExeName -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

function Find-NewestCached([string]$Cache) {
    if (-not (Test-Path -LiteralPath $Cache)) { return $null }
    $found = Get-ChildItem -LiteralPath $Cache -Recurse -Filter $ExeName -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\\.download-' } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

function Install-Release([string]$Cache, [string]$Base) {
    $work = Join-Path $Cache ('.download-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    try {
        $sums = Join-Path $work 'SHA256SUMS.txt'
        Get-Download "$Base/SHA256SUMS.txt" $sums
        $expected = Get-ExpectedHash $sums
        if (-not $expected) { throw "The release has no $Asset." }

        $target = Join-Path $Cache $expected.Substring(0, 16)
        $existing = Find-Binary $target
        if ($existing) { return $existing }

        Write-Note "downloading Fount ($Asset) from github.com/$Repo ..."
        $zip = Join-Path $work $Asset
        Get-Download "$Base/$Asset" $zip
        $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) {
            throw "Checksum mismatch for $Asset (expected $expected, got $actual). Nothing was run."
        }
        $unpacked = Join-Path $work 'unpacked'
        Expand-Archive -LiteralPath $zip -DestinationPath $unpacked -Force
        if (-not (Find-Binary $unpacked)) { throw "$Asset does not contain $ExeName." }
        try {
            Move-Item -LiteralPath $unpacked -Destination $target -ErrorAction Stop
        } catch {
            # Another run finished first; use its copy.
            if (-not (Find-Binary $target)) { throw }
        }
        Write-Note "cached in $target"
        return (Find-Binary $target)
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Resolve-Binary {
    if ($env:FOUNT_BIN) {
        if (-not (Test-Path -LiteralPath $env:FOUNT_BIN)) { throw "FOUNT_BIN does not exist: $env:FOUNT_BIN" }
        return $env:FOUNT_BIN
    }

    $cache = $env:FOUNT_CACHE
    if (-not $cache) {
        $root = $env:LOCALAPPDATA
        if (-not $root) { $root = [IO.Path]::GetTempPath() }
        $cache = Join-Path $root 'fount'
    }
    New-Item -ItemType Directory -Force -Path $cache | Out-Null

    if ($env:FOUNT_VERSION) {
        $tag = $env:FOUNT_VERSION
        if ($tag -notmatch '^v') { $tag = "v$tag" }
        return (Install-Release $cache "https://github.com/$Repo/releases/download/$tag")
    }

    # Use the cached latest build for a day before asking GitHub again.
    $stamp = Join-Path $cache 'latest.txt'
    if (Test-Path -LiteralPath $stamp) {
        $age = (Get-Date) - (Get-Item -LiteralPath $stamp).LastWriteTime
        $remembered = (Get-Content -LiteralPath $stamp -TotalCount 1)
        if ($age -lt $CheckEvery -and $remembered -and (Test-Path -LiteralPath $remembered)) {
            return $remembered
        }
    }
    try {
        $binary = Install-Release $cache "https://github.com/$Repo/releases/latest/download"
        [IO.File]::WriteAllText($stamp, $binary)
        return $binary
    } catch {
        $fallback = Find-NewestCached $cache
        if ($fallback) {
            Write-Note "could not check for a newer release ($($_.Exception.Message)); using $fallback"
            return $fallback
        }
        throw
    }
}

try {
    $binary = Resolve-Binary
} catch {
    Write-Note "could not get the font-grabber binary: $($_.Exception.Message)"
    Write-Note "check the connection to github.com, or set FOUNT_BIN to an existing font-grabber.exe"
    exit 3
}

& $binary @args
exit $LASTEXITCODE
