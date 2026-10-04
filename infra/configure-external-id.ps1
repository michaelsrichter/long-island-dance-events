<#!
.SYNOPSIS
  Configure the Entra External ID tenant used for visitor sign-in (safe to run again).

.DESCRIPTION
  1. App registration "Long Island Dance website" (web app, redirect https://<site>/.auth/login/extid/callback,
     ID tokens with the optional "email" claim, admin consent for openid/profile/email/offline_access).
  2. Sign-up and sign-in user flow with email one-time passcode, collecting a display name.
  3. Links the app to the user flow.
  4. With -NewSecret: creates a client secret and stores it (and the client id) in the Static Web App's
     app settings without printing it.

  Runs as the tenant's admin through the Azure CLI. Use an account that can manage the external tenant
  (the account that created it). Pass -AdminSubscription so the CLI uses that account's sign-in.

.EXAMPLE
  ./infra/configure-external-id.ps1 -NewSecret
#>
param(
  [string]$TenantId = 'a72c253f-3125-4592-b3c6-b8e23ed18054',
  [string]$TenantSubdomain = 'longislanddance',
  [string]$AdminSubscription = 'fd38bfe4-1b60-405d-bff9-020f3ff54d88',
  [string]$SiteUrl = 'https://longisland.dance',
  # Extra site addresses that may also sign in (for example the azurestaticapps.net address before a domain move).
  [string[]]$ExtraSiteUrls = @('https://gentle-glacier-01b92ea0f.3.azurestaticapps.net'),
  [string]$AppName = 'Long Island Dance website',
  [string]$FlowName = 'Long Island Dance sign-up and sign-in',
  [string]$StaticWebAppName = 'swa-li-dance-events-web',
  [string]$StaticWebAppResourceGroup = 'rg-li-dance-events-web',
  [string]$StaticWebAppSubscription = 'fd38bfe4-1b60-405d-bff9-020f3ff54d88',
  [switch]$NewSecret
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
$headers = @{ Authorization = "Bearer $token" }
$graph = 'https://graph.microsoft.com/v1.0'
function G([string]$Method, [string]$Path, $Body) {
  $req = @{ Method = $Method; Uri = "$graph$Path"; Headers = $headers; ContentType = 'application/json' }
  if ($null -ne $Body) { $req.Body = ($Body | ConvertTo-Json -Depth 20) }
  Invoke-RestMethod @req
}

$graphAppId = '00000003-0000-0000-c000-000000000000'
# Well-known, public Microsoft Graph delegated permission ids (the same in every tenant).
$scopes = [ordered]@{
  openid = '37f7f235-527c-4136-accd-4a02d197296e' # gitleaks:allow (public Microsoft Graph permission id)
  offline_access = '7427e0e9-2fba-42fe-b0c0-848c9e6a8182' # gitleaks:allow (public Microsoft Graph permission id)
  profile = '14dad69e-099b-42c9-810b-d002981feec1' # gitleaks:allow (public Microsoft Graph permission id)
  email = '64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0' # gitleaks:allow (public Microsoft Graph permission id)
}
$callback = "$($SiteUrl.TrimEnd('/'))/.auth/login/extid/callback"

# 1. App registration
$appBody = @{
  displayName = $AppName
  signInAudience = 'AzureADMyOrg'
  web = @{
    homePageUrl = $SiteUrl
    redirectUris = @(@($callback) + @($ExtraSiteUrls | Where-Object { $_ } | ForEach-Object { "$($_.TrimEnd('/'))/.auth/login/extid/callback" }))
    logoutUrl = "$($SiteUrl.TrimEnd('/'))/.auth/logout/extid/callback"
    implicitGrantSettings = @{ enableIdTokenIssuance = $true; enableAccessTokenIssuance = $false }
  }
  info = @{ privacyStatementUrl = "$($SiteUrl.TrimEnd('/'))/privacy/"; termsOfServiceUrl = "$($SiteUrl.TrimEnd('/'))/community-rules/" }
  optionalClaims = @{ idToken = @(@{ name = 'email'; essential = $false }) }
  requiredResourceAccess = @(@{ resourceAppId = $graphAppId; resourceAccess = @($scopes.Values | ForEach-Object { @{ id = $_; type = 'Scope' } }) })
}
$app = (G GET "/applications?`$filter=displayName eq '$([uri]::EscapeDataString($AppName))'").value | Select-Object -First 1
if ($app) { G PATCH "/applications/$($app.id)" $appBody | Out-Null; Write-Host "Updated app registration $($app.appId)" }
else { $app = G POST '/applications' $appBody; Write-Host "Created app registration $($app.appId)" }

# Service principals and admin consent
$sp = (G GET "/servicePrincipals?`$filter=appId eq '$($app.appId)'").value | Select-Object -First 1
if (-not $sp) { $sp = G POST '/servicePrincipals' @{ appId = $app.appId } }
$graphSp = (G GET "/servicePrincipals?`$filter=appId eq '$graphAppId'").value | Select-Object -First 1
$scopeText = ($scopes.Keys -join ' ')
$grant = (G GET "/oauth2PermissionGrants?`$filter=clientId eq '$($sp.id)' and resourceId eq '$($graphSp.id)'").value | Select-Object -First 1
if ($grant) { G PATCH "/oauth2PermissionGrants/$($grant.id)" @{ scope = $scopeText } | Out-Null }
else { G POST '/oauth2PermissionGrants' @{ clientId = $sp.id; consentType = 'AllPrincipals'; resourceId = $graphSp.id; scope = $scopeText } | Out-Null }
Write-Host "Admin consent: $scopeText"

# 2. User flow: email one-time passcode, collect display name
$flow = (G GET '/identity/authenticationEventsFlows').value | Where-Object { $_.displayName -eq $FlowName } | Select-Object -First 1
if (-not $flow) {
  $flow = G POST '/identity/authenticationEventsFlows' @{
    '@odata.type' = '#microsoft.graph.externalUsersSelfServiceSignUpEventsFlow'
    displayName = $FlowName
    onAuthenticationMethodLoadStart = @{
      '@odata.type' = '#microsoft.graph.onAuthenticationMethodLoadStartExternalUsersSelfServiceSignUp'
      identityProviders = @(@{ id = 'EmailOtpSignup-OAUTH' })
    }
    onInteractiveAuthFlowStart = @{
      '@odata.type' = '#microsoft.graph.onInteractiveAuthFlowStartExternalUsersSelfServiceSignUp'
      isSignUpAllowed = $true
    }
    onAttributeCollection = @{
      '@odata.type' = '#microsoft.graph.onAttributeCollectionExternalUsersSelfServiceSignUp'
      attributes = @(
        @{ id = 'email'; displayName = 'Email Address'; description = 'Email address of the user'; userFlowAttributeType = 'builtIn'; dataType = 'string' },
        @{ id = 'displayName'; displayName = 'Display Name'; description = 'Name shown next to your posts'; userFlowAttributeType = 'builtIn'; dataType = 'string' }
      )
      attributeCollectionPage = @{
        views = @(@{
            inputs = @(
              @{ attribute = 'email'; label = 'Email address'; inputType = 'text'; hidden = $true; editable = $false; writeToDirectory = $true; required = $true; validationRegEx = '^[^@\s]+@[^@\s]+\.[^@\s]+$' },
              @{ attribute = 'displayName'; label = 'Name to show next to your posts'; inputType = 'text'; hidden = $false; editable = $true; writeToDirectory = $true; required = $true; validationRegEx = "^[A-Za-z0-9 .'_-]{2,40}$" }
            )
          })
      }
    }
  }
  Write-Host "Created user flow $($flow.id)"
} else { Write-Host "User flow exists $($flow.id)" }

# 3. Link the app to the flow
$linked = (G GET "/identity/authenticationEventsFlows/$($flow.id)/conditions/applications/includeApplications").value | Where-Object { $_.appId -eq $app.appId }
if (-not $linked) {
  G POST "/identity/authenticationEventsFlows/$($flow.id)/conditions/applications/includeApplications" @{ '@odata.type' = '#microsoft.graph.authenticationConditionApplication'; appId = $app.appId } | Out-Null
  Write-Host 'Linked app to user flow'
}

# 4. Client secret -> Static Web App settings (never printed)
if ($NewSecret) {
  $pw = G POST "/applications/$($app.id)/addPassword" @{ passwordCredential = @{ displayName = 'swa-extid'; endDateTime = (Get-Date).ToUniversalTime().AddMonths(24).ToString('o') } }
  az staticwebapp appsettings set --subscription $StaticWebAppSubscription -n $StaticWebAppName -g $StaticWebAppResourceGroup --setting-names "EXTID_CLIENT_ID=$($app.appId)" "EXTID_CLIENT_SECRET=$($pw.secretText)" --output none
  Write-Host "Stored EXTID_CLIENT_ID and a new EXTID_CLIENT_SECRET (expires $($pw.endDateTime)) in $StaticWebAppName app settings."
  Remove-Variable pw
}



[pscustomobject]@{
  tenantId = $TenantId
  clientId = $app.appId
  wellKnown = "https://$TenantSubdomain.ciamlogin.com/$TenantId/v2.0/.well-known/openid-configuration"
  callback = $callback
  userFlow = $flow.id
}
