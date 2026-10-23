@description('Location for the private-tenant Slop Grenade Container App.')
param location string = resourceGroup().location

@description('Name of the Container Apps managed environment.')
param containerAppsEnvironmentId string

@description('Immutable container image reference (e.g., myacr.azurecr.io/slop-grenade@sha256:...).')
param containerImage string

@description('Container App name.')
param appName string = 'slop-grenade'

@description('GPT Luna model identifier for GitHub Copilot Responses API.')
param lunaModel string = 'gpt-5.6-luna'

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironmentId
    configuration: {
      ingress: {
        external: true
        targetPort: 8090
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: 'slop-grenade'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'HTTP_BIND'
              value: '0.0.0.0:8090'
            }
            {
              name: 'WEB_ASSET_DIR'
              value: '/app/web/build'
            }
            {
              name: 'SLOP_LUNA_MODEL'
              value: lunaModel
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 2
      }
    }
  }
}

output appUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
