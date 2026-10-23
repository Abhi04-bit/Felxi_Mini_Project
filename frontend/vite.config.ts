import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const prometheusTarget = env.VITE_PROMETHEUS_PROXY_TARGET || 'http://127.0.0.1:9090'
  const apiProxy = {
    '/api/prometheus': {
      target: prometheusTarget,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api\/prometheus/, ''),
    },
  }

  return {
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: apiProxy },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy: apiProxy },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('/node_modules/recharts/') || id.includes('/node_modules/d3-')) return 'visualization-vendor'
            if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/')) return 'react-vendor'
          },
        },
      },
    },
  }
})
