import { ms, percent, REASONS, setupLabel } from './records.js';

export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

const duration = value => value == null ? '—' : `${(value / 1000).toFixed(1)} sec`;
const taskNames = {
  pvt: 'Visual reaction time (PVT)', sdmt: 'SDMT-style symbol matching',
  pattern: 'Pattern Recall', arrow: 'Arrow Focus',
};

function measurements(rows) {
  const list = element('dl');
  for (const [label, value] of rows) list.append(element('dt', label), element('dd', value));
  return list;
}

export function details(record) {
  const fragment = document.createDocumentFragment();
  const { clarity } = record.tests;
  fragment.append(element('p', `${record.timestamp} · ${record.timeZone}`, 'meta'));
  if (clarity) {
    fragment.append(measurements([['Cognitive clarity', `${clarity.rating}/10`]]));
  }
  for (const [key, name] of Object.entries(taskNames)) {
    const task = record.tests[key];
    if (!task) continue;
    const setup = `${task.timestamp} · ${setupLabel(task)} · v${record.testVersions[key]}`;
    fragment.append(element('h3', name), element('p', setup, 'meta'));
    const rows = [
      ['Run status', task.reason ? `${task.status} · ${REASONS[task.reason]}` : task.status],
      ['Elapsed / planned', `${duration(task.elapsedMs)} / ${duration(task.durationMs)}`],
    ];
    const result = task.summary;
    if (result && key === 'pvt') {
      rows.push(['Median', ms(result.medianMs)], ['Mean', ms(result.meanMs)],
        ['90th percentile', ms(result.p90Ms)], ['Responses ≥355 ms or timeout', result.lapses],
        ['False starts', result.falseStarts], ['Timeouts', result.timeouts]);
    }
    if (result && key === 'sdmt') {
      rows.push(['Correct', result.correct], ['Incorrect', result.incorrect], ['Attempts', result.attempts],
        ['Accuracy', percent(result.accuracy)], ['Correct per minute', result.correctPerMinute?.toFixed(1)]);
    }
    if (result && key === 'pattern') {
      rows.push(['Correct sequences', `${result.correct}/${result.attempts}`], ['Longest correct sequence', result.longest ?? '—']);
    }
    if (result && key === 'arrow') {
      rows.push(['Correct responses', `${result.correct}/${result.attempts}`], ['Accuracy', percent(result.accuracy)],
        ['Matching arrows median', ms(result.matchingMs)], ['Conflicting arrows median', ms(result.conflictingMs)],
        ['Distraction cost', ms(result.distractionMs)]);
    }
    fragment.append(measurements(rows));
  }
  return fragment;
}

export function historyTable(records, onDelete) {
  if (!records.length) return element('p', 'No saved assessments yet.', 'empty');
  const wrapper = element('div', null, 'table-wrap');
  const table = element('table');
  const row = table.createTHead().insertRow();
  for (const header of ['Assessment', 'Clarity', 'PVT median', 'PVT lapses', 'Symbol matches', 'Pattern span', 'Arrow accuracy', 'Actions']) {
    const cell = element('th', header);
    cell.scope = 'col';
    row.append(cell);
  }
  const body = table.createTBody();
  for (const record of records) {
    const { clarity, pvt, sdmt, pattern, arrow } = record.tests;
    const row = body.insertRow();
    const expandable = element('details');
    expandable.append(element('summary', record.timestamp), details(record));
    row.insertCell().append(expandable);
    const pvtValue = pvt?.status === 'valid' ? ms(pvt.summary.medianMs) : pvt?.status;
    const sdmtValue = sdmt?.status === 'valid' ? sdmt.summary.correct : sdmt?.status;
    const patternValue = pattern?.status === 'valid' ? pattern.summary.longest : pattern?.status;
    const arrowValue = arrow?.status === 'valid' ? percent(arrow.summary.accuracy) : arrow?.status;
    for (const value of [clarity?.rating, pvtValue, pvt?.summary?.lapses, sdmtValue, patternValue, arrowValue]) {
      row.insertCell().textContent = value ?? '—';
    }
    const remove = element('button', 'Delete', 'secondary');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Delete assessment from ${record.timestamp}`);
    remove.addEventListener('click', () => onDelete(record));
    row.insertCell().append(remove);
  }
  wrapper.append(table);
  return wrapper;
}

const paths = {
  circle: [[12, 12, 8]],
  ring: [[12, 12, 8], [12, 12, 4]],
  triangle: [[12, 3, 22, 21, 2, 21, 12, 3]],
  square: [[4, 4, 20, 4, 20, 20, 4, 20, 4, 4]],
  diamond: [[12, 2, 22, 12, 12, 22, 2, 12, 12, 2]],
  plus: [[12, 3, 12, 21], [3, 12, 21, 12]],
  cross: [[5, 5, 19, 19], [19, 5, 5, 19]],
  bars: [[4, 8, 20, 8], [4, 16, 20, 16]],
  chevron: [[4, 5, 12, 17, 20, 5]],
};
const symbolLabel = { circle: 'Circle', ring: 'Double ring', bars: 'Parallel bars', chevron: 'Chevron' };

export function symbol(name) {
  const canvas = element('canvas', null, 'symbol');
  canvas.width = canvas.height = 96;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', symbolLabel[name] ?? name);
  const ctx = canvas.getContext('2d');
  ctx.scale(4, 4);
  ctx.strokeStyle = '#173c53';
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const path of paths[name]) {
    ctx.beginPath();
    if (path.length === 3) ctx.arc(...path, 0, 2 * Math.PI);
    else {
      ctx.moveTo(path[0], path[1]);
      for (let i = 2; i < path.length; i += 2) ctx.lineTo(path[i], path[i + 1]);
    }
    ctx.stroke();
  }
  return canvas;
}
