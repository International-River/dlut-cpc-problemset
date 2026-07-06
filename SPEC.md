# DLUT CPC 精选题单 · 数据规范（M0）

> 本文件是整个项目的**唯一契约（Single Source of Truth 的规范部分）**。
> 所有模块（内容仓库、构建管道、前端、投稿、互动等）都只依赖本规范，
> 不依赖彼此的内部实现。修改本规范前请三思——字段是核心中的核心，改动代价大。

---

## 0. 设计原则

1. **数据即古籍**：核心数据是 GitHub 仓库里的纯文本（YAML + Markdown），
   哪怕网站、后台、点赞系统全部损坏，题单本体依然可读、可重建。
2. **契约驱动、模块解耦**：模块之间只通过「题目文件格式」与「构建产物 `data.json`」通信，
   便于将来把不同模块分给不同的 agent 并行开发。
3. **原生存储、派生展示**：数据层只忠实存储原始信息（每个人的原始打分、原始推荐），
   加权平均、分布图、热度排序等一律由前端/构建层**派生计算**，不落盘为"结论"。
4. **可扩展**：新增字段不得破坏旧数据；未知字段应被容忍（校验器对新增可选字段友好）。

---

## 1. 模块拆分

契约 = 本规范定义的**题目文件格式** + 构建产物 **`data.json`**。

| 模块 | 职责 | 依赖 | 对外契约 |
|---|---|---|---|
| **M0 数据规范** | 字段定义、JSON Schema 校验、ID 规则、标签白名单、人员名册、难度映射、配额配置、示例 | 无 | 本仓库 `spec/` 与 `data/` |
| **M1 内容仓库** | `problems/` 下真实题目文件、Git/PR 规范 | M0 | 符合 schema 的题目文件夹 |
| **M2 构建管道** | 读题目 → 校验 → 去重 → 合并成 `data.json` → 死链检查 | M0 | `data.json` |
| **M3 前端浏览** | 静态站：列表 / 筛选 / 搜索 / 详情 / 题解渲染 / 难度图表 / 热度排序 | `data.json` | 网页 |
| **M4 投稿** | GitHub Issue 表单 + Action 转 PR | M0 | 生成符合 schema 的文件 |
| **M5 互动** | Giscus 评论 + 点赞（数据存 GitHub Discussions） | M3 | 嵌入组件 |
| **M6 后台 CMS** | 可视化编辑（可选，后期） | M0 | commit 到仓库 |
| **M7 兜底备份** | 离线单文件、镜像、互动数据导出、月度死链检查 | M2 | Release / 镜像 |
| **M8 CI/CD** | 编排以上 Action、部署 Pages | 各模块脚本 | 工作流 |

**并行建议**：M0 先定死；随后 M1/M2/M3/M4 可四路并行（仅靠 schema 与 `data.json` 通信）；M5/M6/M7/M8 为第二波。

---

## 2. 目录结构

```
/
├── SPEC.md                       # 本规范（M0）
├── README.md
├── spec/
│   └── meta.schema.json          # 题目 meta.yml 的 JSON Schema 校验器
├── data/
│   ├── people.yml                # 人员名册（handle 必填、真名可空）
│   ├── tags.yml                  # 受控标签白名单
│   ├── difficulty-map.yml        # 奖牌档 ↔ CF rating 近似映射（仅用于排序/聚合）
│   └── config.yml                # 全局配置（配额等）
└── problems/
    └── <id>/                     # 一题一文件夹
        ├── meta.yml              # 结构化字段（核心）
        ├── statements/
        │   ├── <kind>.<lang>.md        # kind ∈ {original,translation,simplified}
        │   └── ...                     # 如 original.en.md / translation.zh.md
        └── solutions/
            └── <handle>.md
```

---

## 3. 题目字段规范（`problems/<id>/meta.yml`）

