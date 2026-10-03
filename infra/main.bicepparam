using './main.bicep'

param location = 'eastus2'
param staticWebAppName = 'swa-li-dance-events-web'
param skuName = 'Free'
param enableMonitoring = true
param logAnalyticsDailyCapGb = '0.1'
