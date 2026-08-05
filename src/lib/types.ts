/** Named look-back windows, in seconds, for LinkedIn's f_TPR filter. */
export const TIME_WINDOWS = {
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '8h': 28800,
  '24h': 86400,
} as const;

export type TimeWindow = keyof typeof TIME_WINDOWS;

/** LinkedIn's f_WT workplace codes. */
export const WORKPLACE = {
  '1': 'On-site',
  '2': 'Remote',
  '3': 'Hybrid',
} as const;

export type WorkplaceCode = keyof typeof WORKPLACE;

/** LinkedIn's f_E experience codes. */
export const EXPERIENCE = {
  '1': 'Internship',
  '2': 'Entry level',
  '3': 'Associate',
  '4': 'Mid-Senior',
  '5': 'Director',
  '6': 'Executive',
} as const;

export type ExperienceCode = keyof typeof EXPERIENCE;

export interface Job {
  id: string;
  title: string;
  company: string | null;
  companyUrl: string | null;
  location: string | null;
  url: string;
  postedAt: string | null;
  postedLabel: string | null;
  salary: string | null;
  logo: string | null;
}

/** A saved search. Lives in localStorage; never leaves the browser. */
export interface Watch {
  id: string;
  keywords: string;
  location: string;
  window: TimeWindow;
  remote: WorkplaceCode[];
  experience: ExperienceCode[];
  enabled: boolean;
  createdAt: number;
}

/** A job as stored client-side, tagged with which watch surfaced it. */
export interface SeenJob extends Job {
  watchId: string;
  firstSeenAt: number;
  read: boolean;
}

/**
 * Per-request health, surfaced so the client-side governor can distinguish a
 * healthy endpoint from a throttling one without re-inspecting responses.
 */
export interface FetchStats {
  requests: number;
  full: number;
  truncated: number;
}

export type SearchResponse =
  | { status: 'ok'; jobs: Job[]; stats: FetchStats }
  | { status: 'rate-limited'; retryAfterMs: number; message: string }
  | { status: 'error'; message: string };