### 3.1 字段总览

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `id` | ✅ | string | 主键，等于文件夹名，全局唯一。见 §4 |
| `slug` | ✅ | string | 人类可读、与题号强相关，通常同 `id` |
| `title` | ✅ | string | 题目名称 |
| `source` | 选填 | object | `contest`(比赛名)、`origin_platform`(原始平台) |
| `links` | ✅(≥1) | array | 每项 `platform`、`url`(必填)、`is_primary`(bool) |
| `recommenders` | ✅(≥1) | array | 每项 `handle`(必填)、`comment`、`date`、`strength`(1-5) |
| `tags` | 建议 | object | 两维：`topic`(主题:算法+题型)、`reason`(主观:推荐理由)，值必须来自白名单 |
| `difficulty` | 选填 | array | 多人多值，只表"多难"(scale+value)，见 §3.2 |
| `thinking_ratio` | 选填 | array | 多人多值，每人给思维占几份(实现=10-值)，独立于难度标尺 |
| `related` | 选填 | array | 每项 `id`、`relation`(前置/后续/相似/加强)；题目级"前置题"用此表达 |
| `statements` | 选填(重要) | array | 题面备份，见 §3.3 |
| `solutions` | 选填(重要) | array | 题解，见 §3.3 |
| `must_do` | 选填 | array[handle] | 盖"必做"徽章的人（配额制，见 §7） |
| `status` | 自动 | object | `availability`(ok/limited/dead)、`last_checked` |
| `meta` | 自动 | object | `created`、`updated`、`added_by` |

### 3.2 难度（双标尺共存）

每条难度评价自行声明标尺，`value` 按各自标尺存储，**原生显示不换算**。

`difficulty` 只回答"这题有多难"，每条评价自行声明标尺，`value` 按各自标尺存储，**原生显示不换算**。

```yaml
difficulty:
  - evaluator: tourist        # 必须是 people.yml 里的 handle
    scale: cf                 # cf | medal
    value: 2400               # scale=cf 时为 800-3500 整数
    date: 2024-03-01
    note: "卡常"
  - evaluator: jiangly
    scale: medal              # scale=medal 时 value 为奖牌档枚举
    value: gold_mid           # 见 data/difficulty-map.yml
    date: 2024-03-02
```

- **平台官方评分**（如 CF rating）作为一条 `difficulty`，`evaluator` 用保留平台账号（如 `Codeforces`），`scale: cf`。
- **展示**：CF 题显示 `2400`，区域赛题显示"金牌·中位"，互不换算。
- **排序/聚合**：构建层用 `data/difficulty-map.yml` 把两套标尺映射到统一 cf 等效分，
  再**按评价人 `role_weight` 加权平均**得到"难度排序参考分"（platform 官方评分也按其权重计入）。
  此分**仅用于排序/分布展示**，不作为精确难度展示。

**思维/实现占比（`thinking_ratio`，独立字段、多人多值）**：描述题目**性质**而非难度，
与 cf/medal 正交。每人各给一个 `value`（0-10 整数），表示 10 份难度里"思维"占几份，
实现 = `10 - value`。例：`8` = 八二开（思维 8 / 实现 2），`3` = 三七开，`10` 纯思维，`0` 纯实现。
前端可对多人取值做平均/分布展示。

```yaml
thinking_ratio:
  - evaluator: jiangly        # 必须是 people.yml 里的 handle
    value: 8
    date: 2024-03-02
```

### 3.3 题面与题解（引用外部文件 + 版权后门）

长文本不塞进 YAML，而是各自独立 `.md`，`meta.yml` 只引用并附元数据。

**文件命名约定**（`file` 字段最终以 meta.yml 为准，命名仅为可读性与一致性）：
- 题面：`statements/<kind>.<lang>.md`，`kind ∈ {original, translation, simplified}`（与字段枚举一致），
  `lang` 用语言码（en / zh / …）。例：`original.en.md`、`translation.zh.md`、`simplified.zh.md`。
  同一 `kind`+`lang` 有多份时追加后缀区分，如 `simplified.zh.jiangly.md`。
- 题解：`solutions/<handle>.md`，即作者 handle；同一作者多篇时加后缀，如 `jiangly.2.md`。

```yaml
statements:
  - file: statements/original.en.md
    kind: original            # original | translation | simplified
    lang: en
    source_url: "https://codeforces.com/problemset/problem/1408/D"
    license: "仅存档备份"
    redistribute: true        # 是否允许公开展示全文；false 则前端只显示链接+摘要
  - file: statements/simplified.zh.md
    kind: simplified
    lang: zh
    author: someone           # handle

solutions:
  - file: solutions/jiangly.md
    author: jiangly            # handle，必填
    kind: community            # editorial | community
    lang: zh
    date: 2024-03-02
    source_url: "https://..."  # 若转载，注明出处
    redistribute: true
```

**版权策略**：所有外部信息都可存全文备份；每份带 `source_url`/`license`/`redistribute`。
圈子内部阶段默认 `redistribute: true` 全展示；将来若完全公开，把有风险的置 `false`，
前端自动降级为"链接 + 自有解读"，全文备份仍静躺仓库不外露。

