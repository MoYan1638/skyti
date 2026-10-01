import { defineConfig } from 'vite'

export default defineConfig({
  // 三端合并到同一域名：standard 住在 /standard/ 子路径下
  base: '/standard/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  },
  server: {
    port: 3000,
    open: true
  }
})