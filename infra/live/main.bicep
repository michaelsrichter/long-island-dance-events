// The live site's database and server (docs/proposals/postgres-live-site.md; decisions P56, P57 and P58).
//
//   PostgreSQL Flexible Server, Burstable B1ms, 32 GB, 7-day point-in-time restore. Public address, but only
//   Azure services may connect (firewall), only with Microsoft Entra sign-in (no passwords), only encrypted.
//   No private network: the owner chose simplicity for this non-sensitive data (P57).
//   App Service, Linux B1 (one always-on server, P58): one Node program (server/) that makes the pages and
//   answers /api. It signs in to the database with its own managed identity.
//   A managed identity that GitHub Actions (main branch only) uses to deploy the app. No secrets anywhere.
//   Region: Central US, the only US region where this Visual Studio subscription may create PostgreSQL and
//   that also has App Service, Content Safety, Logic Apps and monitoring (P57).
//
// Deploy (about 10 minutes the first time; safe to run again):
//   az deployment group create -g rg-li-dance-events-web --subscription fd38bfe4-1b60-405d-bff9-020f3ff54d88 `
//     --template-file infra/live/main.bicep
targetScope = 'resourceGroup'

@description('Azure region for everything (P57): Central US.')
param location string = 'centralus'

@description('Short name used in resource names.')
param namePrefix string = 'li-dance-events'

@description('Web app name (its test address is https://<name>.azurewebsites.net).')
param appName string = 'app-${namePrefix}'

@description('App Service plan size (P58): B1 = 1 core, 1.75 GB, about $13 a month in Central US.')
@allowed(['B1', 'B2', 'B3'])
param planSku string = 'B1'

@description('PostgreSQL server name (<name>.postgres.database.azure.com).')
param postgresName string = 'psql-li-dance-events'

@description('Existing Application Insights component that also receives the website telemetry.')
param appInsightsName string = 'appi-swa-li-dance-events-web'

@description('PostgreSQL major version.')
param postgresVersion string = '17'

@description('Let search engines list the pages. Stays false until the switch to longisland.dance (phase 2 cutover).')
param allowIndexing bool = false

@description('GitHub repository allowed to deploy (main branch) and to call the sync endpoints.')
param githubRepository string = 'michaelsrichter/long-island-dance-events'

@description('Exact subject of GitHub\'s token for runs on main. This repository uses GitHub\'s format with the account and repository ids (owner@id/repo@id), which stays the same if either is renamed.')
param githubMainSubject string = 'repo:michaelsrichter@1242059/long-island-dance-events@1402631995:ref:refs/heads/main'

@description('Visitor sign-in (P60): Microsoft Entra External ID tenant, its sign-in subdomain and the site\'s app registration (client ids are public).')
param externalIdTenantId string = 'a72c253f-3125-4592-b3c6-b8e23ed18054'
param externalIdSubdomain string = 'longislanddance'
param externalIdClientId string = 'cff01541-5950-479a-a54a-fcc082b86236'

@description('How long a sign-in lasts (the owner chose 14 days for everyone, P54).')
param signInDays int = 14

@description('Key Vault for the secrets that come from outside Azure (sign-in, email, GitHub). Values go in with infra/live/copy-secrets.ps1.')
param keyVaultName string = 'kv-${namePrefix}'

@description('Object id (not a secret) of the person who may put secrets into the Key Vault (empty: nobody gets that right from this template).')
#disable-next-line secure-secrets-in-params
param secretsAdminObjectId string = ''

@description('Existing community resources the /api code uses (P60): storage for likes, notes and photos; AI Content Safety; the Logic App for owner emails.')
param communityStorageName string = 'stlongislanddance'
param contentSafetyName string = 'cs-longislanddance'
param notifyLogicAppName string = 'logic-li-dance-notify'

@description('Web addresses that may send requests and sign-in returns to the site.')
param siteHosts array = ['longisland.dance', 'www.longisland.dance', 'new.longisland.dance', 'app-li-dance-events.azurewebsites.net']

param tags object = {
  project: 'long-island-dance-events'
  phase: 'live-site'
}

