import { VERSIONS } from './tasks.js';

export const SCHEMA_VERSION = 1;
export const RECORD_PREFIX = 'cognitive-test:assessment:';
const PROFILE_KEY = 'cognitive-test:profile';

export function localTimestamp(date = new Date()) {
  const offset = -date.getTimezoneOffset();
  const pad = value => String(value).padStart(2, '0');
  const year = String(date.getFullYear()).padStart(4, '0');
  const fraction = date.getMilliseconds() ? '.' + String(date.getMilliseconds()).padStart(3, '0') : '';
  return `${year}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${fraction}` +
    `${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

export function stamp(date = new Date()) {
  return { timestamp: localTimestamp(date), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

export function newAssessment(id = crypto.randomUUID()) {
  return {
    schemaVersion: SCHEMA_VERSION, assessmentId: id, ...stamp(),
    testVersions: { ...VERSIONS }, tests: Object.fromEntries(Object.keys(VERSIONS).map(key => [key, null])),
  };
}

export function getProfileId(storage, fallback) {
  try {
    const existing = storage.getItem(PROFILE_KEY);
    if (existing) return existing;
    storage.setItem(PROFILE_KEY, fallback);
  } catch {
    // The page can still export an assessment without persistent storage.
  }
  return fallback;
}

export function createStore(storage) {
  return {
    save(record) { storage.setItem(RECORD_PREFIX + record.assessmentId, assessmentJSON(record)); },
    remove(id) { storage.removeItem(RECORD_PREFIX + id); },
    list() {
      const records = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(RECORD_PREFIX)) continue;
        try {
          const record = JSON.parse(storage.getItem(key));
          if (record?.schemaVersion === SCHEMA_VERSION && record.tests &&
              key === RECORD_PREFIX + record.assessmentId && Number.isFinite(Date.parse(record.timestamp))) {
            records.push(record);
          }
        } catch {
          // A malformed record should not hide the rest of the history.
        }
      }
      return records.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    },
  };
}

export function assessmentJSON(record) {
  return JSON.stringify(record, null, 2);
}

export function historyJSON(records) {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, assessments: records }, null, 2);
}

export const round = value => value == null ? '—' : String(Math.round(value));
export const ms = value => value == null ? '—' : `${round(value)} ms`;
export const percent = value => value == null ? '—' : `${round(value * 100)}%`;

export const REASONS = {
  hidden: 'The page became hidden.',
  'focus-lost': 'The window lost focus.',
  'page-exit': 'The page was closed or left.',
  'timing-gap': 'The browser stopped updating reliably.',
  'unclean-exit': 'The run ended before the result could be saved.',
  cancelled: 'You cancelled the run.',
};

export function setupLabel(test) {
  return [test.device.deviceClass, test.device.browser, test.inputTypes.join(' / ') || 'no input'].join(' · ');
}

export function journalSummary(record) {
  const { clarity, pvt, sdmt, pattern, arrow } = record.tests;
  const lines = ['Mental Check-In', `Timestamp: ${record.timestamp}`, `Timezone: ${record.timeZone}`, ''];
  if (clarity) lines.push(`Clarity: ${clarity.rating}/10`);
  if (pvt?.summary) {
    const r = pvt.summary;
    lines.push(`PVT median: ${ms(r.medianMs)}`, `PVT mean: ${ms(r.meanMs)}`,
      `PVT p90: ${ms(r.p90Ms)}`, `PVT lapses: ${r.lapses}`,
      `PVT false starts: ${r.falseStarts}`, `PVT setup: ${setupLabel(pvt)}`);
  } else if (pvt) lines.push(`PVT: ${pvt.status} (${REASONS[pvt.reason]})`);
  if (sdmt?.summary) {
    const r = sdmt.summary;
    lines.push(`SDMT-style correct: ${r.correct}/${r.attempts}`,
      `SDMT-style accuracy: ${percent(r.accuracy)}`, `SDMT-style setup: ${setupLabel(sdmt)}`);
  } else if (sdmt) lines.push(`SDMT-style: ${sdmt.status} (${REASONS[sdmt.reason]})`);
  if (pattern?.summary) {
    const r = pattern.summary;
    lines.push(`Pattern Recall: ${r.correct}/${r.attempts} sequences; longest correct: ${round(r.longest)}`);
  } else if (pattern) lines.push(`Pattern Recall: ${pattern.status} (${REASONS[pattern.reason]})`);
  if (arrow?.summary) {
    const r = arrow.summary;
    lines.push(`Arrow Focus: ${r.correct}/${r.attempts} correct; distraction cost: ${ms(r.distractionMs)}`);
  } else if (arrow) lines.push(`Arrow Focus: ${arrow.status} (${REASONS[arrow.reason]})`);
  return lines.join('\n');
}

export function historyCSV(records) {
  const extra = [
    ['pattern', [['correct', 'correct'], ['attempts', 'attempts'], ['longest', 'longest']]],
    ['arrow', [['correct', 'correct'], ['attempts', 'attempts'], ['accuracy', 'accuracy'],
      ['matching_ms', 'matchingMs'], ['conflicting_ms', 'conflictingMs'], ['distraction_ms', 'distractionMs']]],
  ];
  const columns = [
    'assessment_id', 'timestamp', 'timezone', 'clarity', 'clarity_timestamp',
    'pvt_timestamp', 'pvt_status', 'pvt_reason', 'pvt_duration_ms', 'pvt_elapsed_ms', 'pvt_median_ms',
    'pvt_mean_ms', 'pvt_p90_ms', 'pvt_lapses', 'pvt_false_starts', 'pvt_timeouts',
    'pvt_version', 'pvt_profile', 'pvt_device_class', 'pvt_browser', 'pvt_input',
    'sdmt_timestamp', 'sdmt_status', 'sdmt_reason', 'sdmt_duration_ms', 'sdmt_elapsed_ms',
    'sdmt_correct', 'sdmt_incorrect', 'sdmt_attempts', 'sdmt_accuracy', 'sdmt_correct_per_minute',
    'sdmt_version', 'sdmt_profile', 'sdmt_device_class', 'sdmt_browser', 'sdmt_input',
    ...extra.flatMap(([key, metrics]) => [
      'timestamp', 'status', 'reason', 'duration_ms', 'elapsed_ms', ...metrics.map(([column]) => column),
      'version', 'profile', 'device_class', 'browser', 'input',
    ].map(column => `${key}_${column}`)),
  ];
  const rows = records.map(record => {
    const { clarity, pvt, sdmt } = record.tests;
    return [record.assessmentId, record.timestamp, record.timeZone, clarity?.rating, clarity?.timestamp,
      pvt?.timestamp, pvt?.status, pvt?.reason, pvt?.durationMs, pvt?.elapsedMs,
      pvt?.summary?.medianMs, pvt?.summary?.meanMs, pvt?.summary?.p90Ms,
      pvt?.summary?.lapses, pvt?.summary?.falseStarts, pvt?.summary?.timeouts,
      pvt && record.testVersions.pvt, pvt?.device.profileId, pvt?.device.deviceClass,
      pvt?.device.browser, pvt?.inputTypes.join('/'),
      sdmt?.timestamp, sdmt?.status, sdmt?.reason, sdmt?.durationMs, sdmt?.elapsedMs,
      sdmt?.summary?.correct, sdmt?.summary?.incorrect, sdmt?.summary?.attempts,
      sdmt?.summary?.accuracy, sdmt?.summary?.correctPerMinute,
      sdmt && record.testVersions.sdmt, sdmt?.device.profileId, sdmt?.device.deviceClass,
      sdmt?.device.browser, sdmt?.inputTypes.join('/'),
      ...extra.flatMap(([key, metrics]) => {
        const test = record.tests[key];
        return [test?.timestamp, test?.status, test?.reason, test?.durationMs, test?.elapsedMs,
          ...metrics.map(([, metric]) => test?.summary?.[metric]), test && record.testVersions[key],
          test?.device.profileId, test?.device.deviceClass, test?.device.browser, test?.inputTypes.join('/')];
      })];
  });
  return [columns, ...rows].map(row => row.map(value => {
    const cell = String(value ?? '');
    return /[",\r\n]/.test(cell) ? '"' + cell.replaceAll('"', '""') + '"' : cell;
  }).join(',')).join('\r\n') + '\r\n';
}
