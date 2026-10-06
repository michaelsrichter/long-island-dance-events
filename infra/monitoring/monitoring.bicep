targetScope = 'resourceGroup'

@description('Name of the existing workspace-based Application Insights component.')
param appInsightsName string = 'appi-swa-li-dance-events-web'

@description('Name of the existing Log Analytics workspace used by Application Insights.')
param workspaceName string = 'log-swa-li-dance-events-web'

@description('Azure region for regional monitoring resources.')
param location string = resourceGroup().location

@description('Resource tags applied to new monitoring resources.')
param tags object = {
  project: 'long-island-dance-events'
  environment: 'production'
  managedBy: 'bicep'
  workload: 'community-site-monitoring'
}

@description('Stable workbook resource GUID. Keep this value the same so redeploys update the existing workbook.')
param workbookId string = '8f7764a3-b7d6-4f9f-8889-e64e164a41fd'

@description('Monthly resource-group budget in USD.')
@minValue(1)
param budgetAmount int = 40

@description('Budget start date in yyyy-MM-dd format. Azure requires this to be the first day of a month.')
param budgetStartDate string = '2026-10-01'

@description('Extra email addresses that should receive alert and budget notifications.')
param alertEmails array = []

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: workspaceName
}

var dashboardName = 'dash-li-dance-events'
var workbookResourceId = resourceId('Microsoft.Insights/workbooks', workbookId)
var dashboardResourceId = resourceId('Microsoft.Portal/dashboards', dashboardName)
var workbookPortalUrlValue = 'https://portal.azure.com/#@/resource${workbookResourceId}/workbook'
var dashboardPortalUrlValue = 'https://portal.azure.com/#@/resource${dashboardResourceId}'
var appInsightsLogsUrl = 'https://portal.azure.com/#@/resource${appInsights.id}/logs'
var workspaceLogsUrl = 'https://portal.azure.com/#@/resource${workspace.id}/logs'
var dashboardMarkdown = join([
  '# Long Island Dance Events: usage'
  'Open the full workbook: [Long Island Dance Events: how people use the site](${workbookPortalUrlValue}).'
  'Open logs: [Application Insights logs](${appInsightsLogsUrl}) or [Log Analytics workspace logs](${workspaceLogsUrl}).'
  'The workspace daily cap is 0.1 GB. If the cap is reached, log collection may pause until the cap resets.'
], '\n\n')

resource workbook 'Microsoft.Insights/workbooks@2023-06-01' = {
  name: workbookId
  location: location
  kind: 'shared'
  tags: union(tags, {
    'hidden-title': 'Long Island Dance Events: how people use the site'
  })
  properties: {
    displayName: 'Long Island Dance Events: how people use the site'
    category: 'workbook'
    sourceId: appInsights.id
    serializedData: loadTextContent('site-usage.workbook.json')
    version: '1.0'
  }
}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-li-dance-events'
  location: 'Global'
  tags: tags
  properties: {
    groupShortName: 'lidance'
    enabled: true
    armRoleReceivers: [
      {
        name: 'Subscription Owners'
        roleId: '8e3af657-a8ff-443c-a75c-2fe8c4bcb635'
        useCommonAlertSchema: true
      }
    ]
    emailReceivers: [for (email, i) in alertEmails: {
      name: 'Email ${i + 1}'
      emailAddress: email
      useCommonAlertSchema: true
    }]
  }
}

resource failedRequestsAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'ma-li-dance-api-failed-requests'
  location: 'global'
  tags: tags
  properties: {
    description: 'Long Island Dance Events API had more than 10 failed requests in one hour.'
    severity: 2
    enabled: true
    scopes: [
      appInsights.id
    ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'FailedRequestsMoreThan10'
          criterionType: 'StaticThresholdCriterion'
          metricNamespace: 'Microsoft.Insights/components'
          metricName: 'requests/failed'
          operator: 'GreaterThan'
          threshold: 10
          timeAggregation: 'Count'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}

resource exceptionsAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'ma-li-dance-api-exceptions'
  location: 'global'
  tags: tags
  properties: {
    description: 'Long Island Dance Events API recorded more than 20 exceptions in one hour.'
    severity: 2
    enabled: true
    scopes: [
      appInsights.id
    ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'ExceptionsMoreThan20'
          criterionType: 'StaticThresholdCriterion'
          metricNamespace: 'Microsoft.Insights/components'
          metricName: 'exceptions/count'
          operator: 'GreaterThan'
          threshold: 20
          timeAggregation: 'Count'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}

// Checks every 6 hours whether the workspace hit its daily data cap (about $0.50 a month; decision P50).
resource dataCapAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'sqr-li-dance-log-cap-reached'
  location: location
  tags: tags
  properties: {
    displayName: 'Long Island Dance Events log daily cap reached'
    description: 'The Log Analytics workspace appears to have reached its daily data cap, so new monitoring data may be paused until the cap resets.'
    enabled: true
    severity: 2
    scopes: [
      workspace.id
    ]
    evaluationFrequency: 'PT6H'
    windowSize: 'PT6H'
    autoMitigate: true
    criteria: {
      allOf: [
        {
          // The query Microsoft documents for this alert (learn.microsoft.com/azure/azure-monitor/logs/daily-cap).
          query: '_LogOperation | where Category =~ "Ingestion" | where Detail contains "OverQuota"'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: 'budget-li-dance-events'
  properties: {
    category: 'Cost'
    amount: budgetAmount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactRoles: [
          'Owner'
        ]
        contactEmails: alertEmails
      }
      actual100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactRoles: [
          'Owner'
        ]
        contactEmails: alertEmails
      }
      forecasted100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactRoles: [
          'Owner'
        ]
        contactEmails: alertEmails
      }
    }
  }
}

resource dashboard 'Microsoft.Portal/dashboards@2020-09-01-preview' = {
  name: dashboardName
  location: location
  tags: union(tags, {
    'hidden-title': 'Long Island Dance Events: usage'
  })
  properties: {
    lenses: [
      {
        order: 0
        parts: [
          {
            position: {
              x: 0
              y: 0
              colSpan: 8
              rowSpan: 5
            }
            metadata: {
              type: 'Extension/HubsExtension/PartType/MarkdownPart'
              inputs: []
              settings: {
                content: {
                  settings: {
                    content: dashboardMarkdown
                    title: 'Long Island Dance Events: usage'
                    subtitle: 'Start here, then open the workbook for the full view.'
                  }
                }
              }
            }
          }
        ]
      }
    ]
    metadata: {
      model: {
        timeRange: {
          value: {
            relative: {
              duration: 24
              timeUnit: 1
            }
          }
          type: 'MsPortalFx.Composition.Configuration.ValueTypes.TimeRange'
        }
      }
    }
  }
  dependsOn: [
    workbook
  ]
}

output workbookId string = workbook.id
output workbookPortalUrl string = workbookPortalUrlValue
output dashboardPortalUrl string = dashboardPortalUrlValue