var databaseName = 'lidance'
var signInBase = 'https://${externalIdSubdomain}.ciamlogin.com/${externalIdTenantId}'
func secret(vaultName string, name string) string => '@Microsoft.KeyVault(VaultName=${vaultName};SecretName=${name})'
var roles = {
  keyVaultSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  keyVaultSecretsOfficer: 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
  websiteContributor: 'de139f84-1756-47ae-9be6-808fbbe84772'
}

// ---------- PostgreSQL ----------

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresName
  location: location
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: postgresVersion
    storage: { storageSizeGB: 32, autoGrow: 'Disabled' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: subscription().tenantId
    }
    // Azure's monthly updates: Tuesday 08:00 UTC (3 AM in Iowa in summer, 2 AM in winter).
    maintenanceWindow: { customWindow: 'Enabled', dayOfWeek: 2, startHour: 8, startMinute: 0 }
  }
}

// Only Azure services (such as the app) may reach the server; nobody on the internet. Changes to one server
// must not run at the same time, so each waits for the one before.
resource azureOnly 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: databaseName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
  dependsOn: [azureOnly]
}

resource extensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'azure.extensions'
  properties: { value: 'PG_TRGM', source: 'user-override' }
  dependsOn: [database]
}

// ---------- Web app (App Service, P58) ----------

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-${namePrefix}'
  location: location
  tags: tags
  kind: 'linux'
  sku: { name: planSku, tier: 'Basic', capacity: 1 }
  properties: { reserved: true }
}

resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: appName
  location: location
  tags: tags
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    // No "ARRAffinity" cookie: every visitor gets the same pages, and pages stay cacheable.
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'node src/main.js'
      alwaysOn: true
      healthCheckPath: '/api/live'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      appSettings: [
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'NODE_ENV', value: 'production' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'ApplicationInsightsAgent_EXTENSION_VERSION', value: '~3' }
        { name: 'PGHOST', value: '${postgresName}.postgres.database.azure.com' }
        { name: 'PGDATABASE', value: databaseName }
        { name: 'PGUSER', value: appName }
        { name: 'OIDC_AUDIENCE', value: 'li-dance-server' }
        { name: 'OIDC_REPOSITORY', value: githubRepository }
        { name: 'OIDC_ALLOWED_WORKFLOWS', value: '${githubRepository}/.github/workflows/database-sync.yml' }
        { name: 'DRILL_SERVER_PREFIX', value: postgresName }
        // The pages' own address (links, share pictures, sitemaps), whatever name the server is reached by.
        { name: 'SITE_URL', value: 'https://longisland.dance' }
        { name: 'CANONICAL_HOST', value: 'longisland.dance' }
        { name: 'ALLOW_INDEXING', value: allowIndexing ? 'true' : 'false' }
        // Resized photos are kept here between restarts and deploys (App Service keeps /home).
        { name: 'IMAGE_CACHE_DIR', value: '/home/data/image-cache' }
        // ---- the community /api code (P60): the same settings as on Static Web Apps ----
        { name: 'ALLOWED_HOSTS', value: join(siteHosts, ',') }
        { name: 'COMMUNITY_STORAGE', value: 'DefaultEndpointsProtocol=https;AccountName=${community.name};AccountKey=${community.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}' }
        { name: 'CONTENT_SAFETY_ENDPOINT', value: contentSafety.properties.endpoint }
        { name: 'CONTENT_SAFETY_KEY', value: contentSafety.listKeys().key1 }
        { name: 'ADMIN_NOTIFY_URL', value: listCallbackUrl(resourceId('Microsoft.Logic/workflows/triggers', notifyLogicAppName, 'manual'), '2019-05-01').value }
        { name: 'EXTID_CLIENT_ID', value: externalIdClientId }
        { name: 'EXTID_CLIENT_SECRET', value: secret(keyVaultName, 'extid-client-secret') }
        { name: 'ADMIN_EMAILS', value: secret(keyVaultName, 'admin-emails') }
        { name: 'AGENTMAIL_API_KEY', value: secret(keyVaultName, 'agentmail-api-key') }
        { name: 'AGENTMAIL_INBOX', value: secret(keyVaultName, 'agentmail-inbox') }
        { name: 'GITHUB_OAUTH_CLIENT_ID', value: secret(keyVaultName, 'github-oauth-client-id') }
        { name: 'GITHUB_OAUTH_CLIENT_SECRET', value: secret(keyVaultName, 'github-oauth-client-secret') }
        { name: 'REVIEW_SECRET_KEY', value: secret(keyVaultName, 'review-secret-key') }
      ]
    }
  }
}

