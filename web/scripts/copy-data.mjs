// 把 M2 产物 dist/data.json 复制到前端 public/，供运行时 fetch。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, '../../dist/data.json');
const destDir = path.resolve(__dirname, '../public');
const dest = path.join(destDir, 'data.json');

if (!fs.existsSync(src)) {
  console.error('✗ 找不到 dist/data.json，请先在仓库根目录运行 `npm run build`（M2 构建管道）。');
  process.exit(1);
}
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('✓ 已复制 data.json 到 web/public/');
