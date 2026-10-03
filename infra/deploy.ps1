<#!
.SYNOPSIS
  Provision an Azure Static Web App for this starter.

.EXAMPLE
  ./infra/deploy.ps1 -Name riverbend -Repo owner/repo -CustomDomain www.example.org
#>
param(
  [string]$Name = 'riverbend',
  [string]$ResourceGroup = '',
  [string]$StaticWebAppName = '',
  [string]$Location = 'eastus2',
  [Parameter(Mandatory)][string]$Repo,
  [string]$CustomDomain = '',
  [string]$OAuthClientId = '',
  [securestring]$OAuthClientSecret
)
$ErrorActionPreference = 'Stop'

$base = $Name.ToLowerInvariant() -replace '[^a-z0-9-]', '-'
if (-not $ResourceGroup) { $ResourceGroup = "rg-$base-web" }
if (-not $StaticWebAppName) { $StaticWebAppName = "swa-$base-web" }
$tags = "project=$base-web", 'template=community-site-starter', 'managedBy=bicep'

az group create --name $ResourceGroup --location $Location --tags $tags --output none
$out = az deployment group create --resource-group $ResourceGroup --name "web-$base-$(Get-Date -Format yyyyMMddHHmmss)" `
  --template-file "$PSScriptRoot/main.bicep" --parameters "$PSScriptRoot/main.bicepparam" --parameters staticWebAppName=$StaticWebAppName location=$Location `
  --query properties.outputs --output json | ConvertFrom-Json
$hostName = $out.defaultHostname.value
Write-Host "Static Web App: https://$hostName"

az staticwebapp secrets list --name $StaticWebAppName --resource-group $ResourceGroup --query properties.apiKey --output tsv |
  gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo $Repo
$siteUrl = if ($CustomDomain) { "https://$CustomDomain" } else { "https://$hostName" }
gh variable set SITE_URL --repo $Repo --body $siteUrl
gh variable set ALLOW_INDEXING --repo $Repo --body ($(if ($CustomDomain) { 'true' } else { 'false' }))

$settings = @("ALLOWED_HOSTS=$hostName$(if ($CustomDomain) { ",$CustomDomain" })")
if ($out.appInsightsName.value) {
  $conn = az monitor app-insights component show --app $out.appInsightsName.value --resource-group $ResourceGroup --query connectionString --output tsv
  $settings += "APPLICATIONINSIGHTS_CONNECTION_STRING=$conn"
}
if ($OAuthClientId -and $OAuthClientSecret) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($OAuthClientSecret)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $settings += "GITHUB_OAUTH_CLIENT_ID=$OAuthClientId", "GITHUB_OAUTH_CLIENT_SECRET=$plain"
}
az staticwebapp appsettings set --name $StaticWebAppName --resource-group $ResourceGroup --setting-names @settings --output none
Write-Host 'App settings updated (values not shown).'