---

## 4. ID 与去重规则

- **主键 = 文件夹名 = `id`**，默认等于 `slug`（与题号强相关，手动命名），如 `CF1408D`、`AGC043B`。
- **仅在冲突时加后缀**，保持干净：`<slug>-<4位base36短哈希>`（基于主链接 URL 计算），如 `CF1408D-k3x9`。
  - 冲突场景：两道不同题想用同一 slug；或无平台题号的自造题。
  - 用短哈希而非时间戳：稳定、可复现、不受录入时间影响。
- 构建管道（M2）自动检测 `id` 重复并报错。
- 命名约定（建议）：`CF<num><idx>`、`AGC<num><idx>`、`ABC<num><idx>`、
  `LG<num>`(洛谷)、`AT<...>`、`ICPC<year>-<region>-<letter>` 等；无强制，但同平台尽量一致。

---

## 5. 标签策略（受控白名单）

- 合法标签全部定义在 `data/tags.yml`，分两类：`topic`（主题：算法 + 题型）/ `reason`（主观：推荐理由）。
- **投稿只能从白名单选择，不能新建**（M2 校验：未知标签 → 报错）。
- **只有拥有仓库写权限的核心成员可以修改白名单**（即新增标签）。
- 新人想加标签：走 GitHub Issue 提议 → 核心成员审核后加入 `tags.yml`。

---

## 6. 人员名册策略

- 所有出现人名的地方（`recommenders[].handle`、`difficulty[].evaluator`、
  `thinking_ratio[].evaluator`、`solutions[].author`、`must_do[]`、`meta.added_by`）
  都引用 `data/people.yml` 里的 `handle`。
- `handle`：必填、唯一、公开。
- `name`（真名）：选填、可空。
- 网站显示规则：有真名显示 `handle(真名)`，无真名只显示 `handle`。
- `role`：`core | trusted | guest | platform`。**`weight` 不在名册手写**，由 `role` 经
  `data/config.yml` 的 `role_weight` 派生（core=3 / trusted=2 / guest=1）。
- **保留特殊账号 `Anonymous`**：公用匿名马甲，供偶尔不愿公开身份者投稿，默认不鼓励开放。
  它不代表单一个人，按 `guest` 计权，且不可盖"必做"徽章。名册中以 `reserved: true` 标记。
- **保留平台账号（`role: platform`，如 `Codeforces`）**：代表平台官方难度评分等"平台事实"，
  可作为 `difficulty[].evaluator`。不是真人，不参与推荐/热度/必做徽章，也无需 `name`。名册中以 `reserved: true` 标记。
- **权限按 role 限制**（见 `config.yml` 的 `permissions`）：盖"必做"徽章仅限 `core`/`trusted`；
  普通推荐（计入加权推荐分）对所有 role 开放，`guest` 权重仅 1。

---

## 7. 推荐度机制（A + B）

防止"超级推荐"后期泛滥，核心是**让顶级信号成为稀缺资源**。

- **B｜普通推荐（不限量）**：`recommenders` 表达"谁推荐这道题、推荐得多强"，数量不限。
  这里有两个正交的量，切勿混淆：
  - **人的权重 `weight`**：品味可信度，全局、跨题不变。由推荐人的 `role` 经
    `role_weight` 派生（core=3 / trusted=2 / guest=1），不在名册手写。
  - `recommenders[].strength`：**这条推荐**的星级（1-5），是 per(人, 题) 的——
    同一个人完全可以给 A 题打 5 星、给 B 题打 1 星。
  - 前端派生的**加权推荐分**（1-5 星量纲）：
    `rating = Σ(role_weight[r.role] × r.strength) / Σ(role_weight[r.role])`，
    即按人权重做的**加权平均星级**。缺省时 `strength` 取 `default_strength`。分数是算出来的，不落盘。
  - 用加权平均而非求和：避免"多人低星"盖过"单人高星"，也避免核心成员的 1 星被权重抬成 3 星。
    "有多少人推荐"这类热度信号另由**推荐人数**单独展示，不与本星级混淆。
- **A｜必做徽章（配额制）**：`must_do` 记录盖"必做"章的 handle。
  **仅 `core`/`trusted` 可盖**（见 `config.yml` 的 `permissions.can_grant_must_do`）。
  每位成员的名额有限（见 `must_do_quota`，按题库比例封顶）。
  想推新的必须撤旧的 → 逼迫珍惜，保证"必做"始终稀缺。
