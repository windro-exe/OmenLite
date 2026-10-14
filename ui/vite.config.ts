import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './', // loaded from a local folder by WebView2
  build: { outDir: '../wwwroot', emptyOutDir: true },
})
