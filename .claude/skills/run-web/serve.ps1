<#
.SYNOPSIS
  Start the web app on port 3100 (agents' port), run a command against it, always stop it.
.EXAMPLE
  .claude/skills/run-web/serve.ps1 -DevToday 2026-09-29 -Cmd "node .claude/skills/run-web/shoot.mjs --out $env:TEMP\rest-390.png"
#>
param(
  [ValidateSet('dev', 'prod')][string]$Mode = 'dev',
  [string]$DevToday = '',
  [ValidateSet('', 'empty', 'stale', 'error', 'band')][string]$DevFixture = '',
  [Parameter(Mandatory = $true)][string]$Cmd
)
$ErrorActionPreference = 'Stop'
$Port = 3100
$web = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\web')).Path
$pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
if (-not $pnpm) { $pnpm = Join-Path $env:APPDATA 'npm\pnpm.cmd' }

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "port $Port is already in use; stop that server first (3000 belongs to the user, never touch it)"
}
if ($DevToday) {
  if ($Mode -ne 'dev') { throw 'DEV_TODAY only works in dev mode (next dev)' }
  if ($DevToday -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'DevToday must be YYYY-MM-DD' }
}
if ($DevFixture -and $Mode -ne 'dev') { throw 'DEV_FIXTURE only works in dev mode (next dev)' }

$pnpmArgs = if ($Mode -eq 'dev') { @('dev', '--port', "$Port") } else { @('start', '--port', "$Port") }
$server = $null
try {
  # Set inside try: the finally below always clears them, even if the server fails to start.
  if ($DevToday) { $env:DEV_TODAY = $DevToday }
  if ($DevFixture) { $env:DEV_FIXTURE = $DevFixture }
  $server = Start-Process -FilePath $pnpm -ArgumentList $pnpmArgs -WorkingDirectory $web -PassThru -WindowStyle Hidden
  $ok = $false
  for ($i = 0; $i -lt 120 -and -not $ok; $i++) {
    try { $ok = (Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/" -TimeoutSec 60).StatusCode -eq 200 }
    catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ok) { throw "server on $Port did not answer 200 within about a minute" }
  $note = (@(if ($DevToday) { "DEV_TODAY=$DevToday" }) + @(if ($DevFixture) { "DEV_FIXTURE=$DevFixture" })) -join ' '
  if ($note) { $note = " with $note" }
  Write-Output "web ($Mode) up on http://localhost:$Port$note"
  Invoke-Expression $Cmd
} finally {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  if ($server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item Env:DEV_TODAY -ErrorAction SilentlyContinue
  Remove-Item Env:DEV_FIXTURE -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
  $left = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count
  Write-Output "port $Port listeners left: $left"
}
