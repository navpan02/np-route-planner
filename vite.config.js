import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/np-route-planner/',
  optimizeDeps: {
    include: ['@geoman-io/leaflet-geoman-free'],
  },
  build: {
    commonjsOptions: {
      include: [/@geoman-io\/leaflet-geoman-free/, /node_modules/],
    },
  },
})
