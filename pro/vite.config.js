import { defineConfig } from 'vite'

export default defineConfig({
  // 三端合并到同一域名：pro 住在 /pro/ 子路径下
  base: '/pro/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  },
  server: {
    port: 3000,
    open: true
  }
})
