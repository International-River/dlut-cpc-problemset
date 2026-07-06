import type { Difficulty, MedalInfo, Person } from './types';

export function buildPeopleMap(people: Person[]): Map<string, Person> {
  const m = new Map<string, Person>();
  for (const p of people) m.set(p.handle, p);
  return m;
}

export function personLabel(handle: string, people: Map<string, Person>): string {
  const p = people.get(handle);
  if (p?.name) return `${handle}（${p.name}）`;
  return handle;
}

export function difficultyLabel(d: Difficulty, medalMap: Record<string, MedalInfo>): string {
  if (d.scale === 'cf') return `CF ${d.value}`;
  const info = medalMap[String(d.value)];
  return info ? info.label : String(d.value);
}

// 加权评分的星级组件（支持小数，用双层叠加实现半星填充）。
export function Stars({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>;
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className="stars" title={`${value.toFixed(2)} / 5`}>
      <span className="stars-bg">★★★★★</span>
      <span className="stars-fg" style={{ width: `${pct}%` }}>★★★★★</span>
    </span>
  );
}

// 思维/实现占比条：value 为思维份数（0-10），实现 = 10 - value。
export function ThinkBar({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>;
  const think = Math.round(value * 10);
  return (
    <span className="thinkbar" title={`思维 ${value.toFixed(1)} / 实现 ${(10 - value).toFixed(1)}`}>
      <span className="thinkbar-think" style={{ width: `${think}%` }} />
      <span className="thinkbar-impl" style={{ width: `${100 - think}%` }} />
    </span>
  );
}
