$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env"

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Missing $envPath"
}

$first = Read-Host "Enter test vault password (at least 16 characters)" -AsSecureString
$second = Read-Host "Enter it again" -AsSecureString
$firstText = [System.Net.NetworkCredential]::new("", $first).Password
$secondText = [System.Net.NetworkCredential]::new("", $second).Password

try {
  if ($firstText.Length -lt 16) { throw "Password must contain at least 16 characters." }
  if ($firstText -cne $secondText) { throw "Passwords do not match." }
  if ($firstText -match "[`r`n#]") { throw "For .env safety, do not use # or line breaks." }

  $lines = Get-Content -LiteralPath $envPath | Where-Object { $_ -notmatch '^WALLET_VAULT_PASSWORD=' }
  Set-Content -LiteralPath $envPath -Value @($lines; "WALLET_VAULT_PASSWORD=$firstText") -Encoding UTF8
  Write-Host "`nConfigured successfully. REAL_EXECUTION_ENABLED remains false." -ForegroundColor Green
} finally {
  $firstText = $null
  $secondText = $null
  $first.Dispose()
  $second.Dispose()
}

Read-Host "Press Enter to close"
