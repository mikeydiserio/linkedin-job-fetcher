import { useState, type FormEvent } from 'react';

import type { WatchDraft } from '@hooks/useWatches';
import {
  EXPERIENCE,
  TIME_WINDOWS,
  WORKPLACE,
  type ExperienceCode,
  type TimeWindow,
  type WorkplaceCode,
} from '@lib/types';

import s from './WatchForm.module.css';

interface WatchFormProps {
  onSubmit: (draft: WatchDraft) => void;
}

const WINDOW_LABELS: Record<TimeWindow, string> = {
  '1h': 'Past hour',
  '2h': 'Past 2 hours',
  '4h': 'Past 4 hours',
  '8h': 'Past 8 hours',
  '24h': 'Past 24 hours',
};

const EMPTY: WatchDraft = {
  keywords: '',
  location: '',
  window: '1h',
  remote: [],
  experience: [],
};

export function WatchForm({ onSubmit }: WatchFormProps) {
  const [draft, setDraft] = useState<WatchDraft>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  function toggle<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!draft.keywords.trim()) {
      setError('Keywords are required.');
      return;
    }
    setError(null);
    onSubmit({ ...draft, keywords: draft.keywords.trim(), location: draft.location.trim() });
    setDraft(EMPTY);
  }

  return (
    <form className={s.form} onSubmit={handleSubmit} autoComplete="off">
      <label className={s.field}>
        <span className={s.label}>Job title / keywords</span>
        <input
          className={s.input}
          value={draft.keywords}
          onChange={(e) => setDraft((d) => ({ ...d, keywords: e.target.value }))}
          placeholder="front-end developer"
          maxLength={120}
          required
        />
      </label>

      <label className={s.field}>
        <span className={s.label}>Location</span>
        <input
          className={s.input}
          value={draft.location}
          onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
          placeholder="Melbourne, Victoria, Australia"
          maxLength={120}
        />
      </label>

      <label className={s.field}>
        <span className={s.label}>Look back</span>
        <select
          className={s.input}
          value={draft.window}
          onChange={(e) => setDraft((d) => ({ ...d, window: e.target.value as TimeWindow }))}
        >
          {(Object.keys(TIME_WINDOWS) as TimeWindow[]).map((key) => (
            <option key={key} value={key}>
              {WINDOW_LABELS[key]}
            </option>
          ))}
        </select>
      </label>

      <fieldset className={s.fieldset}>
        <legend className={s.legend}>Workplace</legend>
        <div className={s.checks}>
          {(Object.keys(WORKPLACE) as WorkplaceCode[]).map((code) => (
            <label key={code} className={s.check}>
              <input
                type="checkbox"
                checked={draft.remote.includes(code)}
                onChange={() => setDraft((d) => ({ ...d, remote: toggle(d.remote, code) }))}
              />
              {WORKPLACE[code]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={s.fieldset}>
        <legend className={s.legend}>Experience</legend>
        <div className={s.checks}>
          {(Object.keys(EXPERIENCE) as ExperienceCode[]).map((code) => (
            <label key={code} className={s.check}>
              <input
                type="checkbox"
                checked={draft.experience.includes(code)}
                onChange={() => setDraft((d) => ({ ...d, experience: toggle(d.experience, code) }))}
              />
              {EXPERIENCE[code]}
            </label>
          ))}
        </div>
      </fieldset>

      <button type="submit" className={s.submit}>
        Add watch
      </button>
      {error ? <p className={s.error}>{error}</p> : null}
    </form>
  );
}
