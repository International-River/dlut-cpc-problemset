// meta.yml 格式化 / 格式检查
// 把每个 problems/<id>/meta.yml 归一到 js-yaml 默认 dump 风格（与投稿脚本 intake.mjs 完全一致），
// 保证全库 YAML 风格统一，杜绝“双引号/单引号/裸写”混用。
//
// 只处理 problems/*/meta.yml：data/*.yml 带重要注释，不参与格式化。
//
// 用法：
//   node scripts/fmt.mjs          # 就地格式化所有 meta.yml
//   node scripts/fmt.mjs --check  # 只检查、不改写；有未格式化文件则非零退出（CI 用）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROBLEMS = path.join(ROOT, 'problems');
const CHECK_ONLY = process.argv.includes('--check');

const canonical = (obj) => yaml.dump(obj, { lineWidth: -1, noRefs: true });

const dirs = fs.existsSync(PROBLEMS)
  ? fs
      .readdirSync(PROBLEMS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  : [];

const offenders = [];
let changed = 0;

for (const d of dirs) {
  const rel = `problems/${d}/meta.yml`;
  const abs = path.join(PROBLEMS, d, 'meta.yml');
  if (!fs.existsSync(abs)) continue;
  const cur = fs.readFileSync(abs, 'utf8');
  let want;
  try {
    want = canonical(yaml.load(cur));
  } catch (e) {
    console.error(`✗ ${rel} YAML 解析失败：${e.message}`);
    process.exitCode = 1;
    continue;
  }
  if (cur === want) continue;
  if (CHECK_ONLY) {
    offenders.push(rel);
  } else {
    fs.writeFileSync(abs, want, 'utf8');
    changed++;
    console.log('已格式化 ' + rel);
  }
}

if (CHECK_ONLY) {
  if (offenders.length) {
    console.error(`\n✗ ${offenders.length} 个 meta.yml 未按规范格式化：`);
    for (const o of offenders) console.error('  - ' + o);
    console.error('\n请在仓库根目录运行 `npm run fmt` 自动修复后重新提交。');
    process.exit(1);
  }
  console.log('✓ 所有 meta.yml 格式规范。');
} else {
  console.log(changed ? `✓ 已格式化 ${changed} 个文件。` : '✓ 无需改动，所有 meta.yml 已规范。');
}
