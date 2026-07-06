// M4 · 生成 GitHub Issue 投稿表单
// 从 data/tags.yml、data/difficulty-map.yml 的白名单快照，生成 3 个 Issue 表单：
//   recommend-problem.yml（新题推荐）
//   append-evaluation.yml（给已有题追加评价/题解）
//   propose-tag.yml       （提议新标签）
// 白名单变动后重跑本脚本即可让表单选项同步。用法：node scripts/gen-issue-forms.mjs
//
// 设计原则：只有最基础字段必填（links/title/handle 等），其余全部可选。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.github', 'ISSUE_TEMPLATE');

const load = (rel) => yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const tagsDoc = load('data/tags.yml');
const diffMapDoc = load('data/difficulty-map.yml');

const topicNames = (tagsDoc.topic ?? []).map((t) => t.name);
const reasonNames = (tagsDoc.reason ?? []).map((t) => t.name);
// 奖牌档下拉：展示“中文标签 (key)”，intake 再用括号里的 key 回填。
const medalOptions = Object.entries(diffMapDoc.medal ?? {}).map(
  ([key, v]) => `${v.label} (${key})`,
);

const md = (value) => ({ type: 'markdown', attributes: { value } });
const input = (id, label, opts = {}) => ({
  type: 'input',
  id,
  attributes: { label, ...(opts.placeholder ? { placeholder: opts.placeholder } : {}) },
  ...(opts.required ? { validations: { required: true } } : {}),
});
const textarea = (id, label, opts = {}) => ({
  type: 'textarea',
  id,
  attributes: { label, ...(opts.placeholder ? { placeholder: opts.placeholder } : {}) },
  ...(opts.required ? { validations: { required: true } } : {}),
});
const dropdown = (id, label, options, opts = {}) => ({
  type: 'dropdown',
  id,
  attributes: { label, options },
  ...(opts.required ? { validations: { required: true } } : {}),
});
const checkboxes = (id, label, options) => ({
  type: 'checkboxes',
  id,
  attributes: { label, options: options.map((o) => ({ label: o })) },
});

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

// ---------- 1. 新题推荐 ----------
const recommendForm = {
  name: '推荐一道题',
  description: '推荐一道好题加入题单。只需填「链接 / 标题 / 你的 handle」，其余全部可选。',
  labels: ['intake', 'intake:problem'],
  body: [
    md('感谢投稿！**只有前三项必填**，其余都可以留空，之后随时可补。'),
    textarea('links', '题目链接（必填，每行一个，第一行视为主链接）', {
      required: true,
      placeholder:
        'https://codeforces.com/contest/1458/problem/C\nhttps://www.luogu.com.cn/problem/CF1458C',
    }),
    input('title', '题目名称（必填）', { required: true }),
    input('handle', '你的 handle（必填，用于署名；新人将自动登记为 guest）', { required: true }),
    md('—— 以下全部选填 ——'),
    input('slug', '题号 / 短名（选填，如 CF1458C；留空将自动生成 id）'),
    input('contest', '来源 / 比赛（选填，如 Codeforces Round 691 (Div. 1)）'),
    input('origin_platform', '原始平台（选填，如 Codeforces）'),
    textarea('comment', '推荐语（选填）'),
    dropdown('strength', '推荐强度（选填，1 一般 … 5 强烈推荐）', range(1, 5)),
    dropdown('difficulty_scale', '难度标尺（选填）', ['cf（Codeforces 分数）', 'medal（奖牌档）']),
    input('cf_value', 'CF 难度分（选填，标尺选 cf 时填，800–3500 整数）'),
    dropdown('medal_value', '奖牌档（选填，标尺选 medal 时选）', medalOptions),
    dropdown('thinking_ratio', '思维比例（选填，0=纯实现 … 10=纯思维）', range(0, 10)),
    checkboxes('topic', '主题标签（选填，可多选）', topicNames),
    checkboxes('reason', '推荐理由标签（选填，可多选）', reasonNames),
    textarea('statement_zh', '中文题面（选填，可含 $LaTeX$）'),
    input('statement_zh_url', '中文题面来源链接（选填）'),
    textarea('statement_original', '原文题面（选填，可含 $LaTeX$）'),
    input('statement_original_lang', '原文语言（选填，默认 en）'),
    input('statement_original_url', '原文题面来源链接（选填）'),
    textarea('solution', '题解（选填，可含 $LaTeX$；作者默认为你）'),
    checkboxes('must_do', '必做徽章（选填）', ['为这道题盖“必做”徽章（仅核心/受信任成员有效）']),
  ],
};