- 构建管道（M2）校验：`must_do` 授予者的 role 合法，且每人出现次数不超过配额，违反报错。

---

## 8. 校验规则（由 M2 构建管道执行）

1. `meta.yml` 通过 `spec/meta.schema.json` 结构校验。
2. `id` 与文件夹名一致且全局唯一。
3. 所有 `handle` 引用存在于 `data/people.yml`。
4. 所有标签存在于 `data/tags.yml` 对应类别。
5. `difficulty[].value`：`scale=cf` 时为 800-3500 整数；`scale=medal` 时为映射表中的枚举。
6. `statements[].file` / `solutions[].file` 指向的文件真实存在。
7. 每人 `must_do` 计数不超过配额。
8. （软校验）`links` 可访问性，写入 `status`，失效不阻断构建，仅告警。

---

## 9. 修改历史策略（明确不手写 changelog）

**决策：题目的修改历史不落盘为手写字段**，理由是那样会与 Git 重复、且必然腐烂。
历史通过两条已有来源呈现，均零维护：

1. **完整审计**：Git 提交记录即权威历史。前端（M3）用 GitHub API 拉取
   `problems/<id>/` 的 commits，提供"查看修改历史"入口。
2. **友好时间线**：由已有的带日期字段派生（`recommenders[].date`、
   `difficulty[].date`、`solutions[].date`、`meta.created/updated`），
   前端渲染成"谁在何时推荐 / 评难度 / 加题解"的语义时间线。

> 因此 **不要**新增 `changelog` 之类的手写历史字段。若将来确有"重大决策理由"
> 需要留痕（极低频），再单独讨论是否加一个可选字段，而非默认要求每次编辑都写。

---

## 10. 投稿流程（M4：Issue 投稿 → PR）

**目标**：不熟悉 Git 的成员也能低门槛投稿，全程只在 GitHub 网页填表单；
最终由脚本生成**符合本规范的文件**并开 PR，核心成员审核合并。全部用成熟现成件，不自造轮子。

**三种投稿（Issue 表单）**，均按「只有基础字段必填、其余全部可选」设计：

| 表单 | 必填 | 作用 | 触发标签 |
|---|---|---|---|
| 推荐一道题 | 链接 / 标题 / handle | 新建 `problems/<id>/` | `intake:problem` |
| 追加评价 / 题解 | 题目 ID / handle | 向已有 `meta.yml` 追加推荐/难度/思维/题解/必做 | `intake:append` |
| 提议新标签 | 维度 / 标签名 / handle | 向 `data/tags.yml` 追加待审标签（合并即批准） | `intake:tag` |

**数据流**：
1. 投稿人在网页提交 Issue（表单自动带上 `intake` + `intake:*` 标签）。
2. **核心成员审阅后打上 `approved-intake` 标签**（防刷闸门；未打标签不会生成任何东西）。
3. `intake.yml` 工作流：`stefanbuck/github-issue-parser` 解析表单 → `scripts/intake.mjs`
   生成/补丁文件 → `peter-evans/create-pull-request` 开 PR 回链 Issue。
4. `validate.yml` 在 PR 上跑 `npm run check`（即 §8 全部校验）作红绿灯。
5. 核心成员 review → 合并。

**关键约定**：
- **表单选项是白名单快照**：`scripts/gen-issue-forms.mjs` 由 `data/tags.yml`、
  `data/difficulty-map.yml` 生成三个表单。白名单变动后须重跑 `npm run gen:forms`。
- **新 handle 自动登记**：投稿人 handle 不在名册时，`intake.mjs` 在同一 PR 里把它加为 `guest`。
- **ID 生成**：优先用投稿人填的题号 slug；否则从主链接推断（CF/洛谷）；再否则退化为标题或 `P-<issue号>`；
  与既有文件夹冲突时加 `-<4位短哈希>` 后缀（见 §4）。
- **必做徽章**：仅当 handle 的 role 属于 `config.yml` 的 `can_grant_must_do` 才生成，否则忽略勾选（避免产出非法数据）。
- **权限前置**：需在仓库 Settings 允许 Actions 创建 PR；`ISSUE_TEMPLATE/config.yml` 的联系链接部署后替换为真实地址。

---

## 11. 变更记录

- v0.2（M4）：新增 Issue 投稿 → PR 流程（三种表单 + 白名单快照生成 + intake 解析 + 两条工作流）。
- v0.1（初版）：确定目录结构、字段 schema、ID 规则、标签/人员/难度/版权/推荐度策略。
