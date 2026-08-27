import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { createPunchKtMiddleware } from './server/punchKtApi.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), punchKtApi(environment)],
  }
})

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