// ---------- Sign-in (P60): App Service's built-in sign-in with External ID, as on Static Web Apps ----------

resource auth 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: app
  name: 'authsettingsV2'
  properties: {
    platform: { enabled: true, runtimeVersion: '~1' }
    // Everyone may visit; pages and /api decide what needs a sign-in (server/src/app.js).
    // The server's own machine addresses never go through sign-in (the sync checks GitHub's token itself).
    globalValidation: { requireAuthentication: false, unauthenticatedClientAction: 'AllowAnonymous', excludedPaths: ['/api/live', '/api/health', '/api/sync/*'] }
    httpSettings: { requireHttps: true, forwardProxy: { convention: 'NoProxy' } }
    login: {
      tokenStore: { enabled: false }
      allowedExternalRedirectUrls: [for h in siteHosts: 'https://${h}']
      cookieExpiration: { convention: 'FixedTime', timeToExpiration: '${signInDays}.00:00:00' }
      nonce: { validateNonce: true, nonceExpirationInterval: '00:05:00' }
      preserveUrlFragmentsForLogins: false
    }
    identityProviders: {
      // The same provider name, endpoints and claims as staticwebapp.config.json, so sign-in addresses stay the same.
      customOpenIdConnectProviders: {
        extid: {
          enabled: true
          registration: {
            clientId: externalIdClientId
            clientCredential: { clientSecretSettingName: 'EXTID_CLIENT_SECRET' }
            openIdConnectConfiguration: {
              authorizationEndpoint: '${signInBase}/oauth2/v2.0/authorize'
              tokenEndpoint: '${signInBase}/oauth2/v2.0/token'
              issuer: 'https://${externalIdTenantId}.ciamlogin.com/${externalIdTenantId}/v2.0'
              certificationUri: '${signInBase}/discovery/v2.0/keys'
            }
          }
          login: { nameClaimType: 'name', scopes: ['openid', 'profile', 'email'] }
        }
      }
    }
  }
}

// ---------- Community resources (existing, P60) and the Key Vault for outside secrets ----------

resource community 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: communityStorageName
}

resource contentSafety 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: contentSafetyName
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

resource appReadsSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, app.id, roles.keyVaultSecretsUser)
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsUser)
  }
}

resource adminWritesSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(secretsAdminObjectId)) {
  scope: vault
  name: guid(vault.id, secretsAdminObjectId, roles.keyVaultSecretsOfficer)
  properties: {
    principalId: secretsAdminObjectId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsOfficer)
  }
}

resource appLogs 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: app
  name: 'logs'
  properties: {
    applicationLogs: { fileSystem: { level: 'Information' } }
    httpLogs: { fileSystem: { enabled: true, retentionInDays: 3, retentionInMb: 35 } }
    detailedErrorMessages: { enabled: false }
    failedRequestsTracing: { enabled: false }
  }
}

// The app is the database's administrator (it applies the design changes in server/migrations/).
module postgresAdmin 'postgres-admin.bicep' = {
  name: 'postgres-admin-${appName}'
  params: {
    postgresName: postgres.name
    principalId: app.identity.principalId
    principalName: app.name
  }
  dependsOn: [extensions]
}

// ---------- GitHub Actions deploys the app (main branch only, no secret) ----------

resource deployIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-github-deploy-${namePrefix}'
  location: location
  tags: tags
}

resource deployFederation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: deployIdentity
  name: 'github-main'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: githubMainSubject
    audiences: ['api://AzureADTokenExchange']
  }
}

resource deployRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: app
  name: guid(app.id, deployIdentity.id, roles.websiteContributor)
  properties: {
    principalId: deployIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.websiteContributor)
  }
}

output keyVaultName string = vault.name
output appName string = app.name
output appUrl string = 'https://${app.properties.defaultHostName}'
output postgresHost string = '${postgresName}.postgres.database.azure.com'
output deployClientId string = deployIdentity.properties.clientId
output tenantId string = subscription().tenantId
output subscriptionId string = subscription().subscriptionId