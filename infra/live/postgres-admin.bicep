// Microsoft Entra administrator of the PostgreSQL server (a module, because the name is the identity's
// object id, which is only known while the deployment runs).
param postgresName string
param principalId string
param principalName string
@allowed(['ServicePrincipal', 'User', 'Group'])
param principalType string = 'ServicePrincipal'

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: postgresName
}

resource admin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: postgres
  name: principalId
  properties: {
    principalType: principalType
    principalName: principalName
    tenantId: subscription().tenantId
  }
}
