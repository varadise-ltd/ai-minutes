param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$tailscalePath = 'C:\Program Files\Tailscale\tailscale.exe'
$dockerPath = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'
if (!(Test-Path -LiteralPath $tailscalePath)) { throw 'Install Tailscale and sign in on this PC and your phone first.' }
if (!(Test-Path -LiteralPath $dockerPath)) { $dockerPath = (Get-Command docker -ErrorAction Stop).Source }
$stateJson = & $tailscalePath status --json
if ($LASTEXITCODE -ne 0) { throw 'Tailscale status failed. Try PowerShell as administrator.' }
$tsState = $stateJson | ConvertFrom-Json
if ($tsState.BackendState -ne 'Running' -or !$tsState.Self.DNSName) { throw 'Sign in to Tailscale on this PC and phone, then rerun this script. No application settings were changed.' }
$dnsName = $tsState.Self.DNSName.TrimEnd('.')
if ($dnsName -notmatch '^[a-zA-Z0-9.-]+\.ts\.net$') { throw 'Tailscale did not return a valid HTTPS hostname.' }
$phoneOrigin = 'https://' + $dnsName + ':8443'
$config = Invoke-RestMethod -Uri 'http://localhost:5000/api/auth/config' -TimeoutSec 10
if ($config.setupRequired) { throw 'Create your company administrator at http://localhost:5000 before enabling phone access.' }
$serveJson = & $tailscalePath serve status --json
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect existing Tailscale services.' }
$serveConfig = $serveJson | ConvertFrom-Json
$portProperty = if ($serveConfig.TCP) { $serveConfig.TCP.PSObject.Properties['8443'] } else { $null }
if ($portProperty) { throw 'Tailscale port 8443 is already configured. Inspect it before changing an existing service.' }
Write-Host ('Private phone URL: ' + $phoneOrigin)
if ($CheckOnly) { Write-Host 'Checks passed. No changes made.'; return }

# Preserve all other installation settings and secrets. Never print the file.
$envPath = Join-Path $projectRoot '.env'
$oldText = [IO.File]::ReadAllText($envPath)
$newText = $oldText
foreach ($setting in @(@('MOBILE_ORIGIN',$phoneOrigin),@('ENABLE_DEMO','false'))) {
  $pattern = '(?m)^' + [regex]::Escape($setting[0]) + '=.*$'
  $line = $setting[0] + '=' + $setting[1]
  if ([regex]::IsMatch($newText,$pattern)) { $newText = [regex]::Replace($newText,$pattern,$line) }
  else { $newText = $newText.TrimEnd() + "`r`n" + $line + "`r`n" }
}
[IO.File]::WriteAllText($envPath,$newText,[Text.UTF8Encoding]::new($false))
Push-Location $projectRoot
try {
  & $dockerPath compose up -d --no-deps app
  if ($LASTEXITCODE -ne 0) { throw 'Docker update failed.' }
  # Private tailnet service only. Never use Funnel or change other services.
  & $tailscalePath serve --bg --https=8443 http://127.0.0.1:5000
  if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve was not enabled. Complete any HTTPS approval in Tailscale and retry.' }
  Write-Host ('Open ' + $phoneOrigin + ' in Safari or Chrome on the connected phone, then sign in to AI Minutes.')
  Write-Host 'If Microsoft sign-in is configured, use local email/password on the phone until its callback URL is configured for your deployment.'
  & $tailscalePath serve status
} catch {
  [IO.File]::WriteAllText($envPath,$oldText,[Text.UTF8Encoding]::new($false))
  & $dockerPath compose up -d --no-deps app
  throw
} finally { Pop-Location }
