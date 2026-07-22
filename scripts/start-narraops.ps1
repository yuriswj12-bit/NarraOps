$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$apiUrl = "http://127.0.0.1:5190/api/v1/health"
$apiDir = Join-Path $root "backend\api"
$logDir = Join-Path $root "logs"
$apiOut = Join-Path $logDir "api-5190.out.log"
$apiErr = Join-Path $logDir "api-5190.err.log"

if (!(Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

function Test-ApiReady {
  try {
    $response = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 2
    return $response.ok -eq $true
  } catch {
    return $false
  }
}

if (!(Test-ApiReady)) {
  Write-Host "Starting NarraOps API on 127.0.0.1:5190..."
  Start-Process -FilePath "node" `
    -ArgumentList @("--import", "tsx", "--env-file-if-exists=../../.env", "src/server.ts") `
    -WorkingDirectory $apiDir `
    -RedirectStandardOutput $apiOut `
    -RedirectStandardError $apiErr

  $ready = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-ApiReady) {
      $ready = $true
      break
    }
  }

  if (!$ready) {
    Write-Host "NarraOps API failed to start. Last API error log:"
    if (Test-Path $apiErr) {
      Get-Content $apiErr -Tail 40
    }
    exit 1
  }
}

Write-Host "NarraOps API ready: $apiUrl"
Write-Host "Starting NarraOps frontend on 127.0.0.1:5188..."
Set-Location $root
node server.js