// ---------- 2. 追加评价 / 题解 ----------
const appendForm = {
  name: '给已有题追加评价 / 题解',
  description: '为题单里已有的题追加你的推荐 / 难度评分 / 思维比例 / 题解。填「题目 ID / 你的 handle」即可，其余按需填。',
  labels: ['intake', 'intake:append'],
  body: [
    md('为**已有题目**追加内容。只需填题目 ID 与你的 handle，其余按你想追加的部分填即可（留空的不会追加）。'),
    input('problem_id', '题目 ID（必填，如 CF1458C，即题目文件夹名）', { required: true }),
    input('handle', '你的 handle（必填；新人将自动登记为 guest）', { required: true }),
    md('—— 以下按需填，留空即不追加 ——'),
    textarea('comment', '推荐语（选填，填了即追加一条推荐）'),
    dropdown('strength', '推荐强度（选填，1 … 5）', range(1, 5)),
    dropdown('difficulty_scale', '难度标尺（选填）', ['cf（Codeforces 分数）', 'medal（奖牌档）']),
    input('cf_value', 'CF 难度分（选填，800–3500）'),
    dropdown('medal_value', '奖牌档（选填）', medalOptions),
    dropdown('thinking_ratio', '思维比例（选填，0 … 10）', range(0, 10)),
    textarea('solution', '题解（选填，填了即追加一份，作者为你）'),
    checkboxes('must_do', '必做徽章（选填）', ['为这道题盖“必做”徽章（仅核心/受信任成员有效）']),
  ],
};

// ---------- 3. 提议新标签 ----------
const tagForm = {
  name: '提议新标签',
  description: '标签受控，只有核心成员能改白名单。你可以在此提议新标签，核心成员合并生成的 PR 即代表批准。',
  labels: ['intake', 'intake:tag'],
  body: [
    md('提议一个新的受控标签。合并生成的 PR 即代表核心成员批准并加入白名单。'),
    dropdown('dimension', '标签维度（必填）', ['topic（主题：算法/题型）', 'reason（推荐理由）'], {
      required: true,
    }),
    input('tag_name', '标签名（必填，如 莫队）', { required: true }),
    input('handle', '你的 handle（必填）', { required: true }),
    input('aliases', '别名（选填，逗号分隔，如 mo,莫队算法）'),
    textarea('reason_text', '为什么需要这个标签（选填）'),
  ],
};

const config = {
  blank_issues_enabled: false,
  contact_links: [
    {
      name: '使用说明 / 讨论',
      url: 'https://github.com/',
      about: '不确定填什么？可先在 Discussions 里问。（部署后请把此链接换成真实仓库地址）',
    },
  ],
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const HEADER = '# 本文件由 scripts/gen-issue-forms.mjs 依据白名单快照自动生成，请勿手改。\n';
const dump = (obj) =>
  HEADER + yaml.dump(obj, { lineWidth: -1, noRefs: true, quotingType: '"' });

fs.writeFileSync(path.join(OUT_DIR, 'recommend-problem.yml'), dump(recommendForm), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'append-evaluation.yml'), dump(appendForm), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'propose-tag.yml'), dump(tagForm), 'utf8');
// config.yml 不含标签快照，但一并生成，保证禁用空白 Issue。
fs.writeFileSync(
  path.join(OUT_DIR, 'config.yml'),
  '# 本文件由 scripts/gen-issue-forms.mjs 生成。\n' + yaml.dump(config, { lineWidth: -1 }),
  'utf8',
);

console.log('✓ 已生成 Issue 表单：');
console.log(`  - .github/ISSUE_TEMPLATE/recommend-problem.yml（topic ${topicNames.length}·reason ${reasonNames.length}·medal ${medalOptions.length}）`);
console.log('  - .github/ISSUE_TEMPLATE/append-evaluation.yml');
console.log('  - .github/ISSUE_TEMPLATE/propose-tag.yml');
console.log('  - .github/ISSUE_TEMPLATE/config.yml');
