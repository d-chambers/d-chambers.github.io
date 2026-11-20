import './style.css';
import { createRun, interruptionReason, makeMapping, SYMBOLS, TASKS } from './tasks.js';
import {
  assessmentJSON, createStore, getProfileId, historyCSV, historyJSON, journalSummary,
  newAssessment, RECORD_PREFIX, REASONS, stamp,
} from './records.js';
import { details, element, historyTable, symbol } from './views.js';
import { renderCharts } from './charts.js';

const $ = id => document.getElementById(id);
const dialog = $('task-dialog');
const target = $('target');
const keypad = $('keypad');
const tileGrid = $('tiles');
const taskAreas = Object.fromEntries(Object.keys(TASKS).map(task => [task, $(`${task}-area`)]));
const notice = $('notice');
const deleteDialog = $('delete-dialog');
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const store = createStore(storage);
const profileId = getProfileId(storage, crypto.randomUUID());
let current = null;
let mapping = null;
let active = null;
let records = [];
let storageMessage = '';
let deleting = null;
let redrawCharts = () => {};

const startButtons = [...document.querySelectorAll('[data-task]:not([data-practice])')];
const startLabels = new Map(startButtons.map(button => [button, button.textContent]));

function device() {
  const ua = navigator.userAgent;
  const browser = ua.match(/(Edg(?:A|iOS)?|OPR)\/(\d+)/) ??
    ua.match(/(Chrome|CriOS|Firefox|FxiOS|Version)\/(\d+)/);
  return {
    profileId,
    deviceClass: navigator.userAgentData?.mobile || /Android|iPhone|iPad|Mobi/.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'mobile' : 'desktop',
    browser: browser ? browser[1].replace('Version', 'Safari') + ' ' + browser[2] : 'Browser unknown',
    viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
  };
}

function announce(message = '') {
  notice.textContent = [message, storageMessage].filter(Boolean).join(' ');
}

function saveCurrent() {
  try {
    store.save(current);
    storageMessage = '';
  } catch {
    storageMessage = 'Browser storage could not save this assessment. You can still download it.';
  }
}

function readHistory() {
  try { return store.list(); }
  catch {
    storageMessage = 'Browser storage is unavailable. You can still download current results.';
    return [];
  }
}

function renderCurrent() {
  $('results').hidden = !current;
  $('result-details').replaceChildren(...(current ? [details(current)] : []));
  $('clipboard-fallback').hidden = true;
  for (const button of startButtons) {
    const recorded = Boolean(current?.tests[button.dataset.task]);
    button.disabled = recorded;
    button.textContent = recorded ? 'Attempt recorded' : startLabels.get(button);
  }
}

function renderHistory() {
  records = readHistory();
  $('history-json').disabled = $('history-csv').disabled = records.length === 0;
  $('history-list').replaceChildren(historyTable(records, record => {
    deleting = record;
    $('delete-timestamp').textContent = record.timestamp;
    deleteDialog.returnValue = 'keep';
    deleteDialog.showModal();
  }));
  redrawCharts = renderCharts($('charts'), records);
}

