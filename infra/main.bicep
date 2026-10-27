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

@description('Whether ingress is reachable outside the Container Apps VNet environment (default false for private-tenant security).')
param externalIngress bool = false

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
        external: externalIngress
        targetPort: 8090
        transport: 'auto'
        allowInsecure: false
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
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/v1/health'
                port: 8090
              }
              initialDelaySeconds: 5
              periodSeconds: 15
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/v1/health'
                port: 8090
              }
              initialDelaySeconds: 2
              periodSeconds: 10
            }
          ]
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
output ingressExternal bool = containerApp.properties.configuration.ingress.external
