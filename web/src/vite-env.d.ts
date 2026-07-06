/// <reference types="vite/client" />

// 由 vite.config.ts 的 define 注入的构建版本号（用于 data.json 缓存击穿）。
declare const __BUILD_ID__: string;
