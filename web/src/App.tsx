import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Dataset, Problem } from './types';
import { buildPeopleMap, difficultyLabel, personLabel, Stars, ThinkBar } from './helpers';
import { Markdown } from './Markdown';

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const route = useHashRoute();

  useEffect(() => {
    fetch(import.meta.env.BASE_URL + 'data.json')
      .then((r) => {
        if (!r.ok) throw new Error(`加载 data.json 失败：HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="center">{error}</div>;
  if (!data) return <div className="center">加载中…</div>;

  const people = buildPeopleMap(data.people);
  const m = route.match(/^#\/p\/(.+)$/);
  if (m) {
    const problem = data.problems.find((p) => p.id === decodeURIComponent(m[1]));
    if (problem) return <Detail problem={problem} data={data} people={people} />;
  }
  return <List data={data} people={people} />;
}

type SortKey = 'rating' | 'difficulty' | 'recommenders' | 'title';

function List({ data, people }: { data: Dataset; people: ReturnType<typeof buildPeopleMap> }) {
  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Set<string>>(new Set());
  const [mustDoOnly, setMustDoOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('rating');

  const topicCounts = useTagCounts(data.problems, 'topic');
  const reasonCounts = useTagCounts(data.problems, 'reason');

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    setter(next);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = data.problems.filter((p) => {
      if (q && !(`${p.id} ${p.slug} ${p.title}`.toLowerCase().includes(q))) return false;
      if (mustDoOnly && (p.must_do?.length ?? 0) === 0) return false;
      for (const t of topics) if (!(p.tags.topic ?? []).includes(t)) return false;
      for (const r of reasons) if (!(p.tags.reason ?? []).includes(r)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'rating':
          return (b.derived.weightedRating ?? 0) - (a.derived.weightedRating ?? 0);
        case 'difficulty':
          return (b.derived.difficultySort ?? 0) - (a.derived.difficultySort ?? 0);
        case 'recommenders':
          return b.derived.recommenderCount - a.derived.recommenderCount;
        case 'title':
          return a.title.localeCompare(b.title);
      }
    });
    return list;
  }, [data.problems, query, topics, reasons, mustDoOnly, sort]);

  return (
    <div className="wrap">
      <header className="site-header">
        <h1>DLUT CPC 精选题单</h1>
        <p className="sub">
          共 {data.counts.problems} 题 · {data.counts.people} 人 ·
          <span className="muted"> 数据生成于 {new Date(data.generatedAt).toLocaleString()}</span>
        </p>
      </header>

      <div className="toolbar">
        <input
          className="search"
          placeholder="搜索题号或标题…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="check">
          <input type="checkbox" checked={mustDoOnly} onChange={(e) => setMustDoOnly(e.target.checked)} />
          只看必做
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="rating">按推荐分</option>
          <option value="difficulty">按难度</option>
          <option value="recommenders">按推荐人数</option>
          <option value="title">按标题</option>
        </select>
      </div>

      <FacetRow label="主题" counts={topicCounts} selected={topics} onToggle={(v) => toggle(topics, setTopics, v)} />
      <FacetRow label="理由" counts={reasonCounts} selected={reasons} onToggle={(v) => toggle(reasons, setReasons, v)} />

      <div className="count-line">显示 {filtered.length} / {data.problems.length} 题</div>

      <div className="rows">
        {filtered.map((p) => (
          <ProblemRow key={p.id} p={p} data={data} people={people} />
        ))}
        {filtered.length === 0 && <div className="muted">没有匹配的题目。</div>}
      </div>
    </div>
  );
}

function useTagCounts(problems: Problem[], cat: 'topic' | 'reason'): Map<string, number> {
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const p of problems) for (const t of p.tags[cat] ?? []) m.set(t, (m.get(t) ?? 0) + 1);
    return new Map([...m.entries()].sort((a, b) => b[1] - a[1]));
  }, [problems, cat]);
}

function FacetRow({
  label,
  counts,
  selected,
  onToggle,
}: {
  label: string;
  counts: Map<string, number>;
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  if (counts.size === 0) return null;
  return (
    <div className="facets">
      <span className="facet-label">{label}</span>
      {[...counts.entries()].map(([tag, n]) => (
        <button
          key={tag}
          className={`chip ${selected.has(tag) ? 'chip-on' : ''}`}
          onClick={() => onToggle(tag)}
        >
          {tag} <span className="chip-n">{n}</span>
        </button>
      ))}
    </div>
  );
}

function RatingNum({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>;
  return (
    <span className="rating-num" title={`加权推荐分 ${value.toFixed(2)} / 5`}>
      ★ {value.toFixed(2)}
    </span>
  );
}

function ProblemRow({ p, data, people }: { p: Problem; data: Dataset; people: ReturnType<typeof buildPeopleMap> }) {
  const firstComment = p.recommenders.find((r) => r.comment)?.comment;
  return (
    <a className="row" href={`#/p/${encodeURIComponent(p.id)}`}>
      <div className="row-rating">
        <RatingNum value={p.derived.weightedRating} />
      </div>

      <div className="row-main">
        <div className="row-head">
          <span className="card-id">{p.id}</span>
          <span className="row-title">{p.title}</span>
          {(p.must_do?.length ?? 0) > 0 && <span className="badge-must">必做</span>}
          <span className="row-tags">
            {(p.tags.topic ?? []).map((t) => <span key={t} className="tag tag-topic">{t}</span>)}
            {(p.tags.reason ?? []).map((t) => <span key={`r-${t}`} className="tag tag-reason">{t}</span>)}
          </span>
        </div>
        {firstComment && <div className="row-comment">“{firstComment}”</div>}
      </div>

      <div className="row-meta">
        <div className="row-diff">
          {(p.difficulty ?? []).map((d, i) => (
            <span key={i} className={`diff diff-${d.scale}`}>{difficultyLabel(d, data.medalMap)}</span>
          ))}
          {p.derived.difficultySort != null && (
            <span className="diff diff-ref" title="按评价人权重的难度加权参考值（CF 等效）">
              参考 {p.derived.difficultySort}
            </span>
          )}
        </div>
        <div className="row-sub">
          <span>推荐 {p.derived.recommenderCount} 人</span>
          {p.derived.thinkingRatioAvg != null && (
            <span className="tr">思维<ThinkBar value={p.derived.thinkingRatioAvg} /></span>
          )}
          <span className="muted">{p.recommenders.map((r) => personLabel(r.handle, people)).join('、')}</span>
        </div>
      </div>
    </a>
  );
}

function Tabs({
  labels,
  render,
  collapsible = false,
}: {
  labels: string[];
  render: (i: number) => ReactNode;
  collapsible?: boolean;
}) {
  const [i, setI] = useState(0);
  // 可折叠时默认收起：只露出选择项，正文需点击才展开。
  const [open, setOpen] = useState(!collapsible);
  if (labels.length === 0) return null;
  const idx = Math.min(i, labels.length - 1);
  return (
    <div>
      <div className="tabs">
        {labels.map((l, k) => (
          <button
            key={k}
            className={`tab ${k === i && open ? 'tab-on' : ''}`}
            onClick={() => {
              setI(k);
              if (collapsible) setOpen(true);
            }}
          >
            {l}
          </button>
        ))}
        {collapsible && (
          <button
            className="tab-toggle"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? '收起 ▴' : '展开 ▾'}
          </button>
        )}
      </div>
      {open && (
        <div className="tab-body" key={idx}>
          {render(idx)}
        </div>
      )}
    </div>
  );
}

function Detail({ problem: p, data, people }: { problem: Problem; data: Dataset; people: ReturnType<typeof buildPeopleMap> }) {
  const statements = p.statements ?? [];
  const solutions = p.solutions ?? [];
  const kindLabel: Record<string, string> = { original: '原文', translation: '翻译', simplified: '简化' };

  return (
    <div className="wrap detail">
      <a className="back" href="#/">← 返回列表</a>
      <h1 className="detail-title">
        {p.title} <span className="detail-id">{p.id}</span>
        {(p.must_do?.length ?? 0) > 0 && <span className="badge-must">必做</span>}
      </h1>
      <div className="detail-sub">
        {p.source?.contest && <span>{p.source.contest}</span>}
        {p.source?.origin_platform && <span> · 来源 {p.source.origin_platform}</span>}
        {p.status?.availability && <span> · 状态 {p.status.availability}</span>}
      </div>

      <section>
        <h2>链接</h2>
        <ul className="links">
          {p.links.map((l, i) => (
            <li key={i}>
              <a href={l.url} target="_blank" rel="noreferrer">{l.platform}</a>
              {l.is_primary && <span className="muted"> （主）</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>推荐</h2>
        {p.recommenders.map((r, i) => (
          <div key={i} className="rec">
            <div className="rec-head">
              <b>{personLabel(r.handle, people)}</b>
              {r.strength != null && <Stars value={r.strength} />}
              {r.date && <span className="muted"> {r.date}</span>}
            </div>
            {r.comment && <div className="rec-comment">{r.comment}</div>}
          </div>
        ))}
      </section>

      <section className="two-col">
        <div>
          <h2>难度</h2>
          {(p.difficulty ?? []).map((d, i) => (
            <div key={i} className="diff-row">
              <span className={`diff diff-${d.scale}`}>{difficultyLabel(d, data.medalMap)}</span>
              <span className="muted"> — {personLabel(d.evaluator, people)}</span>
              {d.note && <span className="muted">（{d.note}）</span>}
            </div>
          ))}
          {p.derived.difficultySort != null && (
            <div className="muted">综合排序键 ≈ CF {p.derived.difficultySort}</div>
          )}
        </div>
        <div>
          <h2>思维 / 实现</h2>
          {p.derived.thinkingRatioAvg != null ? (
            <div className="tr-detail">
              <ThinkBar value={p.derived.thinkingRatioAvg} />
              <span className="muted">
                思维 {p.derived.thinkingRatioAvg} · 实现 {(10 - p.derived.thinkingRatioAvg).toFixed(1)}
              </span>
            </div>
          ) : (
            <span className="muted">暂无评价</span>
          )}
        </div>
      </section>

      <section>
        <h2>标签</h2>
        <div className="card-tags">
          {(p.tags.topic ?? []).map((t) => <span key={t} className="tag tag-topic">{t}</span>)}
          {(p.tags.reason ?? []).map((t) => <span key={t} className="tag tag-reason">{t}</span>)}
        </div>
        {(p.must_do?.length ?? 0) > 0 && (
          <div className="muted">必做徽章：{p.must_do!.map((h) => personLabel(h, people)).join('、')}</div>
        )}
      </section>

      {statements.length > 0 && (
        <section>
          <h2>题面</h2>
          <Tabs
            collapsible
            labels={statements.map((s) => `${kindLabel[s.kind] ?? s.kind}·${s.lang}`)}
            render={(i) => (
              <div>
                <div className="src-note">
                  {statements[i].source_url && (
                    <a href={statements[i].source_url} target="_blank" rel="noreferrer">来源</a>
                  )}
                  {statements[i].license && <span className="muted"> · {statements[i].license}</span>}
                </div>
                <Markdown source={statements[i].content} />
              </div>
            )}
          />
        </section>
      )}

      {solutions.length > 0 && (
        <section>
          <h2>题解</h2>
          <Tabs
            collapsible
            labels={solutions.map((s) => personLabel(s.author, people))}
            render={(i) => <Markdown source={solutions[i].content} />}
          />
        </section>
      )}

      {(p.related?.length ?? 0) > 0 && (
        <section>
          <h2>关联题目</h2>
          <ul>
            {p.related!.map((r, i) => (
              <li key={i}>
                <a href={`#/p/${encodeURIComponent(r.id)}`}>{r.id}</a>
                <span className="muted"> — {r.relation}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
