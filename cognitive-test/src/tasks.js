export const VERSIONS = Object.freeze({
  clarity: '1.0.0', pvt: '2.0.0', sdmt: '1.0.0', pattern: '1.1.0', arrow: '1.0.0',
});
export const TASKS = {
  pvt: { duration: 60_000, practice: 20_000, title: 'Visual reaction time',
    instruction: 'Use the response area or Space when the blue target appears.' },
  sdmt: { duration: 90_000, practice: 15_000, title: 'Symbol matching',
    instruction: 'Match the symbol to its digit.' },
  pattern: { duration: 30_000, practice: 15_000, title: 'Pattern Recall',
    instruction: 'Watch the tiles light up, then tap them in order or use the matching number keys.' },
  arrow: { duration: 30_000, practice: 15_000, title: 'Arrow Focus',
    instruction: 'Which way does the middle arrow point? Tap Left or Right, or use the arrow keys.' },
};
export const PVT = { minRt: 100, lapse: 355, timeout: 30_000, feedback: 1_000 };
export const SYMBOLS = [
  'circle', 'triangle', 'square', 'diamond', 'plus', 'cross', 'bars', 'chevron', 'ring',
];

function shuffle(values, random) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function makeMapping(random = Math.random) {
  return shuffle(SYMBOLS, random);
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}

export function scorePvt(trials) {
  const times = trials.filter(trial => ['response', 'timeout'].includes(trial.kind))
    .map(trial => trial.rtMs).sort((a, b) => a - b);
  return {
    medianMs: percentile(times, 0.5),
    meanMs: times.length ? times.reduce((sum, value) => sum + value, 0) / times.length : null,
    p90Ms: percentile(times, 0.9),
    lapses: times.filter(time => time >= PVT.lapse).length,
    falseStarts: trials.filter(trial => trial.kind === 'false-start').length,
    timeouts: trials.filter(trial => trial.kind === 'timeout').length,
  };
}

export function scoreSdmt(trials, durationMs) {
  const correct = trials.filter(trial => trial.correct).length;
  return {
    correct,
    incorrect: trials.length - correct,
    attempts: trials.length,
    accuracy: trials.length ? correct / trials.length : null,
    correctPerMinute: durationMs > 0 ? correct * 60_000 / durationMs : null,
  };
}

