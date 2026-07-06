export interface Person {
  handle: string;
  name?: string;
  role?: string;
  reserved?: boolean;
}

export interface Link {
  platform: string;
  url: string;
  is_primary?: boolean;
}

export interface Recommender {
  handle: string;
  comment?: string;
  date?: string;
  strength?: number;
}

export interface Difficulty {
  evaluator: string;
  scale: 'cf' | 'medal';
  value: number | string;
  date?: string;
  note?: string;
}

export interface ThinkingRatio {
  evaluator: string;
  value: number;
  date?: string;
}

export interface Statement {
  file: string;
  kind: 'original' | 'translation' | 'simplified';
  lang: string;
  source_url?: string;
  license?: string;
  author?: string;
  redistribute?: boolean;
  content?: string | null;
}

export interface Solution {
  file: string;
  author: string;
  kind?: 'editorial' | 'community';
  lang?: string;
  date?: string;
  source_url?: string;
  license?: string;
  redistribute?: boolean;
  content?: string | null;
}

export interface Related {
  id: string;
  relation: string;
}

export interface Derived {
  weightedRating: number | null;
  recommenderCount: number;
  difficultySort: number | null;
  difficultyCount: number;
  thinkingRatioAvg: number | null;
  mustDoCount: number;
}

export interface Problem {
  id: string;
  slug: string;
  title: string;
  source?: { contest?: string; origin_platform?: string };
  links: Link[];
  recommenders: Recommender[];
  tags: { topic?: string[]; reason?: string[] };
  difficulty?: Difficulty[];
  thinking_ratio?: ThinkingRatio[];
  statements?: Statement[];
  solutions?: Solution[];
  related?: Related[];
  must_do?: string[];
  status?: { availability?: string; last_checked?: string };
  meta?: { created?: string; updated?: string; added_by?: string };
  derived: Derived;
}

export interface MedalInfo {
  rating: number;
  label: string;
}

export interface Dataset {
  generatedAt: string;
  counts: { problems: number; people: number };
  people: Person[];
  tags: { topic: string[]; reason: string[] };
  medalMap: Record<string, MedalInfo>;
  problems: Problem[];
}
