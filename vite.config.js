import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        name: 'Phantom League',
        short_name: 'Phantom',
        description: '架空野球リーグ シミュレーター',
        theme_color: '#0d1410',
        background_color: '#0d1410',
        display: 'standalone',
        icons: []
      }
    })
  ]
})