export function createRun(task, start, { practice = false, mapping, random = Math.random } = {}) {
  const duration = TASKS[task][practice ? 'practice' : 'duration'];
  if (task === 'pattern' || task === 'arrow') {
    return createShortRun(task === 'pattern' ? patternTask(start, random) : arrowTask(start, random), start, duration);
  }
  const deadline = start + duration;
  const trials = [];
  const inputTypes = new Set();
  let phase = task === 'pvt' ? 'waiting' : 'next';
  let due = start + (task === 'pvt' ? PVT.feedback + random() * 3_000 : 0);
  let trialStarted = null;
  let digit = null;
  let lastDigit = null;
  let feedback = '';
  let feedbackEnd = start;
  let status = 'running';
  let reason = null;
  let ended = null;

  function finish(now, outcome = 'valid', why = null) {
    if (status !== 'running') return;
    ended = Math.min(now, deadline);
    if (task === 'pvt' && phase === 'stimulus') {
      trials.push({ kind: 'truncated', onsetMs: trialStarted - start, endedMs: ended - start });
    }
    status = outcome;
    reason = why;
  }

  function pvtFeedback(now, text) {
    phase = 'feedback';
    feedback = text;
    feedbackEnd = now + PVT.feedback;
    due = feedbackEnd + random() * 3_000;
    trialStarted = null;
  }

  function advance(now, reveal = false) {
    if (status !== 'running') return;
    if (task === 'pvt' && phase === 'stimulus' &&
        trialStarted + PVT.timeout <= Math.min(now, deadline)) {
      trials.push({ kind: 'timeout', onsetMs: trialStarted - start, rtMs: PVT.timeout });
      pvtFeedback(trialStarted + PVT.timeout, 'No response');
    }
    if (now >= deadline) {
      finish(deadline);
      return;
    }
    if (phase === 'feedback' && now >= feedbackEnd) phase = 'waiting';
    if (!reveal) return;
    if (phase === 'next') {
      // Draw independently while keeping consecutive prompts visibly distinct.
      const choices = lastDigit === null ? 9 : 8;
      digit = 1 + Math.floor(random() * choices);
      if (lastDigit !== null && digit >= lastDigit) digit++;
      lastDigit = digit;
      phase = 'symbol';
      trialStarted = now;
    } else if (phase === 'waiting' && now >= due) {
      phase = 'stimulus';
      trialStarted = now;
    }
  }

  function respond(now, inputType, answer) {
    advance(now);
    if (status !== 'running') return;
    if (task === 'sdmt') {
      if (phase !== 'symbol' || !Number.isInteger(answer) || answer < 1 || answer > 9) return;
      trials.push({
        symbol: mapping[digit - 1], expectedDigit: digit, answer,
        correct: answer === digit, onsetMs: trialStarted - start,
        rtMs: now - trialStarted, inputType,
      });
      phase = 'next';
    } else {
      if (phase !== 'waiting' && phase !== 'stimulus') return;
      const rtMs = phase === 'stimulus' ? now - trialStarted : null;
      const kind = rtMs === null || rtMs < PVT.minRt ? 'false-start' : 'response';
      trials.push({
        kind, rtMs, onsetMs: trialStarted === null ? null : trialStarted - start,
        responseMs: now - start, inputType,
      });
      pvtFeedback(now, kind === 'false-start' ? 'Too soon' : `${Math.round(rtMs)} ms`);
    }
    inputTypes.add(inputType);
  }

  return {
    duration,
    frame(now) { advance(now, true); },
    respond,
    interrupt(now, why) { finish(now, 'invalid', why); },
    cancel(now) { finish(now, 'cancelled', 'cancelled'); },
    get state() { return { status, phase, feedback, symbol: digit === null ? null : mapping[digit - 1] }; },
    result() {
      const elapsedMs = ended === null ? null : ended - start;
      return {
        status, reason, durationMs: duration, elapsedMs, inputTypes: [...inputTypes],
        raw: task === 'pvt' ? { trials: [...trials] } : { mapping: [...mapping], trials: [...trials] },
        summary: status !== 'valid' ? null : task === 'pvt' ? scorePvt(trials) : scoreSdmt(trials, elapsedMs),
      };
    },
  };
}

const tiles = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function patternTask(start, random) {
  const trials = [];
  let phase = 'ready';
  let due = start + 600;
  let level = 3;
  let trial = null;
  let step = 0;
  let tile = null;
  let feedback = '';

  return {
    get state() { return { phase, tile, feedback }; },
    trials,
    frame(now) {
      if (now < due || phase === 'recall') return;
      if (phase === 'recall-wait') {
        phase = 'recall';
        trial.recallMs = now - start;
        return;
      }
      if (phase === 'ready' || phase === 'feedback') {
        trial = { sequence: shuffle(tiles, random).slice(0, level), onsetMs: now - start, responses: [] };
        step = 0;
        phase = 'show';
      }
      if (phase === 'show') {
        tile = trial.sequence[step++];
        due = now + 450;
        phase = 'gap';
      } else {
        tile = null;
        if (step < trial.sequence.length) {
          due = now + 180;
          phase = 'show';
        } else {
          due = now + 180;
          phase = 'recall-wait';
        }
      }
    },
    respond(now, inputType, answer) {
      if (phase !== 'recall' || !tiles.includes(answer)) return false;
      const correct = answer === trial.sequence[trial.responses.length];
      trial.responses.push({ tile: answer, timeMs: now - start, inputType });
      if (!correct || trial.responses.length === trial.sequence.length) {
        trials.push({ ...trial, outcome: correct ? 'correct' : 'incorrect' });
        level = correct ? Math.min(8, level + 1) : Math.max(3, level - 1);
        trial = null;
        phase = 'feedback';
        feedback = correct ? 'Correct' : 'Missed that one';
        due = now + 550;
      }
      return true;
    },
    finish() {
      if (trial) trials.push({ ...trial, outcome: 'truncated' });
    },
    score() {
      const completed = trials.filter(trial => trial.outcome !== 'truncated');
      const correct = completed.filter(trial => trial.outcome === 'correct');
      return {
        correct: correct.length, attempts: completed.length,
        longest: correct.length ? Math.max(...correct.map(trial => trial.sequence.length)) : null,
      };
    },
  };
}

