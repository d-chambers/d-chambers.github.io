import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, interruptionReason, makeMapping, scorePvt, scoreSdmt, SYMBOLS } from '../src/tasks.js';

test('PVT boundaries, feedback, repeat input and scoring', () => {
  const run = createRun('pvt', 0, { random: () => 0 });
  run.respond(500, 'keyboard');
  run.respond(501, 'mouse');
  run.frame(1_499);
  assert.equal(run.state.phase, 'feedback');
  run.frame(1_500);
  run.respond(1_599, 'keyboard');
  run.frame(2_599);
  run.respond(2_699, 'keyboard');
  run.frame(3_699);
  run.respond(4_053, 'mouse');
  run.frame(5_053);
  run.respond(5_408, 'touch');
  run.frame(60_000);

  const result = run.result();
  assert.deepEqual(result.inputTypes, ['keyboard', 'mouse', 'touch']);
  assert.deepEqual(result.raw.trials.map(trial => trial.rtMs), [null, 99, 100, 354, 355]);
  assert.deepEqual(result.summary, {
    medianMs: 354, meanMs: 809 / 3, p90Ms: 354.8, lapses: 1, falseStarts: 2, timeouts: 0,
  });
});

test('PVT timeout and an in-flight trial at the deadline have different outcomes', () => {
  const run = createRun('pvt', 0, { random: () => 0.5 });
  run.frame(2_499);
  assert.equal(run.state.phase, 'waiting');
  run.frame(2_500);
  run.frame(32_500);
  run.frame(59_950);
  run.respond(60_000, 'touch');
  const result = run.result();
  assert.equal(result.elapsedMs, 60_000);
  assert.equal(result.status, 'valid');
  assert.deepEqual(result.raw.trials.map(trial => trial.kind), ['timeout', 'truncated']);
  assert.deepEqual(result.summary, {
    medianMs: 30_000, meanMs: 30_000, p90Ms: 30_000, lapses: 1, falseStarts: 0, timeouts: 1,
  });
  assert.equal(scorePvt([]).medianMs, null);
});

test('SDMT maps nine symbols, measures responses once per prompt, and rejects late input', () => {
  const mapping = makeMapping(() => 0);
  assert.deepEqual(new Set(mapping), new Set(SYMBOLS));
  assert.notDeepEqual(mapping, SYMBOLS);
  const run = createRun('sdmt', 100, { mapping, random: () => 0 });
  run.respond(102, 'keyboard', 1);
  run.frame(103);
  assert.equal(run.state.symbol, mapping[0]);
  run.respond(403, 'keyboard', 1);
  run.respond(404, 'touch', 3);
  run.frame(409);
  assert.equal(run.state.symbol, mapping[1]);
  run.respond(709, 'touch', 3);
  run.frame(719);
  run.respond(90_100, 'touch', 2);
  assert.deepEqual(run.result().summary, {
    correct: 1, incorrect: 1, attempts: 2, accuracy: 0.5, correctPerMinute: 2 / 3,
  });
  assert.deepEqual(run.result().raw.trials.map(trial => trial.rtMs), [300, 300]);
  assert.deepEqual(scoreSdmt([], 90_000), { correct: 0, incorrect: 0, attempts: 0, accuracy: null, correctPerMinute: 0 });
});

test('practice durations, interruptions, and cancellation never promote partial results', () => {
  const mapping = makeMapping();
  const practice = createRun('sdmt', 10, { practice: true, mapping });
  assert.equal(practice.duration, 15_000);
  practice.frame(10);
  practice.respond(400, 'touch', 1);
  practice.interrupt(500, 'hidden');
  practice.frame(15_010);
  assert.equal(practice.result().status, 'invalid');
  assert.equal(practice.result().reason, 'hidden');
  assert.equal(practice.result().elapsedMs, 490);
  assert.equal(practice.result().raw.trials.length, 1);
  assert.equal(practice.result().summary, null);

  const pvt = createRun('pvt', 0, { practice: true });
  assert.equal(pvt.duration, 20_000);
  pvt.cancel(350);
  pvt.interrupt(500, 'hidden');
  assert.equal(pvt.result().status, 'cancelled');
  assert.equal(pvt.result().summary, null);
  assert.equal(interruptionReason({ hidden: true }), 'hidden');
  assert.equal(interruptionReason({ frameGapMs: 1_001, clockDriftMs: 0 }), 'timing-gap');
  assert.equal(interruptionReason({ frameGapMs: 10, clockDriftMs: -1_001 }), 'timing-gap');
  assert.equal(interruptionReason({ frameGapMs: 20, clockDriftMs: 5 }), null);
});

