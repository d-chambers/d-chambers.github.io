import { setupLabel } from './records.js';
import { element } from './views.js';

const colors = ['#21618c', '#a04514', '#287352', '#725489', '#9d3942'];
const definitions = [
  ['Cognitive clarity', 'clarity', test => test.rating, '/10'],
  ['PVT median reaction time', 'pvt', test => test.summary.medianMs, ' ms'],
  ['PVT lapses', 'pvt', test => test.summary.lapses, ''],
  ['SDMT-style correct responses', 'sdmt', test => test.summary.correct, ''],
  ['Pattern Recall longest sequence', 'pattern', test => test.summary.longest, ' tiles'],
  ['Arrow Focus distraction cost', 'arrow', test => test.summary.distractionMs, ' ms'],
];

function pointsFor(records, key, score) {
  const series = new Map();
  return records.flatMap(record => {
    const test = record.tests[key];
    if (test?.status !== 'valid') return [];
    const value = score(test);
    if (value == null) return [];
    const version = record.testVersions[key];
    const setup = key === 'clarity' ? '' : `${setupLabel(test)} · v${version}`;
    const group = key === 'clarity' ? version :
      JSON.stringify([test.device.profileId, test.device.deviceClass, test.device.browser, [...test.inputTypes].sort(), version]);
    if (!series.has(group)) series.set(group, series.size);
    return [{
      time: Date.parse(test.timestamp), timestamp: test.timestamp, timeZone: test.timeZone,
      setup, value, series: series.get(group),
    }];
  }).sort((a, b) => a.time - b.time);
}

const axisTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const valueText = (value, unit) => `${Math.round(value)}${unit}`;

function chart(records, [title, key, score, unit], refreshers) {
  const section = element('section', null, 'card chart');
  section.append(element('h2', title));
  const points = pointsFor(records, key, score);
  if (!points.length) {
    section.append(element('p', 'No completed measurements.', 'meta'));
    return section;
  }
  const canvas = element('canvas', null, 'plot');
  canvas.setAttribute('aria-hidden', 'true');
  const picker = element('input');
  picker.type = 'range';
  picker.min = 0;
  picker.max = points.length - 1;
  picker.value = points.length - 1;
  picker.disabled = points.length === 1;
  const label = element('label', 'Inspect measurement', 'plot-picker');
  label.append(picker);
  const readout = element('p', '', 'meta chart-readout');
  readout.setAttribute('aria-live', 'polite');
  section.append(canvas);
  const groups = new Map(points.map(point => [point.series, point.setup]));
  if (key !== 'clarity' && groups.size > 1) {
    const legend = element('ul', null, 'plot-legend');
    for (const [index, setup] of groups) {
      const item = element('li', `Setup ${index + 1} · ${setup}`);
      const marker = element('span', null, 'plot-marker');
      marker.style.backgroundColor = colors[index % colors.length];
      item.prepend(marker);
      legend.append(item);
    }
    section.append(legend);
  }
  section.append(label, readout);

  const ctx = canvas.getContext('2d');
  let positions = [];
  const first = points[0].time;
  const last = points.at(-1).time;
  const low = key === 'clarity' ? 0 : points.reduce((min, point) => Math.min(min, Math.floor(point.value)), Infinity);
  const high = key === 'clarity' ? 10 : points.reduce((max, point) => Math.max(max, Math.ceil(point.value)), low + 1);
  function draw() {
    const width = canvas.clientWidth;
    if (!width) return;
    const height = canvas.clientHeight;
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.font = '12px system-ui';
    const left = 46;
    const right = width - 16;
    const top = 16;
    const bottom = height - 31;
    const x = time => last === first ? (left + right) / 2 : left + (right - left) * (time - first) / (last - first);
    const y = value => bottom - (bottom - top) * (value - low) / (high - low);
    ctx.fillStyle = '#415765';
    ctx.strokeStyle = '#d7e2e9';
    ctx.textAlign = 'right';
    for (const value of new Set([low, Math.round((high + low) / 2), high])) {
      const row = y(value);
      ctx.beginPath();
      ctx.moveTo(left, row);
      ctx.lineTo(right, row);
      ctx.stroke();
      ctx.fillText(String(value), left - 6, row + 4);
    }
    ctx.textAlign = first === last ? 'center' : 'left';
    ctx.fillText(axisTime.format(first), first === last ? x(first) : left, height - 8);
    if (first !== last) {
      ctx.textAlign = 'right';
      ctx.fillText(axisTime.format(last), right, height - 8);
    }

    positions = points.map(point => ({ x: x(point.time), y: y(point.value) }));
    const selected = Number(picker.value);
    points.forEach((point, index) => {
      const position = positions[index];
      ctx.beginPath();
      ctx.arc(position.x, position.y, index === selected ? 7 : 4, 0, Math.PI * 2);
      ctx.fillStyle = colors[point.series % colors.length];
      ctx.fill();
      if (index === selected) {
        ctx.strokeStyle = '#173c53';
        ctx.stroke();
      }
    });
    const point = points[selected];
    const setup = point.setup ? ` · ${groups.size > 1 ? `Setup ${point.series + 1} · ` : ''}${point.setup}` : '';
    const description = `${valueText(point.value, unit)} · ${point.timestamp} · ${point.timeZone}${setup}`;
    if (readout.textContent !== description) readout.textContent = description;
    picker.setAttribute('aria-valuetext', description);
  }

  picker.addEventListener('input', draw);
  canvas.addEventListener('pointerup', event => {
    const rect = canvas.getBoundingClientRect();
    const distances = positions.map(point => Math.hypot(point.x - event.clientX + rect.left, point.y - event.clientY + rect.top));
    const index = distances.reduce((closest, value, index) => value < distances[closest] ? index : closest, 0);
    picker.value = index;
    draw();
  });
  refreshers.push(draw);
  return section;
}

export function renderCharts(container, records) {
  const refreshers = [];
  container.replaceChildren(...definitions.map(definition => chart(records, definition, refreshers)));
  refreshers.forEach(draw => draw());
  return () => refreshers.forEach(draw => draw());
}