const arrowConditions = [
  { direction: 'left', matching: true }, { direction: 'right', matching: true },
  { direction: 'left', matching: false }, { direction: 'right', matching: false },
];

function arrowTask(start, random) {
  const trials = [];
  let block = [];
  let trial = null;
  let due = start + 350;

  return {
    get state() { return { trial }; },
    trials,
    frame(now) {
      if (now < due) return;
      if (trial) {
        trials.push({ ...trial, outcome: 'timeout' });
        trial = null;
        due = now + 200;
        return;
      }
      if (!block.length) block = shuffle(arrowConditions, random);
      trial = { ...block.pop(), onsetMs: now - start };
      due = now + 2_000;
    },
    respond(now, inputType, answer) {
      if (!trial || now >= due || (answer !== 'left' && answer !== 'right')) return false;
      const outcome = answer === trial.direction ? 'correct' : 'incorrect';
      trials.push({ ...trial, answer, rtMs: now - start - trial.onsetMs, inputType, outcome });
      trial = null;
      due = now + 200;
      return true;
    },
    finish(ended) {
      if (trial) trials.push({ ...trial, outcome: due <= ended ? 'timeout' : 'truncated' });
    },
    score() {
      const completed = trials.filter(trial => trial.outcome !== 'truncated');
      const correct = completed.filter(trial => trial.outcome === 'correct');
      const median = matching => percentile(correct.filter(trial => trial.matching === matching)
        .map(trial => trial.rtMs).sort((a, b) => a - b), 0.5);
      const matchingMs = median(true);
      const conflictingMs = median(false);
      return {
        correct: correct.length, attempts: completed.length,
        accuracy: completed.length ? correct.length / completed.length : null,
        matchingMs, conflictingMs,
        distractionMs: matchingMs === null || conflictingMs === null ? null : conflictingMs - matchingMs,
      };
    },
  };
}

function createShortRun(task, start, duration) {
  const deadline = start + duration;
  const inputTypes = new Set();
  let status = 'running';
  let reason = null;
  let ended = null;

  function finish(now, outcome, why = null) {
    if (status !== 'running') return;
    ended = Math.min(now, deadline);
    task.finish(ended);
    status = outcome;
    reason = why;
  }

  function advance(now) {
    if (now >= deadline) finish(deadline, 'valid');
    return status === 'running';
  }

  return {
    duration,
    frame(now) { if (advance(now)) task.frame(now); },
    respond(now, inputType, answer) {
      if (advance(now) && task.respond(now, inputType, answer)) inputTypes.add(inputType);
    },
    cancel(now) { finish(now, 'cancelled', 'cancelled'); },
    interrupt(now, why) { finish(now, 'invalid', why); },
    get state() { return { status, ...task.state }; },
    result() {
      return {
        status, reason, durationMs: duration, elapsedMs: ended === null ? null : ended - start,
        inputTypes: [...inputTypes], raw: { trials: [...task.trials] },
        summary: status === 'valid' ? task.score() : null,
      };
    },
  };
}

export function interruptionReason({ hidden, frameGapMs, clockDriftMs }) {
  if (hidden) return 'hidden';
  if (frameGapMs > 1_000 || Math.abs(clockDriftMs) > 1_000) return 'timing-gap';
  return null;
}
