<#!
.SYNOPSIS
  Give the Entra External ID sign-in pages the website's look (company branding). Safe to run again.

.DESCRIPTION
  - Page background color, header off, footer on with our own "Privacy" and "Community rules" links.
  - Help text under the sign-in form, and the hint in the email box.
  - Hides the password-reset links (visitors sign in with an email code; there are no passwords).
  - Uploads the banner logo, square logos, favicon and custom CSS from this folder
    (rebuild the images with: node infra/external-id-branding/make-images.mjs).
  Two things can only be changed in the Entra admin center: page titles and labels such as "Enter code"
  (Company branding -> Text), and the tenant name shown on the pages and as the code email's sender
  (Tenant properties -> Name; Graph does not allow changing it).

  Runs as the tenant's admin through the Azure CLI, like configure-external-id.ps1.

.EXAMPLE
  ./infra/external-id-branding/apply-branding.ps1
#>
param(
  [string]$TenantId = 'a72c253f-3125-4592-b3c6-b8e23ed18054',
  [string]$AdminSubscription = 'fd38bfe4-1b60-405d-bff9-020f3ff54d88',
  [string]$SiteUrl = 'https://longisland.dance'
)
$ErrorActionPreference = 'Stop'

$previous = az account show --query id -o tsv
az account set --subscription $AdminSubscription
try {
  $token = az account get-access-token --tenant $TenantId --resource-type ms-graph --query accessToken -o tsv
} finally {
  az account set --subscription $previous
}
if (-not $token) { throw 'Could not get a Microsoft Graph token for the external tenant.' }
$auth = @{ Authorization = "Bearer $token" }
$graph = 'https://graph.microsoft.com/v1.0'
$branding = "$graph/organization/$TenantId/branding"
$site = $SiteUrl.TrimEnd('/')

# 1. Colors, layout, links and text (the default branding, locale "0")
$settings = @{
  backgroundColor = '#0b0b0d'
  signInPageText = "Free. We email you a one-time code, so there is no password to remember. [Community rules]($site/community-rules/) · [What we keep about you]($site/privacy/#accounts)"
  usernameHintText = 'Your email address'
  customPrivacyAndCookiesText = 'Privacy'
  customPrivacyAndCookiesUrl = "$site/privacy/"
  customTermsOfUseText = 'Community rules'
  customTermsOfUseUrl = "$site/community-rules/"
  loginPageLayoutConfiguration = @{ layoutTemplateType = 'default'; isHeaderShown = $false; isFooterShown = $true }
  loginPageTextVisibilitySettings = @{
    hideCannotAccessYourAccount = $true
    hideForgotMyPassword = $true
    hideResetItNow = $true
    hideAccountResetCredentials = $true
    hideTermsOfUse = $false
    hidePrivacyAndCookies = $false
  }
}
$body = $settings | ConvertTo-Json -Depth 5
try {
  Invoke-RestMethod -Method PATCH -Uri $branding -Headers ($auth + @{ 'Accept-Language' = '0' }) -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
  Write-Host 'Updated the default branding.'
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
  # No branding yet: creating a first (empty) localization also creates the default branding.
  Invoke-RestMethod -Method POST -Uri "$branding/localizations" -Headers $auth -ContentType 'application/json' -Body (@{ id = 'en-US'; backgroundColor = $settings.backgroundColor } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Method PATCH -Uri $branding -Headers ($auth + @{ 'Accept-Language' = '0' }) -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
  Write-Host 'Created the default branding.'
}

# 2. Images and CSS
$files = [ordered]@{
  bannerLogo = 'banner-logo.png'
  squareLogo = 'square-logo.png'
  squareLogoDark = 'square-logo.png'
  favicon = 'favicon.png'
  customCSS = 'branding.css'
}
foreach ($f in $files.GetEnumerator()) {
  $type = if ($f.Value -like '*.css') { 'text/css' } else { 'image/png' }
  Invoke-RestMethod -Method PUT -Uri "$branding/localizations/0/$($f.Key)" -Headers $auth -ContentType $type -InFile (Join-Path $PSScriptRoot $f.Value) | Out-Null
  Write-Host "Uploaded $($f.Key) ($($f.Value))"
}

Remove-Variable token, auth
