// M2 构建管道
// 职责：加载数据 → JSON Schema 校验 → 交叉引用校验（handle/标签/难度/文件/配额）
//        → 去重 → 派生计算（加权推荐分、难度排序键、思维比例均值等）→ 输出 dist/data.json
//
// 用法：
//   node scripts/build.mjs           # 校验并生成 dist/data.json
//   node scripts/build.mjs --check   # 只校验，不写文件（CI 用）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CHECK_ONLY = process.argv.includes('--check');

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`[${where}] ${msg}`);
const warn = (where, msg) => warnings.push(`[${where}] ${msg}`);

function loadYaml(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    err(rel, '文件缺失');
    return null;
  }
  try {
    return yaml.load(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    err(rel, `YAML 解析失败：${e.message}`);
    return null;
  }
}

// ---------- 1. 加载规范与全局数据 ----------
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/meta.schema.json'), 'utf8'));
const config = loadYaml('data/config.yml') ?? {};
const peopleDoc = loadYaml('data/people.yml') ?? {};
const tagsDoc = loadYaml('data/tags.yml') ?? {};
const diffMapDoc = loadYaml('data/difficulty-map.yml') ?? {};

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateMeta = ajv.compile(schema);

// ---------- 2. 构建查找表 ----------
const VALID_ROLES = ['core', 'trusted', 'guest', 'platform'];
const roleWeight = config.role_weight ?? {};
const defaultWeight = config.default_weight ?? 1;
const defaultStrength = config?.recommendation?.weighted_rating?.default_strength ?? 3;
const canGrantMustDo = config?.permissions?.can_grant_must_do ?? ['core', 'trusted'];

// 人员名册
const people = Array.isArray(peopleDoc.people) ? peopleDoc.people : [];
const peopleByHandle = new Map();
for (const p of people) {
  if (!p || !p.handle) {
    err('people.yml', `存在缺少 handle 的条目：${JSON.stringify(p)}`);
    continue;
  }
  if (peopleByHandle.has(p.handle)) err('people.yml', `handle 重复：${p.handle}`);
  if (p.role && !VALID_ROLES.includes(p.role)) err('people.yml', `未知 role：${p.role}（${p.handle}）`);
  peopleByHandle.set(p.handle, p);
}
const roleOf = (h) => peopleByHandle.get(h)?.role;
const weightOf = (h) => roleWeight[roleOf(h)] ?? defaultWeight;

// 标签白名单：lowercase(名称/别名) → 规范名
function buildTagMap(list, cat) {
  const map = new Map();
  for (const item of list ?? []) {
    if (!item?.name) continue;
    map.set(item.name.toLowerCase(), item.name);
    for (const a of item.aliases ?? []) map.set(String(a).toLowerCase(), item.name);
  }
  return map;
}
const tagMaps = {
  topic: buildTagMap(tagsDoc.topic, 'topic'),
  reason: buildTagMap(tagsDoc.reason, 'reason'),
};

// 奖牌档 → cf 近似 rating
const medalMap = diffMapDoc.medal ?? {};

// ---------- 3. 遍历题目 ----------
const problemsDir = path.join(ROOT, 'problems');
const problemDirs = fs.existsSync(problemsDir)
  ? fs.readdirSync(problemsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];

const seenIds = new Set();
const problems = [];
const mustDoCount = new Map(); // handle -> 次数

