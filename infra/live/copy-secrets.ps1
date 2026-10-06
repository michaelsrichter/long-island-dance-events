<#!
.SYNOPSIS
  Copy the live server's outside secrets from the Static Web App's settings into the Key Vault (decision P60).

.DESCRIPTION
  The App Service app reads these settings from Key Vault references (infra/live/main.bicep), so redeploying the
  template never loses them. This copies the current values from the Static Web App (where they were set by
  infra/deploy.ps1 and infra/configure-external-id.ps1) without printing them, then restarts the app so it
  reads them. Safe to run again. Your account needs "Key Vault Secrets Officer" on the vault (the template
  gives it to -secretsAdminObjectId).

.EXAMPLE
  ./infra/live/copy-secrets.ps1
#>
param(
  [string]$Subscription = 'fd38bfe4-1b60-405d-bff9-020f3ff54d88',
  [string]$ResourceGroup = 'rg-li-dance-events-web',
  [string]$StaticWebAppName = 'swa-li-dance-events-web',
  [string]$KeyVaultName = 'kv-li-dance-events',
  [string]$AppName = 'app-li-dance-events'
)
$ErrorActionPreference = 'Stop'

# Static Web App setting -> Key Vault secret name (the names main.bicep refers to).
$map = [ordered]@{
  EXTID_CLIENT_SECRET        = 'extid-client-secret'
  ADMIN_EMAILS               = 'admin-emails'
  AGENTMAIL_API_KEY          = 'agentmail-api-key'
  AGENTMAIL_INBOX            = 'agentmail-inbox'
  GITHUB_OAUTH_CLIENT_ID     = 'github-oauth-client-id'
  GITHUB_OAUTH_CLIENT_SECRET = 'github-oauth-client-secret'
  REVIEW_SECRET_KEY          = 'review-secret-key'
}

$settings = (az staticwebapp appsettings list -n $StaticWebAppName -g $ResourceGroup --subscription $Subscription -o json | ConvertFrom-Json).properties
$tmp = New-TemporaryFile
try {
  foreach ($name in $map.Keys) {
    $value = [string]$settings.$name
    if (-not $value) { Write-Warning "$name is not set on the Static Web App; skipped"; continue }
    # Through a file, so the value never appears on a command line.
    [IO.File]::WriteAllText($tmp.FullName, $value, (New-Object Text.UTF8Encoding $false))
    az keyvault secret set --vault-name $KeyVaultName --subscription $Subscription --name $map[$name] --file $tmp.FullName --encoding utf-8 --only-show-errors -o none
    if ($LASTEXITCODE -ne 0) { throw "Could not store $name" }
    Write-Host "stored $name -> $($map[$name]) ($($value.Length) characters)"
  }
} finally {
  Remove-Item $tmp.FullName -Force
}
# App Service remembers a missing secret for a day; ask it to read the references again, then restart.
$refs = "https://management.azure.com/subscriptions/$Subscription/resourceGroups/$ResourceGroup/providers/Microsoft.Web/sites/$AppName/config/configreferences/appsettings"
az rest --method post --url "$refs/refresh?api-version=2023-12-01" -o none
az webapp restart -g $ResourceGroup -n $AppName --subscription $Subscription -o none
Start-Sleep 20
(az rest --method get --url "$($refs)?api-version=2023-12-01" -o json | ConvertFrom-Json).value | ForEach-Object { Write-Host ("{0,-28} {1}" -f $_.name, $_.properties.status) }
Write-Host "Restarted $AppName so it reads the new values (all should say Resolved)."
