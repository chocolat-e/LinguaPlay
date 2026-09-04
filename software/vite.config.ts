import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'
import { createPunchKtMiddleware } from './server/punchKtApi.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')

  // The device bridge (bridge.py) normally runs on this machine. Proxying it
  // rather than letting the browser call it directly keeps the game's origin
  // single: no CORS preflight on the input poll, and no IP address baked into
  // a build — point BRIDGE_URL at another machine and nothing else changes.
  const bridgeUrl = environment.BRIDGE_URL || 'http://127.0.0.1:5000'

  return {
    plugins: [react(), punchKtApi(environment)],
    server: { proxy: bridgeProxy(bridgeUrl) },
    preview: { proxy: bridgeProxy(bridgeUrl) },
  }
})

function bridgeProxy(target: string): Record<string, ProxyOptions> {
  return {
    '/bridge': {
      target,
      changeOrigin: true,
      // The bridge serves /api/*; the prefix exists only to separate its routes
      // from the game's own /api/punchkt middleware.
      rewrite: (path) => path.replace(/^\/bridge/, ''),
      // A bridge that is not running is the normal case while working on
      // gameplay, and Vite logging a stack trace per poll would bury
      // everything else. BridgeSource already backs off and retries.
      configure: (proxy) => {
        proxy.on('error', () => {})
      },
    },
  }
}

function punchKtApi(environment: Record<string, string>): Plugin {
  const middleware = createPunchKtMiddleware(environment)
  return {
    name: 'punchkt-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
