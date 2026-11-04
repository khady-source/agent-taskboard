import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // In development, forward API calls to the Node server.
    proxy: { '/api': 'http://localhost:3000' },
  },
})
