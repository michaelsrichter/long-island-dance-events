using './main.bicep'

param location = 'eastus2'
param staticWebAppName = 'swa-riverbend-web'
param skuName = 'Free'
param enableMonitoring = true
param logAnalyticsDailyCapGb = '0.1'
