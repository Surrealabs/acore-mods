import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    middlewareMode: false,
    fs: {
      allow: ['.', '../'],
    },
    proxy: {
      '/icons-manifest.json': 'http://localhost:3001',
      '/thumbnails': 'http://localhost:3001',
      '/api/starter': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/starter/, '/api/starter')
      },
      '/api': 'http://localhost:3001',
      '/error-logs': 'http://localhost:3001',
      '/icon': 'http://localhost:3001',
      '/Icon': 'http://localhost:3001',
      '/Icons': 'http://localhost:3001',
      '/header-image.png': 'http://localhost:3001',
      '/background-image.png': 'http://localhost:3001',
      '/page-icon.ico': 'http://localhost:3001',
      '/page-icon.png': 'http://localhost:3001',
    },
  },
})
