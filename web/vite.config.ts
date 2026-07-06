import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 构建版本号：CI 用提交 SHA，本地退化为构建时间戳。
// 用于给 data.json 的请求加 ?v= 查询串做缓存击穿（见 App.tsx）。
const buildId = process.env.GITHUB_SHA || String(Date.now());

// base 用相对路径，便于部署到 GitHub Pages 的任意子路径。
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
});
