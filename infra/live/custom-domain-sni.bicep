// Turns on HTTPS (SNI) for a host name bound to the web app, with the given certificate (custom-domain.bicep).
param appName string
param hostName string
param thumbprint string

resource app 'Microsoft.Web/sites@2024-04-01' existing = {
  name: appName
}

resource binding 'Microsoft.Web/sites/hostNameBindings@2024-04-01' = {
  parent: app
  name: hostName
  properties: {
    siteName: app.name
    hostNameType: 'Verified'
    customHostNameDnsRecordType: 'CName'
    sslState: 'SniEnabled'
    thumbprint: thumbprint
  }
}
