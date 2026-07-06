// M4 · 投稿解析器
// 读取 github-issue-parser 解析出的表单 JSON，按投稿类型生成/补丁文件：
//   problem  新题推荐 → 建 problems/<id>/{meta.yml,statements,solutions}
//   append   追加评价/题解 → 向已有 meta.yml 追加 recommender/difficulty/thinking_ratio/solution/must_do
//   tag      提议新标签 → 向 data/tags.yml 追加待审标签
// 投稿人 handle 不在 data/people.yml 时，自动登记为 guest。
//
// 输入（环境变量，供 GitHub Actions 用；本地可用 --file/--type/--number 覆盖）：
//   INTAKE_TYPE   problem | append | tag
//   ISSUE_JSON    表单解析后的 JSON 字符串
//   ISSUE_NUMBER  Issue 编号（用于分支名/兜底 id）
// 输出：生成/修改文件；若 GITHUB_OUTPUT 存在，写出 branch/title 供后续 Action 使用。
//
// 用法（本地干跑）：
//   node scripts/intake.mjs --type problem --file sample.json --number 1

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import * as yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROBLEMS = path.join(ROOT, 'problems');

// ---------- CLI / env ----------
function argOf(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const TYPE = argOf('--type') ?? process.env.INTAKE_TYPE;
const NUMBER = argOf('--number') ?? process.env.ISSUE_NUMBER ?? '';
const jsonFile = argOf('--file');
const rawJson = jsonFile ? fs.readFileSync(jsonFile, 'utf8') : process.env.ISSUE_JSON;

if (!TYPE || !rawJson) {
  console.error('✗ 缺少 INTAKE_TYPE 或 ISSUE_JSON（本地可用 --type/--file 提供）');
  process.exit(1);
}
let form;
try {
  form = JSON.parse(rawJson);
} catch (e) {
  console.error('✗ 表单 JSON 解析失败：' + e.message);
  process.exit(1);
}

const TODAY = new Date().toISOString().slice(0, 10);
const die = (msg) => {
  console.error('✗ ' + msg);
  process.exit(1);
};

// ---------- 值归一 ----------
const EMPTY = new Set(['', '_No response_', 'None', 'N/A', '—（不填）—']);
function str(v) {
  if (v == null) return undefined;
  const s = String(v).trim();
  return EMPTY.has(s) ? undefined : s;
}
// checkboxes / 多值：可能是数组、对象或字符串
function checkedList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'object')
    return Object.entries(v)
      .filter(([, b]) => b === true || b === 'true')
      .map(([k]) => k.trim());
  const s = String(v);
  const lines = s.split(/\r?\n/);
  let sawBox = false;
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*-?\s*\[([ xX])\]\s*(.+?)\s*$/);
    if (m) {
      sawBox = true;
      if (m[1].toLowerCase() === 'x') out.push(m[2].trim());
    }
  }
  if (sawBox) return out;
  return s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter((x) => x && !EMPTY.has(x));
}
// 剥掉 render 文本域外层的代码围栏（```lang … ```）。
// 表单里题面/题解字段用了 render，GitHub 会把正文包进围栏，github-issue-parser
// 捕获时连同围栏一起返回；这里去掉首尾同长度的围栏，拿回纯正文。
// 用捕获组保证首尾反引号数量一致，兼容正文自身含 ``` 时 GitHub 用更长围栏的情形。
function unfence(v) {
  if (v == null) return v;
  const s = String(v).replace(/\r\n/g, '\n').trim();
  const m = s.match(/^(`{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/);
  return m ? m[2] : v;
}
// 供 render 文本域使用：先剥围栏再做空值归一。
const mdField = (v) => str(unfence(v));

const firstToken = (v) => {
  const s = str(v);
  return s ? s.split(/\s+/)[0] : undefined;
};
const intOf = (v) => {
  const t = firstToken(v);
  if (t == null) return undefined;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? undefined : n;
};

// ---------- 全局数据 ----------
const load = (rel) => yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const config = load('data/config.yml') ?? {};
const canGrantMustDo = config?.permissions?.can_grant_must_do ?? ['core', 'trusted'];
const peopleText = fs.readFileSync(path.join(ROOT, 'data/people.yml'), 'utf8');
const peopleDoc = yaml.load(peopleText) ?? {};
const peopleList = Array.isArray(peopleDoc.people) ? peopleDoc.people : [];
const roleOf = (h) => peopleList.find((p) => p?.handle === h)?.role;

// 标签白名单（含别名）→ 规范名
function tagMap(list) {
  const m = new Map();
  for (const it of list ?? []) {
    if (!it?.name) continue;
    m.set(it.name.toLowerCase(), it.name);
    for (const a of it.aliases ?? []) m.set(String(a).toLowerCase(), it.name);
  }
  return m;
}
const tagsDoc = load('data/tags.yml');
const tagMaps = { topic: tagMap(tagsDoc.topic), reason: tagMap(tagsDoc.reason) };
const medalKeys = new Set(Object.keys(load('data/difficulty-map.yml').medal ?? {}));

// ---------- 通用小工具 ----------
function sanitizeId(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function short4(seed) {
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 4);
}
function deriveId(slug, primaryLink, title) {
  const s = sanitizeId(slug);
  if (s) return s;
  if (primaryLink) {
    let m = primaryLink.match(/codeforces\.com\/contest\/(\d+)\/problem\/([A-Za-z0-9]+)/i);
    if (m) return `CF${m[1]}${m[2].toUpperCase()}`;
    m = primaryLink.match(/codeforces\.com\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/i);
    if (m) return `CF${m[1]}${m[2].toUpperCase()}`;
    m = primaryLink.match(/luogu\.com\.cn\/problem\/([A-Za-z0-9]+)/i);
    if (m) return m[1].toUpperCase();
  }
  const t = sanitizeId(title);
  if (t && /[A-Za-z0-9]/.test(t)) return t;
  return `P-${NUMBER || Date.now()}`;
}
function platformOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('codeforces')) return 'Codeforces';
    if (host.includes('luogu')) return 'Luogu';
    if (host.includes('vjudge')) return 'vjudge';
    if (host.includes('qoj')) return 'QOJ';
    if (host.includes('atcoder')) return 'AtCoder';
    return host;
  } catch {
    return 'link';
  }
}
function difficultyEntry(evaluator) {
  const scaleRaw = str(form.difficulty_scale) ?? '';
  const wantsCf = scaleRaw.startsWith('cf') || str(form.cf_value) != null;
  const wantsMedal = scaleRaw.startsWith('medal') || str(form.medal_value) != null;
  if (wantsCf && intOf(form.cf_value) != null) {
    return { evaluator, scale: 'cf', value: intOf(form.cf_value), date: TODAY };
  }
  if (wantsMedal) {
    const raw = str(form.medal_value) ?? '';
    const m = raw.match(/\(([a-z_]+)\)/);
    const key = m ? m[1] : raw;
    if (medalKeys.has(key)) return { evaluator, scale: 'medal', value: key, date: TODAY };
  }
  return null;
}
function mapTags(cat) {
  const out = [];
  for (const label of checkedList(form[cat])) {
    const canon = tagMaps[cat].get(label.toLowerCase());
    if (canon && !out.includes(canon)) out.push(canon);
  }
  return out;
}

// 自动登记新 handle 为 guest（改 people.yml 文本，保留原注释）
const notes = [];
function ensurePerson(handle) {
  if (peopleList.some((p) => p?.handle === handle)) return;
  const block = `\n  # 由投稿自动登记（Issue #${NUMBER}）\n  - handle: ${handle}\n    role: guest\n`;
  fs.writeFileSync(path.join(ROOT, 'data/people.yml'), peopleText.replace(/\s*$/, '\n') + block, 'utf8');
  peopleList.push({ handle, role: 'guest' });
  notes.push(`新 handle \`${handle}\` 已自动登记为 guest`);
}

// 统一用 js-yaml 默认风格（确定性规则：能裸写就裸写，仅会被误解析的值加单引号）。
// forceQuotes 在本 js-yaml 版本会给数字/布尔加 !!int/!!bool 标签，故不用。
const dumpYaml = (obj) => yaml.dump(obj, { lineWidth: -1, noRefs: true });

// 题面原文语言：优先下拉里的语言码，其次“其他”输入，默认 zh（本社区多为中文原生题）。
function origLang() {
  const dd = str(form.statement_original_lang);
  if (dd) {
    const tok = dd.split(/\s+/)[0];
    if (/^[A-Za-z]{2,}$/.test(tok)) return tok.toLowerCase();
  }
  const other = str(form.statement_original_lang_other);
  if (other) return sanitizeId(other).toLowerCase() || 'zh';
  return 'zh';
}
const writeFileSafe = (abs, content) => {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

let outBranch = `intake/issue-${NUMBER || 'x'}`;
let outTitle = '';

// ============================================================
// 1. 新题推荐
// ============================================================
function doProblem() {
  const handle = str(form.handle) || die('缺少 handle');
  const title = str(form.title) || die('缺少 title');
  const linkLines = checkedList(form.links);
  if (linkLines.length === 0) die('缺少 links');

  const links = linkLines.map((url, i) => ({
    platform: platformOf(url),
    url,
    ...(i === 0 ? { is_primary: true } : {}),
  }));

  let id = deriveId(str(form.slug), links[0].url, title);
  if (fs.existsSync(path.join(PROBLEMS, id))) {
    const suffixed = `${id}-${short4(id + '#' + NUMBER)}`;
    notes.push(`id \`${id}\` 已存在，改用 \`${suffixed}\``);
    id = suffixed;
  }

  ensurePerson(handle);

  const meta = { id, slug: str(form.slug) ? sanitizeId(form.slug) : id, title };

  const source = {};
  if (str(form.contest)) source.contest = str(form.contest);
  if (str(form.origin_platform)) source.origin_platform = str(form.origin_platform);
  if (Object.keys(source).length) meta.source = source;

  meta.links = links;

  const rec = { handle };
  if (str(form.comment)) rec.comment = str(form.comment);
  rec.date = TODAY;
  if (intOf(form.strength) != null) rec.strength = intOf(form.strength);
  meta.recommenders = [rec];

  const topic = mapTags('topic');
  const reason = mapTags('reason');
  if (topic.length || reason.length) {
    meta.tags = {};
    if (topic.length) meta.tags.topic = topic;
    if (reason.length) meta.tags.reason = reason;
  }

  if (intOf(form.thinking_ratio) != null) {
    meta.thinking_ratio = [{ evaluator: handle, value: intOf(form.thinking_ratio), date: TODAY }];
  }

  const diff = difficultyEntry(handle);
  if (diff) meta.difficulty = [diff];

  // 题面 / 题解文件。题面按「原文 / 中文翻译」区分，原文列在前。
  const statements = [];
  const solutions = [];
  const orig = mdField(form.statement_original);
  if (orig) {
    const lang = origLang();
    writeFileSafe(path.join(PROBLEMS, id, `statements/original.${lang}.md`), orig + '\n');
    statements.push({
      file: `statements/original.${lang}.md`,
      kind: 'original',
      lang,
      ...(str(form.statement_original_url) ? { source_url: str(form.statement_original_url) } : {}),
    });
  }
  const zh = mdField(form.statement_zh);
  if (zh) {
    writeFileSafe(path.join(PROBLEMS, id, 'statements/translation.zh.md'), zh + '\n');
    statements.push({
      file: 'statements/translation.zh.md',
      kind: 'translation',
      lang: 'zh',
      ...(str(form.statement_zh_url) ? { source_url: str(form.statement_zh_url) } : {}),
    });
  }
  if (statements.length) meta.statements = statements;

  const sol = mdField(form.solution);
  if (sol) {
    writeFileSafe(path.join(PROBLEMS, id, `solutions/${handle}.md`), sol + '\n');
    solutions.push({ file: `solutions/${handle}.md`, author: handle, kind: 'community', lang: 'zh', date: TODAY });
  }
  if (solutions.length) meta.solutions = solutions;

  // 必做徽章：仅当 handle 角色有权限
  if (checkedList(form.must_do).length > 0) {
    const role = roleOf(handle);
    if (role && canGrantMustDo.includes(role)) meta.must_do = [handle];
    else notes.push(`handle \`${handle}\`（role=${role ?? 'guest'}）无权盖必做徽章，已忽略该勾选`);
  }

  meta.status = { availability: 'ok', last_checked: TODAY };
  meta.meta = { created: TODAY, updated: TODAY, added_by: handle };

  writeFileSafe(path.join(PROBLEMS, id, 'meta.yml'), dumpYaml(meta));
  outBranch = `intake/problem-${id}`;
  outTitle = `投稿：新题 ${id} ${title}`;
  console.log(`✓ 已创建 problems/${id}/`);
}

// ============================================================
// 2. 追加评价 / 题解
// ============================================================
function doAppend() {
  const handle = str(form.handle) || die('缺少 handle');
  const pid = str(form.problem_id) || die('缺少 problem_id');
  const dir = path.join(PROBLEMS, pid);
  const metaPath = path.join(dir, 'meta.yml');
  if (!fs.existsSync(metaPath)) die(`题目不存在：${pid}`);

  const meta = yaml.load(fs.readFileSync(metaPath, 'utf8'));
  ensurePerson(handle);
  const added = [];
  // 追加/覆盖：同一人对同一题只保留一条推荐/难度/思维/自有题解，
  // 重复投稿视为“修改本人之前的评价”，按 handle/evaluator/file 覆盖而非新增重复条目。
  const mark = (label, action) => added.push(action === 'updated' ? `${label}（更新）` : label);
  const upsert = (arr, matchFn, entry) => {
    const i = arr.findIndex(matchFn);
    if (i >= 0) {
      arr[i] = entry;
      return 'updated';
    }
    arr.push(entry);
    return 'added';
  };

  if (str(form.comment) || intOf(form.strength) != null) {
    meta.recommenders ??= [];
    // 合并式更新：只覆盖本次填了的字段（推荐语 / 强度），保留未填的旧值。
    const prev = meta.recommenders.find((r) => r?.handle === handle);
    const rec = { handle };
    const comment = str(form.comment) ?? prev?.comment;
    if (comment) rec.comment = comment;
    rec.date = TODAY;
    const strength = intOf(form.strength) ?? prev?.strength;
    if (strength != null) rec.strength = strength;
    mark('推荐', upsert(meta.recommenders, (r) => r?.handle === handle, rec));
  }

  const diff = difficultyEntry(handle);
  if (diff) {
    meta.difficulty ??= [];
    mark('难度', upsert(meta.difficulty, (d) => d?.evaluator === handle, diff));
  }

  if (intOf(form.thinking_ratio) != null) {
    meta.thinking_ratio ??= [];
    const entry = { evaluator: handle, value: intOf(form.thinking_ratio), date: TODAY };
    mark('思维比例', upsert(meta.thinking_ratio, (t) => t?.evaluator === handle, entry));
  }

  const sol = mdField(form.solution);
  if (sol) {
    const file = `solutions/${handle}.md`;
    writeFileSafe(path.join(dir, file), sol + '\n');
    meta.solutions ??= [];
    const entry = { file, author: handle, kind: 'community', lang: 'zh', date: TODAY };
    mark('题解', upsert(meta.solutions, (s) => s?.file === file, entry));
  }

  // 撤销本人必做徽章（优先于盖章处理，避免同一表单又盖又撤的歧义）。
  if (checkedList(form.must_do_remove).length > 0) {
    if (Array.isArray(meta.must_do) && meta.must_do.includes(handle)) {
      meta.must_do = meta.must_do.filter((h) => h !== handle);
      if (meta.must_do.length === 0) delete meta.must_do;
      added.push('撤销必做徽章');
    } else {
      notes.push(`handle \`${handle}\` 本就没有必做徽章，撤销无效果`);
    }
  } else if (checkedList(form.must_do).length > 0) {
    const role = roleOf(handle);
    if (role && canGrantMustDo.includes(role)) {
      meta.must_do ??= [];
      if (!meta.must_do.includes(handle)) {
        meta.must_do.push(handle);
        added.push('必做徽章');
      } else {
        notes.push(`handle \`${handle}\` 已有必做徽章，无需重复盖章`);
      }
    } else {
      notes.push(`handle \`${handle}\`（role=${role ?? 'guest'}）无权盖必做徽章，已忽略`);
    }
  }

  if (added.length === 0) die('没有任何可追加/修改的内容（推荐/难度/思维/题解/必做都为空）');

  meta.meta ??= {};
  meta.meta.updated = TODAY;
  writeFileSafe(metaPath, dumpYaml(meta));
  outBranch = `intake/append-${pid}`;
  outTitle = `追加/修改：${pid}（${added.join('、')}） by ${handle}`;
  console.log(`✓ 已向 ${pid} 追加/修改：${added.join('、')}`);
}

// ============================================================
// 3. 提议新标签
// ============================================================
function doTag() {
  const dimRaw = str(form.dimension) || die('缺少 dimension');
  const dim = dimRaw.startsWith('topic') ? 'topic' : dimRaw.startsWith('reason') ? 'reason' : null;
  if (!dim) die(`未知维度：${dimRaw}`);
  const name = str(form.tag_name) || die('缺少 tag_name');
  if (tagMaps[dim].has(name.toLowerCase())) die(`标签已存在：${dim}/${name}`);

  const aliases = str(form.aliases)
    ? str(form.aliases)
        .split(/[,，]/)
        .map((x) => x.trim())
        .filter(Boolean)
    : [];

  const text = fs.readFileSync(path.join(ROOT, 'data/tags.yml'), 'utf8');
  const lines = text.split('\n');
  const secIdx = lines.findIndex((l) => l.replace(/\s+$/, '') === `${dim}:`);
  if (secIdx < 0) die(`tags.yml 中找不到维度：${dim}`);
  let end = lines.length;
  for (let i = secIdx + 1; i < lines.length; i++) {
    if (/^[A-Za-z_]+:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  let ins = end;
  while (ins > secIdx + 1 && lines[ins - 1].trim() === '') ins--;
  const entry = [`  - name: ${name}`];
  if (aliases.length) entry.push(`    aliases: [${aliases.join(', ')}]`);
  lines.splice(ins, 0, ...entry);
  fs.writeFileSync(path.join(ROOT, 'data/tags.yml'), lines.join('\n'), 'utf8');

  outBranch = `intake/tag-${sanitizeId(name) || NUMBER || 'new'}`;
  outTitle = `标签提议：${dim} / ${name}`;
  notes.push('合并本 PR 即代表核心成员批准该标签。合并后请记得重跑 `npm run gen:forms` 让表单选项同步。');
  console.log(`✓ 已向 tags.yml 的 ${dim} 追加：${name}`);
}

// ---------- 执行 ----------
if (TYPE === 'problem') doProblem();
else if (TYPE === 'append') doAppend();
else if (TYPE === 'tag') doTag();
else die(`未知 INTAKE_TYPE：${TYPE}`);

// ---------- 输出给后续 Action ----------
const body =
  `本 PR 由投稿 Issue #${NUMBER} 自动生成。\n\nCloses #${NUMBER}\n` +
  (notes.length ? `\n注意事项：\n${notes.map((n) => `- ${n}`).join('\n')}\n` : '');

if (process.env.GITHUB_OUTPUT) {
  // 多行值用 heredoc 分隔符格式写入 $GITHUB_OUTPUT。
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `branch=${outBranch}\n` +
      `title=${outTitle}\n` +
      `body<<__INTAKE_EOF__\n${body}\n__INTAKE_EOF__\n`,
  );
}
console.log('\n分支：' + outBranch);
console.log('PR 标题：' + outTitle);
if (notes.length) console.log('注意：\n  - ' + notes.join('\n  - '));
