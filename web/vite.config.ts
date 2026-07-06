import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base 用相对路径，便于部署到 GitHub Pages 的任意子路径。
export default defineConfig({
  base: './',
  plugins: [react()],
});
