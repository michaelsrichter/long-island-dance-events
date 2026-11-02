// A web address for the live server (decision P59): binds a custom host name to the App Service app and gives
// it a free App Service managed certificate (SNI).
//
// First time for a name (the DNS records must exist first: CNAME <name> -> app-li-dance-events.azurewebsites.net
// and TXT asuid.<name> -> the app's customDomainVerificationId):
//   az deployment group create -g rg-li-dance-events-web --subscription fd38bfe4-1b60-405d-bff9-020f3ff54d88 `
//     --name domain-new --template-file infra/live/custom-domain.bicep --parameters hostName=new.longisland.dance
// Again later (renewal is automatic; this only repairs): add thumbprint=<the certificate's thumbprint> so the
// name is never without its certificate during the update.
//
// infra/live/main.bicep does not declare host names, so running it again leaves these bindings as they are.
targetScope = 'resourceGroup'

@description('The web address, for example new.longisland.dance.')
param hostName string

@description('Web app name.')
param appName string = 'app-li-dance-events'

@description('Region of the app (P57).')
param location string = 'centralus'

@description('Thumbprint of the existing certificate for this name; empty the first time.')
param thumbprint string = ''

resource app 'Microsoft.Web/sites@2024-04-01' existing = {
  name: appName
}

// First time only: the name must be bound (without HTTPS) before Azure will make its certificate.
resource binding 'Microsoft.Web/sites/hostNameBindings@2024-04-01' = if (empty(thumbprint)) {
  parent: app
  name: hostName
  properties: {
    siteName: app.name
    hostNameType: 'Verified'
    customHostNameDnsRecordType: 'CName'
    sslState: 'Disabled'
  }
}

resource certificate 'Microsoft.Web/certificates@2024-04-01' = {
  name: '${hostName}-${appName}'
  location: location
  properties: {
    serverFarmId: app.properties.serverFarmId
    canonicalName: hostName
  }
  dependsOn: [binding]
}

// The same binding again, now with HTTPS (a module, because one template can't declare a resource twice).
module sni 'custom-domain-sni.bicep' = {
  name: 'sni-${replace(hostName, '.', '-')}'
  params: {
    appName: app.name
    hostName: hostName
    thumbprint: certificate.properties.thumbprint
  }
}

output hostName string = hostName
output thumbprint string = certificate.properties.thumbprint
output expires string = certificate.properties.expirationDate
