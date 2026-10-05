// Admin alerts: a Logic App (Consumption) that emails the site owner through the Outlook.com connector
// (personal Microsoft account; the Office 365 Outlook connector needs a work or school account).
// The API posts { subject, html } to it when something new waits in the moderation queue
// (api/src/lib/notify.js): at most one email per 15 minutes, counts and a link only.
//
// Set up (owner's personal subscription, resource group rg-li-dance-events-web):
//   1. az deployment group create -g rg-li-dance-events-web -f infra/notify.bicep -p notifyTo=<owner email>
//   2. Azure portal > API connection "outlook-1" > Edit API connection > Authorize: sign in with the
//      Outlook.com account that sends the mail, then Save. (If a later deployment shows the connection as
//      "Unauthenticated" again, repeat this step.)
//   3. Copy the trigger address (Logic App > Overview > Workflow URL, or az rest ... /triggers/manual/listCallbackUrl)
//      into the ADMIN_NOTIFY_URL app setting of the Static Web App and the ADMIN_NOTIFY_URL GitHub secret.
//      The address contains a secret signature: never put it in git or in a chat.
//      On Windows, "az staticwebapp appsettings set" cuts values at "&"; see docs/deployment.md.
//
// To change who gets the alerts later: Logic App > Logic app designer > Parameters > notifyTo, or redeploy
// with a new notifyTo.

@description('Azure region for the Logic App and its connection.')
param location string = 'eastus2'

@description('Logic App name.')
param logicAppName string = 'logic-li-dance-notify'

@description('Who gets the alerts (one address or several separated by semicolons).')
param notifyTo string

@description('Name of the Outlook.com API connection. Production uses outlook-1 (the one the owner authorized).')
param connectionName string = 'outlook-1'

@description('Tags for every resource.')
param tags object = {
  app: 'long-island-dance-events'
  purpose: 'admin-alerts'
}

resource outlook 'Microsoft.Web/connections@2016-06-01' = {
  name: connectionName
  location: location
  kind: 'V1'
  tags: tags
  properties: {
    displayName: 'Outlook.com'
    api: {
      id: subscriptionResourceId('Microsoft.Web/locations/managedApis', location, 'outlook')
    }
  }
}

// Run history must not keep visitor text, so the trigger and the email step use "secure inputs/outputs".
var secure = {
  secureData: {
    properties: ['inputs', 'outputs']
  }
}

resource notify 'Microsoft.Logic/workflows@2019-05-01' = {
  name: logicAppName
  location: location
  tags: tags
  properties: {
    state: 'Enabled'
    parameters: {
      '$connections': {
        value: {
          '${connectionName}': {
            connectionId: outlook.id
            connectionName: outlook.name
            id: outlook.properties.api.id
          }
        }
      }
      notifyTo: {
        value: notifyTo
      }
    }
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: {
        '$connections': {
          type: 'Object'
          defaultValue: {}
        }
        notifyTo: {
          type: 'String'
          defaultValue: ''
        }
      }
      triggers: {
        manual: {
          type: 'Request'
          kind: 'Http'
          runtimeConfiguration: secure
          inputs: {
            method: 'POST'
            schema: {
              type: 'object'
              required: ['subject', 'html']
              properties: {
                subject: { type: 'string' }
                html: { type: 'string' }
              }
            }
          }
        }
      }
      actions: {
        // Answer the API right away; the email goes out after.
        Accepted: {
          type: 'Response'
          kind: 'Http'
          runAfter: {}
          inputs: {
            statusCode: 202
          }
        }
        Send_email: {
          type: 'ApiConnection'
          runAfter: {
            Accepted: ['Succeeded']
          }
          runtimeConfiguration: secure
          inputs: {
            host: {
              connection: {
                name: '@parameters(\'$connections\')[\'${connectionName}\'][\'connectionId\']'
              }
            }
            method: 'post'
            path: '/v2/Mail'
            body: {
              To: '@parameters(\'notifyTo\')'
              Subject: '@{take(triggerBody()?[\'subject\'], 200)}'
              Body: '@{triggerBody()?[\'html\']}'
              Importance: 'Normal'
            }
          }
        }
      }
      outputs: {}
    }
  }
}

output logicAppName string = notify.name
output connectionName string = outlook.name
