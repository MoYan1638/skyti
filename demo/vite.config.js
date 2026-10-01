import { defineConfig } from 'vite'

export default defineConfig({
  // 三端合并到同一域名：demo 住在 /demo/ 子路径下
  base: '/demo/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  },
  server: {
    port: 3000,
    open: true
  }
})
