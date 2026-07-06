# DLUT CPC 精选题单

一个可长期传承、抗丢失的算法竞赛荐题清单。核心数据是 Git 仓库里的纯文本，
即使网站/后台/互动系统全部损坏，题单本体依然可读、可重建。

## 现状：M0（规范）+ M2（构建）+ M3（前端）+ M4（投稿）已就绪

- **M0 数据规范**——整个项目的唯一契约，后续模块只依赖它。
- **M2 构建管道**——校验所有数据并生成前端可用的 `dist/data.json`。
- **M3 前端浏览站**——`web/` 下的静态站，消费 `data.json`，提供列表/筛选/排序/详情。
- **M4 Issue 投稿**——网页填表单，核心成员打标签后自动转成 PR，零 Git 知识可投稿。

阅读顺序：先看 [`SPEC.md`](./SPEC.md)（总设计 + 模块拆分 + 字段规范 + 各项策略）。

## 构建与校验（M2）

```bash
npm install          # 首次安装依赖
npm run build        # 校验数据并生成 dist/data.json
npm run check        # 只校验、不写文件（CI 用）
```

构建会执行 SPEC §8 的全部校验：JSON Schema、id 唯一性、handle/标签白名单引用、
难度取值与奖牌映射、题面/题解文件存在性、必做徽章的 role 权限与配额；并派生计算
加权推荐分、难度排序键、思维比例均值等，写入 `dist/data.json`（已 gitignore）。
题面/题解正文也会被嵌入 `data.json`，使前端自包含。

## 前端浏览站（M3）

```bash
# 先在仓库根目录跑 M2 生成 dist/data.json，然后：
cd web
npm install          # 首次
npm run dev          # 本地预览 http://localhost:5173
npm run build        # 产出静态站到 web/dist（部署到 GitHub Pages）
```

前端特性：搜索、按主题/理由标签筛选、按推荐分/难度/人数/标题排序、只看必做、
题目详情页（多平台链接、多人推荐语、双标尺难度、思维比例、多版本题面/题解，题面题解默认折叠、点选才展开），
题面题解用 `react-markdown + remark-math + rehype-katex` 渲染（支持 `$...$` / `$$...$$` 数学公式）。

## Issue 投稿 → PR（M4）

不熟悉 Git 的成员也能投稿：在 GitHub 仓库的 **Issues → New issue** 里选择一种表单填写即可。

- **推荐一道题**：只需填「链接 / 标题 / 你的 handle」，其余（难度、标签、题面、题解…）全部选填。
- **给已有题追加评价 / 题解**：填题目 ID 与 handle，按需追加推荐 / 难度 / 思维比例 / 题解 / 必做。
- **提议新标签**：标签受控，提议合并即批准。

流程：投稿人提交 Issue → 核心成员审阅后打上 `approved-intake` 标签 →
`intake.yml` 工作流自动解析表单、生成/补丁文件、开 PR 回链 Issue →
`validate.yml` 跑 M2 校验 → 核心成员 review 合并。投稿人 handle 不在名册时自动登记为 `guest`。

```bash
npm run gen:forms    # 白名单（tags.yml / difficulty-map.yml）变动后重跑，同步表单选项
```

> 部署提示：需在仓库 **Settings → Actions → General** 勾选
> “Allow GitHub Actions to create and approve pull requests”，否则工作流无法自动开 PR。
> 另外 `.github/ISSUE_TEMPLATE/config.yml` 里的联系链接部署后请替换为真实仓库地址。

## 目录

```
SPEC.md                       # 规范总文档（先读这个）
spec/meta.schema.json         # 题目 meta.yml 的 JSON Schema 校验器
scripts/build.mjs             # M2 构建管道（校验 + 生成 data.json）
scripts/gen-issue-forms.mjs   # M4 由白名单快照生成 Issue 投稿表单
scripts/intake.mjs            # M4 解析表单 → 生成/补丁文件
.github/ISSUE_TEMPLATE/       # M4 投稿表单（自动生成，勿手改）
.github/workflows/            # intake.yml（投稿转 PR）、validate.yml（PR 校验）
web/                          # M3 前端浏览站（Vite + React + TS）
data/
  people.yml                  # 人员名册（handle 必填、真名可空）
  tags.yml                    # 受控标签白名单（topic / reason）
  difficulty-map.yml          # 奖牌档 ↔ CF rating 近似映射（仅用于排序）
  config.yml                  # 全局配置（推荐配额、role 权重、权限等）
problems/<id>/                # 一题一文件夹
  meta.yml                    # 结构化字段
  statements/                 # 题面（原文备份 + 翻译/简化）
  solutions/                  # 题解（多人多版本）
dist/data.json                # 构建产物（gitignore，前端 M3 消费）
```

## 已确定的核心决策

- **存储**：一题一文件夹；结构化字段进 `meta.yml`，长文本各自独立 `.md`。
- **ID**：主键=文件夹名，与题号强相关，冲突时加 `-<4位短哈希>` 后缀。
- **难度**：CF rating 与"金/银/铜牌 上/中/下位"双标尺原生共存；映射表仅用于排序聚合。
- **标签**：受控白名单，投稿只能选不能新建；改白名单需仓库写权限。
- **人员**：`handle` 必填公开、真名可空；显示为 `handle(真名)`。
- **版权**：外部内容全备份 + `redistribute` 开关，为未来公开留降级后门。
- **推荐度**：A+B——普通推荐不限量（派生加权平均推荐星级）+ 配额制"必做"徽章（保证稀缺）。

## 路线图（模块）

| 模块 | 状态 |
|---|---|
| M0 数据规范 | ✅ 已完成 |
| M1 内容仓库 | 🚧 进行中（已收录首题 CF2068A） |
| M2 构建管道（校验 + `data.json`） | ✅ 已完成 |
| M3 前端浏览站 | ✅ 已完成 |
| M4 Issue 投稿 → PR | ✅ 已完成 |
| M5 评论 / 点赞（Giscus） | 待办 |
| M6 可视化后台（可选） | 待办 |
| M7 兜底备份 / 镜像 / 死链检查 | 待办 |
| M8 CI/CD 与部署 | 待办 |
