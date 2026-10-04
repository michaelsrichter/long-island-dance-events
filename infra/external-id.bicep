// Microsoft Entra External ID tenant for visitor sign-in (likes, comments, photos).
// Deploy once: az deployment group create -g rg-li-dance-events-web -f infra/external-id.bicep
// The tenant itself (app registration, user flow) is configured by infra/configure-external-id.ps1.
targetScope = 'resourceGroup'

@description('Domain prefix of the tenant: <name>.onmicrosoft.com and <name>.ciamlogin.com. Cannot be changed later.')
@maxLength(26)
param tenantName string = 'longislanddance'

@description('Display name shown on the sign-in page and in the Entra admin center.')
param displayName string = 'Long Island Dance'

@description('Data location of the tenant.')
@allowed(['United States', 'Europe', 'Asia Pacific', 'Australia'])
param dataLocation string = 'United States'

@description('Country code used when creating the tenant.')
param countryCode string = 'US'

param tags object = {
  project: 'li-dance-events'
  managedBy: 'bicep'
  costCenter: 'volunteer'
}

resource externalTenant 'Microsoft.AzureActiveDirectory/ciamDirectories@2023-05-17-preview' = {
  #disable-next-line BCP334 BCP335
  name: '${tenantName}.onmicrosoft.com' // the service requires the full domain, despite the schema pattern
  location: dataLocation
  tags: tags
  sku: {
    #disable-next-line BCP036
    name: 'Base' // the service rejects 'Standard' (2026-10); 'Base' is the MAU-billed SKU
    tier: 'A0'
  }
  properties: {
    createTenantProperties: {
      displayName: displayName
      countryCode: countryCode
    }
  }
}

output tenantId string = externalTenant.properties.tenantId
output domainName string = '${tenantName}.onmicrosoft.com'
output ciamLoginHost string = '${tenantName}.ciamlogin.com'