for (const dir of problemDirs) {
  const where = `problems/${dir}`;
  const metaRel = `problems/${dir}/meta.yml`;
  const meta = loadYaml(metaRel);
  if (!meta) continue;

  // 3.1 Schema 校验
  if (!validateMeta(meta)) {
    for (const e of validateMeta.errors) err(where, `schema：${e.instancePath || '/'} ${e.message}`);
    continue;
  }

  // 3.2 id 与文件夹名一致 + 全局唯一
  if (meta.id !== dir) err(where, `id(${meta.id}) 与文件夹名(${dir}) 不一致`);
  if (seenIds.has(meta.id)) err(where, `id 重复：${meta.id}`);
  seenIds.add(meta.id);

  // 3.3 handle 引用存在性
  const checkHandle = (h, field) => {
    if (!peopleByHandle.has(h)) err(where, `${field} 引用了不存在的 handle：${h}`);
  };
  for (const r of meta.recommenders ?? []) checkHandle(r.handle, 'recommenders.handle');
  for (const d of meta.difficulty ?? []) checkHandle(d.evaluator, 'difficulty.evaluator');
  for (const t of meta.thinking_ratio ?? []) checkHandle(t.evaluator, 'thinking_ratio.evaluator');
  for (const s of meta.solutions ?? []) checkHandle(s.author, 'solutions.author');
  for (const h of meta.must_do ?? []) checkHandle(h, 'must_do');
  if (meta.meta?.added_by) checkHandle(meta.meta.added_by, 'meta.added_by');

  // 3.4 标签白名单 + 归一
  const normTags = {};
  for (const cat of ['topic', 'reason']) {
    const src = meta.tags?.[cat];
    if (!src) continue;
    normTags[cat] = [];
    for (const tag of src) {
      const canonical = tagMaps[cat].get(String(tag).toLowerCase());
      if (!canonical) err(where, `tags.${cat} 含白名单外标签：${tag}`);
      else normTags[cat].push(canonical);
    }
  }

  // 3.5 难度取值校验 + 映射排序键（记录 {value, weight} 以便按评价人加权平均）
  const diffMapped = [];
  for (const d of meta.difficulty ?? []) {
    let mapped = null;
    if (d.scale === 'cf') {
      if (!Number.isInteger(d.value) || d.value < (config.difficulty?.cf_min ?? 800) || d.value > (config.difficulty?.cf_max ?? 3500))
        err(where, `difficulty cf 取值非法：${d.value}`);
      else mapped = d.value;
    } else if (d.scale === 'medal') {
      const m = medalMap[d.value];
      if (!m) err(where, `difficulty medal 取值不在映射表：${d.value}`);
      else mapped = m.rating;
    }
    if (mapped != null) diffMapped.push({ value: mapped, weight: weightOf(d.evaluator) });
  }

  // 3.6 引用文件存在性
  for (const s of meta.statements ?? []) {
    if (!fs.existsSync(path.join(problemsDir, dir, s.file))) err(where, `statements 文件不存在：${s.file}`);
  }
  for (const s of meta.solutions ?? []) {
    if (!fs.existsSync(path.join(problemsDir, dir, s.file))) err(where, `solutions 文件不存在：${s.file}`);
  }

  // 3.7 必做徽章：授予者 role 权限 + 计数
  for (const h of meta.must_do ?? []) {
    const role = roleOf(h);
    if (role && !canGrantMustDo.includes(role)) err(where, `必做徽章授予者 role(${role}) 无权限：${h}`);
    mustDoCount.set(h, (mustDoCount.get(h) ?? 0) + 1);
  }

  // 3.8 派生计算
  const recs = meta.recommenders ?? [];
  let wsum = 0, wxs = 0;
  for (const r of recs) {
    const w = weightOf(r.handle);
    const s = r.strength ?? defaultStrength;
    wsum += w; wxs += w * s;
  }
  const thinkVals = (meta.thinking_ratio ?? []).map((t) => t.value);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  // 难度排序参考分：按评价人 role_weight 加权平均后的 cf 等效分
  let dwSum = 0, dwxv = 0;
  for (const { value, weight } of diffMapped) { dwSum += weight; dwxv += weight * value; }

  const derived = {
    weightedRating: wsum ? Number((wxs / wsum).toFixed(2)) : null,
    recommenderCount: recs.length,
    difficultySort: dwSum ? Math.round(dwxv / dwSum) : null,
    difficultyCount: diffMapped.length,
    thinkingRatioAvg: thinkVals.length ? Number(avg(thinkVals).toFixed(1)) : null,
    mustDoCount: (meta.must_do ?? []).length,
  };

  // 把题面/题解正文嵌入，使 data.json 自包含（前端无需再取 .md，利于离线单文件）。
  const withContent = (arr) =>
    (arr ?? []).map((s) => {
      const abs = path.join(problemsDir, dir, s.file);
      return { ...s, content: fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null };
    });

  problems.push({
    ...meta,
    tags: normTags,
    statements: withContent(meta.statements),
    solutions: withContent(meta.solutions),
    derived,
  });
}

// ---------- 4. 全局校验：必做徽章配额 ----------
const total = problems.length;
const quotaCfg = config?.recommendation?.must_do_quota ?? {};
const quota = Math.max(quotaCfg.min_slots ?? 0, Math.ceil(total * (quotaCfg.ratio ?? 1)));
for (const [h, n] of mustDoCount) {
  if (n > quota) err('must_do', `${h} 的必做徽章数(${n}) 超过配额(${quota})`);
}

// ---------- 5. 输出 ----------
if (errors.length) {
  console.error(`\n✗ 校验失败，共 ${errors.length} 处错误：`);
  for (const e of errors) console.error('  - ' + e);
  if (warnings.length) {
    console.error(`\n⚠ ${warnings.length} 处警告：`);
    for (const w of warnings) console.error('  - ' + w);
  }
  process.exit(1);
}

const data = {
  generatedAt: new Date().toISOString(),
  counts: { problems: total, people: people.length },
  people,
  tags: {
    topic: (tagsDoc.topic ?? []).map((t) => t.name),
    reason: (tagsDoc.reason ?? []).map((t) => t.name),
  },
  medalMap,
  problems: problems.sort((a, b) => (b.derived.weightedRating ?? 0) - (a.derived.weightedRating ?? 0)),
};

if (!CHECK_ONLY) {
  const outDir = path.join(ROOT, 'dist');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'data.json'), JSON.stringify(data, null, 2), 'utf8');
  console.log(`✓ 校验通过，已生成 dist/data.json（题目 ${total} 道，人员 ${people.length} 人）`);
} else {
  console.log(`✓ 校验通过（题目 ${total} 道，人员 ${people.length} 人）`);
}
if (warnings.length) {
  console.log(`⚠ ${warnings.length} 处警告：`);
  for (const w of warnings) console.log('  - ' + w);
}
