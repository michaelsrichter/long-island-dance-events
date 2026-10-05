// Community website starter infrastructure.
targetScope = 'resourceGroup'

@description('Azure region for the Static Web App.')
@allowed(['eastus2', 'centralus', 'westus2', 'westeurope', 'eastasia'])
param location string = 'eastus2'

@description('Globally unique name for the Static Web App, such as swa-li-dance-events-web.')
param staticWebAppName string

@description('Static Web Apps plan. Standard is needed for custom sign-in (Entra External ID) and role assignment by function.')
@allowed(['Free', 'Standard'])
param skuName string = 'Standard'

@description('Create the community storage account (likes, comments, photos, moderation) and Azure AI Content Safety.')
param enableCommunity bool = true

@description('Globally unique storage account name for community data (3-24 lowercase letters and digits).')
param communityStorageName string = 'stlongislanddance'

@description('Origins allowed to read the public community JSON from Blob Storage (CORS, GET/HEAD only). The containers are public and read-only, so any origin is fine; this also covers pull-request preview sites.')
param communityCorsOrigins array = ['*']

@description('Name (and custom subdomain) of the Azure AI Content Safety resource. Must be globally unique.')
param contentSafetyName string = 'cs-longislanddance'

@description('Content Safety pricing tier. F0 is free (5,000 text records + 5,000 images a month, then it stops); S0 is pay-as-you-go.')
@allowed(['F0', 'S0'])
param contentSafetySku string = 'F0'

@description('Create Log Analytics + Application Insights for OpenTelemetry metrics and events from /api/telemetry.')
param enableMonitoring bool = true

@description('Region for monitoring resources.')
param monitoringLocation string = location

@description('Daily ingestion cap for Log Analytics in GB. Keeps monitoring cost near zero for a small site.')
param logAnalyticsDailyCapGb string = '0.1'

@description('Resource tags.')
param tags object = {
  project: 'community-site-starter'
  template: 'community-site-starter'
  environment: 'production'
  managedBy: 'bicep'
  costCenter: 'volunteer'
}

resource swa 'Microsoft.Web/staticSites@2024-04-01' = {
  name: staticWebAppName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuName
  }
  properties: {
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Enabled'
    enterpriseGradeCdnStatus: 'Disabled'
  }
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (enableMonitoring) {
  name: 'log-${staticWebAppName}'
  location: monitoringLocation
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: json(logAnalyticsDailyCapGb) }
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = if (enableMonitoring) {
  name: 'appi-${staticWebAppName}'
  location: monitoringLocation
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    IngestionMode: 'LogAnalytics'
    DisableIpMasking: false
    RetentionInDays: 30
  }
}

// ---------- Community data: likes, comments, photos, moderation ----------
// SWA managed Functions cannot use managed identity, so they use the account's connection string
// (app setting COMMUNITY_STORAGE). Keep this account for community data only.
resource community 'Microsoft.Storage/storageAccounts@2023-05-01' = if (enableCommunity) {
  name: communityStorageName
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: true // only the "photos" and "community" containers are public (read-only)
    allowSharedKeyAccess: true
    publicNetworkAccess: 'Enabled'
  }
}

resource communityBlobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = if (enableCommunity) {
  parent: community
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
    cors: {
      corsRules: [
        {
          allowedOrigins: communityCorsOrigins
          allowedMethods: ['GET', 'HEAD']
          allowedHeaders: ['*']
          exposedHeaders: ['ETag', 'Last-Modified']
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

var containers = [
  { name: 'pending', access: 'None' } // photos waiting for a human; never public
  { name: 'photos', access: 'Blob' } // approved photos
  { name: 'community', access: 'Blob' } // read-model JSON per page
  { name: 'backups', access: 'None' } // weekly table exports
]
resource communityContainers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [for c in containers: if (enableCommunity) {
  parent: communityBlobs
  name: c.name
  properties: { publicAccess: c.access }
}]

resource communityTables 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = if (enableCommunity) {
  parent: community
  name: 'default'
}

var tableNames = ['Users', 'Comments', 'Photos', 'Likes', 'LikeCounts', 'UserItems', 'Flags', 'ModQueue', 'ModLog', 'Limits', 'ReviewState']
resource communityTableList 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = [for t in tableNames: if (enableCommunity) {
  parent: communityTables
  name: t
}]

resource communityLifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = if (enableCommunity) {
  parent: community
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'expire-pending-photos'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['pending/'] }
            actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 30 } } }
          }
        }
        {
          name: 'expire-old-backups'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['backups/'] }
            actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 35 } } }
          }
        }
      ]
    }
  }
  dependsOn: [communityContainers]
}

resource contentSafety 'Microsoft.CognitiveServices/accounts@2024-10-01' = if (enableCommunity) {
  name: contentSafetyName
  location: location
  tags: tags
  kind: 'ContentSafety'
  sku: { name: contentSafetySku }
  properties: {
    customSubDomainName: contentSafetyName
    disableLocalAuth: false // SWA managed Functions cannot use managed identity, so they use the key
    publicNetworkAccess: 'Enabled'
  }
}

output staticWebAppName string = swa.name
output defaultHostname string = swa.properties.defaultHostname
output siteUrl string = 'https://${swa.properties.defaultHostname}'
output appInsightsName string = enableMonitoring ? appInsights.name : ''
output logAnalyticsWorkspaceName string = enableMonitoring ? workspace.name : ''
output communityStorageName string = enableCommunity ? community.name : ''
output communityBlobBase string = enableCommunity ? community!.properties.primaryEndpoints.blob : ''
output contentSafetyName string = enableCommunity ? contentSafety.name : ''
output contentSafetyEndpoint string = enableCommunity ? contentSafety!.properties.endpoint : ''