function showView(focusHeading = false) {
  const history = location.hash === '#history';
  $('assess-view').hidden = history;
  $('history-view').hidden = !history;
  for (const link of document.querySelectorAll('[data-view]')) {
    if ((link.dataset.view === 'history') === history) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (history) {
    renderHistory();
    if (focusHeading) $('history-heading').focus();
  }
  announce();
}

function resetCurrent() {
  current = null;
  mapping = null;
  $('clarity').value = '5';
  $('clarity-value').textContent = '5/10';
  renderCurrent();
}

$('clarity').addEventListener('input', event => {
  const rating = Number(event.target.value);
  $('clarity-value').textContent = `${rating}/10`;
  current ??= newAssessment();
  current.tests.clarity = { ...stamp(), status: 'valid', rating };
  saveCurrent();
  renderCurrent();
  announce();
});

const help = $('assessment-help');
const helpButton = $('help-button');
const helpPanel = $('help-panel');
let helpPinned = false;

function showHelp(open) {
  helpPanel.hidden = !open;
  helpButton.setAttribute('aria-expanded', String(open));
  if (!open) helpPinned = false;
}

help.addEventListener('pointerenter', event => {
  if (event.pointerType === 'mouse') showHelp(true);
});
help.addEventListener('pointerleave', event => {
  if (event.pointerType === 'mouse' && !helpPinned && !help.contains(document.activeElement)) showHelp(false);
});
helpButton.addEventListener('focus', () => showHelp(true));
helpButton.addEventListener('click', () => {
  helpPinned = !helpPinned;
  showHelp(helpPinned);
});
help.addEventListener('focusout', event => {
  if (!help.contains(event.relatedTarget)) showHelp(false);
});
document.addEventListener('pointerdown', event => {
  if (!help.contains(event.target)) showHelp(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !helpPanel.hidden) showHelp(false);
});
$('new').addEventListener('click', () => {
  resetCurrent();
  $('clarity').focus();
  announce('Ready for a new assessment.');
});

function download(filename, contents, mime) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const link = element('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function copyCurrent(format, message) {
  const record = current;
  const text = format(record);
  try {
    await navigator.clipboard.writeText(text);
    if (current !== record) return;
    $('clipboard-fallback').hidden = true;
    announce(message);
  } catch {
    if (current !== record) return;
    const field = $('copy-content');
    $('clipboard-fallback').hidden = false;
    field.value = text;
    field.focus();
    field.select();
  }
}

$('copy').addEventListener('click', () => copyCurrent(journalSummary, 'Text copied.'));
$('copy-json').addEventListener('click', () => copyCurrent(assessmentJSON, 'JSON copied.'));
$('export').addEventListener('click', () => {
  download(`cognitive-assessment-${current.assessmentId}.json`, assessmentJSON(current), 'application/json');
});
$('history-json').addEventListener('click', () => {
  download('cognitive-assessments.json', historyJSON(readHistory()), 'application/json');
});
$('history-csv').addEventListener('click', () => {
  download('cognitive-assessments.csv', historyCSV(readHistory()), 'text/csv;charset=utf-8');
});

deleteDialog.addEventListener('close', () => {
  if (deleteDialog.returnValue !== 'delete') return;
  try {
    store.remove(deleting.assessmentId);
    if (current?.assessmentId === deleting.assessmentId) {
      resetCurrent();
    }
    renderHistory();
    $('history-heading').focus();
    announce('Assessment deleted.');
  } catch {
    announce('This assessment could not be deleted from browser storage.');
  }
});

const prompts = Object.fromEntries(SYMBOLS.map(name => [name, symbol(name)]));
const tileButtons = [];
for (let digit = 1; digit <= 9; digit++) {
  const button = element('button', digit, 'key');
  button.type = 'button';
  button.dataset.answer = digit;
  keypad.append(button);
}
for (const digit of [7, 8, 9, 4, 5, 6, 1, 2, 3]) {
  const tile = element('button', digit, 'key tile');
  tile.type = 'button';
  tile.dataset.answer = digit;
  tileGrid.append(tile);
  tileButtons[digit - 1] = tile;
}

function makeLegend() {
  $('legend').replaceChildren(...mapping.map((name, index) => {
    const item = element('div', null, 'legend-item');
    item.append(symbol(name), element('span', index + 1));
    return item;
  }));
}

function startTask(button) {
  if (active || document.hidden) return;
  showHelp(false);
  const { task } = button.dataset;
  const practice = button.hasAttribute('data-practice');
  $('task-heading').textContent = `${TASKS[task].title}${practice ? ' practice' : ''}`;
  $('task-instruction').textContent = TASKS[task].instruction;
  for (const [key, area] of Object.entries(taskAreas)) area.hidden = key !== task;
  target.dataset.phase = 'waiting';
  $('target-label').textContent = '+';
  $('prompt').replaceChildren();
  for (const tile of tileButtons) tile.classList.remove('lit');
  if (task === 'sdmt') {
    mapping ??= makeMapping();
    makeLegend();
  }
  dialog.showModal();
  taskAreas[task].querySelector('button').focus({ preventScroll: true });
  const metadata = { ...stamp(), device: device() };
  if (!practice) {
    current ??= newAssessment();
    current.tests[task] = {
      ...metadata, status: 'invalid', reason: 'unclean-exit', durationMs: TASKS[task].duration,
      elapsedMs: null, inputTypes: [], raw: null, summary: null,
    };
    saveCurrent();
  }
  const start = performance.now();
  const run = createRun(task, start, { practice, mapping });
  active = {
    task, practice, start, wallStart: Date.now(), lastFrame: start, run, metadata, button,
    lastSecond: null, symbol: null, phase: null, feedback: null, tile: null, trial: undefined,
  };
  updateTask(start);
  active.raf = requestAnimationFrame(tick);
}

function updateTask(now) {
  const { task, run } = active;
  const state = run.state;
  const elapsed = Math.min(run.duration, now - active.start);
  const remaining = Math.ceil((run.duration - elapsed) / 1_000);
  if (remaining !== active.lastSecond) {
    active.lastSecond = remaining;
    $('progress').max = run.duration;
    $('progress').value = run.duration - remaining * 1_000;
    $('remaining').textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  }
  if (task === 'pvt' && (state.phase !== active.phase || state.feedback !== active.feedback)) {
    target.dataset.phase = state.phase;
    $('target-label').textContent = state.phase === 'stimulus' ? 'Respond' :
      state.phase === 'feedback' ? state.feedback : '+';
    active.phase = state.phase;
    active.feedback = state.feedback;
  } else if (task === 'sdmt' && state.symbol && state.symbol !== active.symbol) {
    $('prompt').replaceChildren(prompts[state.symbol]);
    active.symbol = state.symbol;
  } else if (task === 'pattern') {
    if (state.tile !== active.tile) {
      if (active.tile !== null) tileButtons[active.tile - 1].classList.remove('lit');
      if (state.tile !== null) tileButtons[state.tile - 1].classList.add('lit');
      active.tile = state.tile;
    }
    const overtime = remaining === 0;
    if (state.phase !== active.phase || overtime !== active.overtime) {
      const recalling = state.phase === 'recall';
      $('pattern-status').textContent = recalling ? (overtime ? 'Finish this round' : 'Your turn') :
        state.phase === 'feedback' ? state.feedback : 'Watch the tiles';
      for (const tile of tileButtons) tile.setAttribute('aria-disabled', String(!recalling));
      active.phase = state.phase;
      active.overtime = overtime;
    }
  } else if (task === 'arrow' && state.trial !== active.trial) {
    const trial = state.trial;
    if (trial) {
      const middle = trial.direction === 'left' ? '←' : '→';
      const sides = trial.matching ? middle : middle === '←' ? '→' : '←';
      $('arrow-prompt').textContent = sides + sides + middle + sides + sides;
    } else $('arrow-prompt').textContent = '·';
    active.trial = trial;
  }
}

function invalidReason(now) {
  return interruptionReason({
    hidden: document.hidden,
    frameGapMs: now - active.lastFrame,
    clockDriftMs: (Date.now() - active.wallStart) - (now - active.start),
  });
}

function tick() {
  if (!active) return;
  const now = performance.now();
  const reason = invalidReason(now);
  if (reason) return interrupt(reason, now);
  active.lastFrame = now;
  active.run.frame(now);
  if (active.run.state.status === 'running') {
    updateTask(now);
    active.raf = requestAnimationFrame(tick);
  } else finishTask();
}

function finishTask() {
  const { task, practice, run, metadata, button, raf } = active;
  active = null;
  cancelAnimationFrame(raf);
  dialog.close();
  const result = run.result();
  if (!practice) {
    current.tests[task] = { ...metadata, ...result };
    saveCurrent();
    renderCurrent();
  }
  if (location.hash === '#history') renderHistory();
  else if (button.disabled) (startButtons.find(candidate => !candidate.disabled) ?? $('copy')).focus();
  else button.focus();
  const complete = practice ? 'Practice complete.' : 'Assessment recorded.';
  announce(result.reason ? REASONS[result.reason] : complete);
}

function interrupt(reason, now = performance.now()) {
  if (!active) return;
  active.run.interrupt(now, reason);
  finishTask();
}

function cancelTask() {
  if (!active) return;
  const now = performance.now();
  const reason = invalidReason(now);
  if (reason) return interrupt(reason, now);
  active.run.cancel(now);
  finishTask();
}

function respond(now, inputType, answer) {
  const reason = invalidReason(now);
  if (reason) return interrupt(reason, now);
  active.run.respond(now, inputType, answer);
  if (active.run.state.status === 'running') updateTask(now);
  else finishTask();
}

for (const button of document.querySelectorAll('[data-task]')) {
  button.addEventListener('click', () => startTask(button));
}
$('cancel-task').addEventListener('click', cancelTask);
dialog.addEventListener('cancel', event => { event.preventDefault(); cancelTask(); });
function responseButton(event) {
  const button = event.target.closest('[data-answer]');
  return button && taskAreas[active.task].contains(button) ? button : null;
}

function buttonAnswer(button) {
  return active.task === 'arrow' ? button.dataset.answer : Number(button.dataset.answer);
}

dialog.addEventListener('pointerdown', event => {
  const now = performance.now();
  if (!active || !event.isPrimary || event.button !== 0) return;
  if (active.task === 'pvt' && target.contains(event.target)) {
    event.preventDefault();
    respond(now, event.pointerType || 'mouse');
    return;
  }
  const button = responseButton(event);
  if (button) {
    event.preventDefault();
    respond(now, event.pointerType || 'mouse', buttonAnswer(button));
  }
});
// Keyboard and assistive technology can also activate a focused answer button.
dialog.addEventListener('click', event => {
  if (!active || event.detail !== 0) return;
  const button = responseButton(event);
  if (button) respond(performance.now(), 'keyboard', buttonAnswer(button));
});
window.addEventListener('keydown', event => {
  const now = performance.now();
  if (!active || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  const numpadDigit = active.task === 'pattern' && /^Numpad[1-9]$/.test(event.code);
  const digit = numpadDigit ? event.code.at(-1) : event.key;
  if (active.task === 'pvt' && event.code === 'Space' && event.target !== $('cancel-task')) {
    event.preventDefault();
    if (!event.repeat) respond(now, 'keyboard');
  } else if ((active.task === 'sdmt' || active.task === 'pattern') && /^[1-9]$/.test(digit)) {
    event.preventDefault();
    if (!event.repeat) respond(now, 'keyboard', Number(digit));
  } else if (active.task === 'arrow' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    if (!event.repeat) respond(now, 'keyboard', event.key === 'ArrowLeft' ? 'left' : 'right');
  }
});
target.addEventListener('click', event => {
  if (active?.task === 'pvt' && event.detail === 0) respond(performance.now(), 'keyboard');
});
document.addEventListener('visibilitychange', () => { if (document.hidden) interrupt('hidden'); });
window.addEventListener('blur', () => interrupt(document.hidden ? 'hidden' : 'focus-lost'));
window.addEventListener('pagehide', () => interrupt('page-exit'));
window.addEventListener('hashchange', () => {
  if (active) interrupt('page-exit');
  showView(true);
});
window.addEventListener('resize', () => redrawCharts());
window.addEventListener('storage', event => {
  if (event.key === null || event.key.startsWith(RECORD_PREFIX)) {
    if (current && (event.key === null ||
        (event.key === RECORD_PREFIX + current.assessmentId && event.newValue === null))) {
      if (active) {
        cancelAnimationFrame(active.raf);
        active = null;
        dialog.close();
      }
      resetCurrent();
      announce('The current assessment was removed in another tab.');
    }
    if (location.hash === '#history') renderHistory();
  }
});
renderCurrent();
showView();