test('Pattern Recall lets a sequence finish after the clock expires and highlights entered tiles', () => {
  const run = createRun('pattern', 0, { random: () => 0 });
  run.frame(600);
  const sequence = [run.state.tile];
  run.respond(650, 'touch', sequence[0]);
  for (let shown = 0; shown < 3; shown++) {
    run.frame(1050 + 630 * shown);
    assert.equal(run.state.tile, null);
    run.frame(1230 + 630 * shown);
    if (run.state.tile !== null) sequence.push(run.state.tile);
  }
  assert.equal(new Set(sequence).size, 3);
  assert.equal(run.state.phase, 'recall');
  sequence.forEach((tile, i) => {
    run.respond(2_600 + i * 100, 'keyboard', tile);
    assert.equal(run.state.tile, tile);
  });
  assert.equal(run.state.feedback, 'Correct');

  run.frame(29_950);
  const finalSequence = [run.state.tile];
  run.frame(30_000);
  assert.equal(run.state.status, 'running');
  for (let shown = 0; shown < 4; shown++) {
    run.frame(30_400 + 630 * shown);
    run.frame(30_580 + 630 * shown);
    if (run.state.tile !== null) finalSequence.push(run.state.tile);
  }
  assert.equal(run.state.phase, 'recall');
  finalSequence.forEach((tile, i) => run.respond(32_600 + i * 100, 'keyboard', tile));
  assert.equal(run.state.tile, finalSequence.at(-1));
  assert.equal(run.state.status, 'running');
  run.frame(33_080);
  const result = run.result();
  assert.equal(result.elapsedMs, 33_080);
  assert.deepEqual(result.inputTypes, ['keyboard']);
  assert.deepEqual(result.summary, { correct: 2, attempts: 2, longest: 4 });
  assert.equal(result.raw.trials.length, 2);
  assert.equal(result.raw.trials[1].outcome, 'correct');
});

test('Pattern Recall ends the round at the first wrong tile', () => {
  const run = createRun('pattern', 0, { random: () => 0 });
  run.frame(600);
  const first = run.state.tile;
  for (const time of [1050, 1230, 1680, 1860, 2310, 2490]) run.frame(time);
  run.respond(2_500, 'mouse', first === 1 ? 2 : 1);
  assert.equal(run.state.feedback, 'Missed that one');
  run.respond(2_600, 'mouse', first);
  run.frame(2_680);
  assert.equal(run.state.tile, null);
  run.frame(30_000);
  assert.equal(run.result().elapsedMs, 30_000);
  assert.deepEqual(run.result().summary, { correct: 0, attempts: 1, longest: null });
  assert.equal(run.result().raw.trials[0].responses.length, 1);
});

test('Arrow Focus balances conditions, scores both medians, and ignores late responses', () => {
  const run = createRun('arrow', 0, { random: () => 0 });
  let now = 350;
  for (let i = 0; i < 4; i++) {
    run.frame(now);
    const { direction, matching } = run.state.trial;
    const latency = matching ? 250 : 400;
    run.respond(now + latency, 'keyboard', direction);
    run.respond(now + latency + 1, 'touch', direction);
    now += latency + 200;
  }
  run.frame(now);
  run.respond(now + 2_000, 'mouse', run.state.trial.direction);
  run.frame(now + 2_000);
  run.frame(now + 2_200);
  run.frame(30_000);
  const result = run.result();
  assert.equal(result.elapsedMs, 30_000);
  assert.deepEqual(result.inputTypes, ['keyboard']);
  assert.equal(new Set(result.raw.trials.slice(0, 4).map(t => `${t.direction}-${t.matching}`)).size, 4);
  assert.deepEqual(result.summary, {
    correct: 4, attempts: 6, accuracy: 4 / 6, matchingMs: 250, conflictingMs: 400, distractionMs: 150,
  });
});

test('new task practice and interruptions keep incomplete scores out of history', () => {
  for (const task of ['pattern', 'arrow']) {
    const run = createRun(task, 0, { practice: true });
    run.frame(650);
    run.interrupt(700, 'hidden');
    assert.equal(run.result().durationMs, 15_000);
    assert.equal(run.result().summary, null);
    assert.equal(run.result().raw.trials[0].outcome, 'truncated');
  }
});
