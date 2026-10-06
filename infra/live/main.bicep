// The live site's database and server (Phase 1 of docs/proposals/postgres-live-site.md, decision P56).
//
//   PostgreSQL Flexible Server, Burstable B1ms, 32 GB, 7-day point-in-time restore, in a private network
//   (no public address; Microsoft Entra sign-in only, no passwords).
//   An Azure Functions app (Flex Consumption, Node 24) in the same private network, signing in to the
//   database with its own managed identity. Phase 1 runs only the nightly sync and health check;
//   phase 2 adds the pages.
//   A managed identity that GitHub Actions (main branch only) uses to deploy the app. No secrets anywhere.
//   Everything in East US 2 with the rest of the site (owner: one East Coast region).
//
// Deploy (about 15 minutes the first time; safe to run again):
//   az deployment group create -g rg-li-dance-events-web --subscription fd38bfe4-1b60-405d-bff9-020f3ff54d88 `
//     --template-file infra/live/main.bicep
targetScope = 'resourceGroup'

@description('Azure region: the same as the rest of the site, on the East Coast near Long Island (owner\'s requirement). This Visual Studio subscription needs Azure\'s permission ("region access") to create PostgreSQL here; see docs/deployment.md, Live database.')
param location string = 'eastus2'

@description('Create the PostgreSQL server. False until Azure grants region access for PostgreSQL in this region; everything else can be deployed and tested before that.')
param deployDatabase bool = true

@description('Short name used in resource names.')
param namePrefix string = 'li-dance-events'

@description('Function App name (its address is https://<name>.azurewebsites.net).')
param appName string = 'func-li-dance-events'

@description('PostgreSQL server name (<name>.postgres.database.azure.com, reachable only inside the private network).')
param postgresName string = 'psql-li-dance-events'

@description('Storage account for the Function App itself (code packages and host data).')
param storageName string = 'stlidancefunc'

@description('Existing Application Insights component that also receives the website telemetry.')
param appInsightsName string = 'appi-swa-li-dance-events-web'

@description('PostgreSQL major version.')
param postgresVersion string = '17'

@description('Copies of the app kept running even when nobody visits ($5.26 a month each at 512 MB). 0 until phase 2 serves pages.')
@minValue(0)
param alwaysReady int = 0

@description('Most copies that may run at once (each uses up to 5 of the database\'s 35 connections).')
@minValue(1)
param maximumInstanceCount int = 3

@allowed([512, 2048, 4096])
param instanceMemoryMB int = 512

@description('GitHub repository allowed to deploy (main branch) and to call the sync endpoints.')
param githubRepository string = 'michaelsrichter/long-island-dance-events'

param tags object = {
  project: 'long-island-dance-events'
  phase: 'live-database'
}

var databaseName = 'lidance'
var dnsZoneName = '${namePrefix}.private.postgres.database.azure.com'
var roles = {
  storageBlobDataOwner: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  websiteContributor: 'de139f84-1756-47ae-9be6-808fbbe84772'
}

// ---------- Private network ----------

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-${namePrefix}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.70.0.0/16'] }
    subnets: [
      {
        name: 'snet-app'
        properties: {
          addressPrefix: '10.70.1.0/24'
          delegations: [{ name: 'flex', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
      {
        name: 'snet-postgres'
        properties: {
          addressPrefix: '10.70.2.0/24'
          delegations: [{ name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }]
        }
      }
    ]
  }
}

resource dnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: dnsZoneName
  location: 'global'
  tags: tags
}

resource dnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: dnsZone
  name: 'vnet-${namePrefix}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

// ---------- PostgreSQL ----------

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = if (deployDatabase) {
  name: postgresName
  location: location
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: postgresVersion
    storage: { storageSizeGB: 32, autoGrow: 'Disabled' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: {
      delegatedSubnetResourceId: '${vnet.id}/subnets/snet-postgres'
      privateDnsZoneArmResourceId: dnsZone.id
      publicNetworkAccess: 'Disabled'
    }
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: subscription().tenantId
    }
    // Azure's monthly updates: Tuesday 08:00 UTC (4 AM in New York in summer, 3 AM in winter).
    maintenanceWindow: { customWindow: 'Enabled', dayOfWeek: 2, startHour: 8, startMinute: 0 }
  }
  dependsOn: [dnsLink]
}

// Changes to one server must not run at the same time, so each waits for the one before.
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = if (deployDatabase) {
  parent: postgres
  name: databaseName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

resource extensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = if (deployDatabase) {
  parent: postgres
  name: 'azure.extensions'
  properties: { value: 'PG_TRGM', source: 'user-override' }
  dependsOn: [database]
}

// ---------- Function App ----------

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource deployments 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'deployments'
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'asp-${namePrefix}'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { tier: 'FlexConsumption', name: 'FC1' }
  properties: { reserved: true }
}

resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: appName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    virtualNetworkSubnetId: '${vnet.id}/subnets/snet-app'
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'PGHOST', value: '${postgresName}.postgres.database.azure.com' }
        { name: 'PGDATABASE', value: databaseName }
        { name: 'PGUSER', value: appName }
        { name: 'OIDC_AUDIENCE', value: 'li-dance-server' }
        { name: 'OIDC_REPOSITORY', value: githubRepository }
        { name: 'OIDC_ALLOWED_WORKFLOWS', value: '${githubRepository}/.github/workflows/database-sync.yml' }
        { name: 'DRILL_SERVER_PREFIX', value: postgresName }
      ]
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}deployments'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: maximumInstanceCount
        instanceMemoryMB: instanceMemoryMB
        alwaysReady: alwaysReady > 0 ? [{ name: 'http', instanceCount: alwaysReady }] : []
      }
      runtime: { name: 'node', version: '24' }
    }
  }
  dependsOn: [deployments]
}

resource appStorageRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, app.id, roles.storageBlobDataOwner)
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.storageBlobDataOwner)
  }
}

// The app is the database's administrator (it applies the design changes in server/migrations/).
module postgresAdmin 'postgres-admin.bicep' = if (deployDatabase) {
  name: 'postgres-admin-${appName}'
  params: {
    postgresName: postgresName
    principalId: app.identity.principalId
    principalName: app.name
  }
  dependsOn: [extensions]
}

// ---------- GitHub Actions deploys the app (main branch only, no secret) ----------

resource deployIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-github-deploy-${namePrefix}'
  // An identity works in every region; it was first created next to the rest of the site.
  location: resourceGroup().location
  tags: tags
}

resource deployFederation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: deployIdentity
  name: 'github-main'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubRepository}:ref:refs/heads/main'
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

output appName string = app.name
output appUrl string = 'https://${app.properties.defaultHostName}'
output postgresHost string = '${postgresName}.postgres.database.azure.com'
output deployClientId string = deployIdentity.properties.clientId
output tenantId string = subscription().tenantId
output subscriptionId string = subscription().subscriptionId
