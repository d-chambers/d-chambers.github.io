import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessmentJSON, createStore, getProfileId, historyCSV, historyJSON, journalSummary, localTimestamp, newAssessment,
} from '../src/records.js';

test('ISO timestamps keep instant, fractional seconds, DST and fractional offsets', () => {
  const dates = ['2026-01-19T14:42:18Z', '2026-07-19T14:42:18.123Z'];
  const originalZone = process.env.TZ;
  function formatIn(zone) {
    process.env.TZ = zone;
    return dates.map(value => localTimestamp(new Date(value)));
  }
  try {
    assert.deepEqual(formatIn('Europe/Paris'), ['2026-01-19T15:42:18+01:00', '2026-07-19T16:42:18.123+02:00']);
    assert.deepEqual(formatIn('America/St_Johns'), ['2026-01-19T11:12:18-03:30', '2026-07-19T12:12:18.123-02:30']);
    assert.deepEqual(formatIn('UTC').map(Date.parse), dates.map(Date.parse));
  } finally {
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
  }
});

test('JSON preserves identity, versions, metadata, raw trials, invalid flags and null tests', () => {
  const record = newAssessment('demo');
  assert.equal(record.tests.pvt, null);
  record.tests.clarity = { rating: 0, status: 'valid' };
  record.tests.pvt = {
    status: 'invalid', reason: 'hidden', summary: null,
    device: { profileId: 'profile', deviceClass: 'desktop', browser: 'Firefox 142' },
    raw: { trials: [{ kind: 'response', rtMs: 210.44, inputType: 'keyboard' }] },
    inputTypes: ['keyboard'],
  };
  const exported = JSON.parse(assessmentJSON(record));
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.assessmentId, 'demo');
  assert.equal(exported.testVersions.pvt, '2.0.0');
  assert.equal(exported.tests.sdmt, null);
  assert.equal(exported.tests.pvt.raw.trials[0].rtMs, 210.44);
  assert.deepEqual(JSON.parse(historyJSON([record])).assessments, [record]);
  assert.match(journalSummary(record), /Clarity: 0\/10\nPVT: invalid/);
  const csv = historyCSV([record]);
  assert.match(csv, /pvt_p90_ms/);
  assert.match(csv, /,0,,,invalid,hidden,/);
  assert.match(csv, /Firefox 142,keyboard/);
});

test('one local key per assessment supports independent writes and deletion', () => {
  const values = new Map();
  const storage = {
    setItem: (key, value) => values.set(key, value),
    getItem: key => values.get(key),
    removeItem: key => values.delete(key),
    key: index => [...values.keys()][index],
    get length() { return values.size; },
  };
  const store = createStore(storage);
  const first = newAssessment('first');
  const second = newAssessment('second');
  first.timestamp = '2026-11-19T10:00:00+01:00';
  second.timestamp = '2026-11-19T09:45:00+00:00';
  assert.equal(getProfileId(storage, 'profile'), 'profile');
  assert.equal(getProfileId(storage, 'different'), 'profile');
  store.save(first);
  store.save(second);
  storage.setItem('cognitive-test:assessment:broken', 'bad data');
  assert.deepEqual(store.list(), [second, first]);
  store.remove(first.assessmentId);
  assert.deepEqual(store.list(), [second]);
});

test('history exports the new activities while preserving old reaction-time records', () => {
  const older = newAssessment('older');
  older.testVersions.pvt = '1.0.0';
  delete older.tests.pattern;
  delete older.tests.arrow;
  const recent = newAssessment('recent');
  const metadata = { status: 'valid', durationMs: 30_000, elapsedMs: 30_000, inputTypes: ['touch'],
    device: { profileId: 'profile', deviceClass: 'mobile', browser: 'Chrome 149' } };
  recent.tests.pattern = { ...metadata, summary: { correct: 2, attempts: 3, longest: 4 } };
  recent.tests.arrow = { ...metadata, summary: {
    correct: 4, attempts: 5, accuracy: 0.8, matchingMs: 250, conflictingMs: 300, distractionMs: 50,
  } };
  const csv = historyCSV([older, recent]).trimEnd().split('\r\n').map(row => row.split(','));
  const [header, oldRow, newRow] = csv;
  assert.equal(oldRow.length, header.length);
  assert.equal(newRow.length, header.length);
  assert.equal(oldRow[header.indexOf('pattern_longest')], '');
  assert.equal(newRow[header.indexOf('pattern_longest')], '4');
  assert.equal(newRow[header.indexOf('arrow_distraction_ms')], '50');
  assert.match(journalSummary(recent), /Pattern Recall: 2\/3/);
  assert.match(journalSummary(recent), /Arrow Focus: 4\/5/);
  assert.equal(JSON.parse(historyJSON([older])).assessments[0].testVersions.pvt, '1.0.0');
});
