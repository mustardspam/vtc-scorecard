# Deploys vtc-automation to %LOCALAPPDATA%\vtc-automation\app and installs its packages there.
# The source stays in OneDrive; node_modules, logs, state and archives never go into OneDrive.
# Re-run after changing the source. No admin rights needed.
#   powershell -ExecutionPolicy Bypass -File vtc-automation\scripts\install.ps1
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$home_ = Join-Path $env:LOCALAPPDATA 'vtc-automation'
$app = Join-Path $home_ 'app'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js is not installed. Install Node 20+ (the per-user zip from nodejs.org works without admin).' }
$major = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($major -lt 20) { throw "Node $major is too old; need 20 or later." }

# Keep the source folders on this PC so a run never waits on (or reads a half-synced) OneDrive file.
foreach ($dir in 'vtc-automation', 'src\lib') {
  & attrib.exe +P -U (Join-Path $repo $dir) /S /D | Out-Null
}

foreach ($d in $home_, $app, "$home_\logs", "$home_\archive", "$home_\state") { New-Item -ItemType Directory -Force $d | Out-Null }

# Mirror only what the job needs: vtc-automation and the scorecard's shared import code.
& robocopy.exe (Join-Path $repo 'vtc-automation') (Join-Path $app 'vtc-automation') /MIR /XD node_modules /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying vtc-automation failed (robocopy $LASTEXITCODE)" }
& robocopy.exe (Join-Path $repo 'src\lib') (Join-Path $app 'src\lib') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying src\lib failed (robocopy $LASTEXITCODE)" }
$global:LASTEXITCODE = 0

# One package.json at the app root, so vtc-automation\ and src\lib\ resolve the same node_modules.
Copy-Item (Join-Path $app 'vtc-automation\package.json') (Join-Path $app 'package.json') -Force
Push-Location $app
try {
  & npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed ($LASTEXITCODE)" }
  & npm test
  if ($LASTEXITCODE -ne 0) { throw "Tests failed ($LASTEXITCODE)" }
} finally { Pop-Location }

$job = Join-Path $app 'vtc-automation\jobs\nightly_import.js'
Write-Host ""
Write-Host "Installed to $app" -ForegroundColor Green
Write-Host "Next:"
Write-Host "  1. cd `"$app`"; npm run credentials          (stores secrets in Credential Manager)"
Write-Host "  2. node `"$job`" --dry-run                  (pull + validate, no import)"
Write-Host "  3. powershell -ExecutionPolicy Bypass -File `"$repo\vtc-automation\scripts\register-task.ps1`""
Write-Host "  MCP servers for Claude Code:"
Write-Host "     claude mcp add vtc-erp -- node `"$app\vtc-automation\mcp\erp_mcp_server.js`""
Write-Host "     claude mcp add vtc-hbnext -- node `"$app\vtc-automation\mcp\hbnext_mcp_server.js`""
