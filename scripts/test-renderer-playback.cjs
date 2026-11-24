const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
const controller = source.slice(
  source.indexOf('  function getCurrentTimeInMilliseconds()'),
  source.indexOf('  // Ses slider')
);
const announcement = { url: 'special.mp3', startTimeMs: 10000, durationMs: 5000, type: 'specialAd' };

async function test() {
  let time = 10000;
  let calls = 0;
  let rejectPlayback;
  let nextTimer = 0;
  const timers = new Map();
  const progress = { style: {} };
  const audio = Object.assign(new EventTarget(), {
    src: 'song.mp3', currentTime: 2, duration: 30, volume: 1,
    pause() {}, load() {}, removeAttribute() { this.src = ''; },
    play() { calls++; return new Promise((resolve, reject) => { rejectPlayback = reject; }); }
  });
  const window = Object.assign(new EventTarget(), { playerState: { volume: 100 }, _trackDurationSec: 30 });
  const context = vm.createContext({
    window,
    document: { getElementById(id) { return id === 'app-audio' ? audio : id === 'progress-current' ? progress : null; } },
    Date: class extends Date { constructor() { super(2024, 0, 1, 0, 0, 0, time); } },
    setTimeout(fn, delay) { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    console: { warn() {} },
    formatTime: String,
    updateUIFromState() {}
  });
  vm.runInContext(controller, context);
  const select = (detail) => window.dispatchEvent(new CustomEvent('virtualplayer-activerecord', { detail }));

  select(announcement);
  assert.equal(audio.src, 'special.mp3');
  assert.equal(audio.currentTime, 0);
  assert.equal(calls, 1);
  assert.equal(context.mediaStatus, 'loading');
  audio.dispatchEvent(new Event('playing'));
  assert.equal(context.mediaStatus, 'playing');
  audio.currentTime = 1.1;
  audio.dispatchEvent(new Event('timeupdate'));
  assert.equal(progress.textContent, '1');
  progress.textContent = 'unchanged';
  audio.currentTime = 1.5;
  audio.dispatchEvent(new Event('timeupdate'));
  assert.equal(progress.textContent, 'unchanged');
  const rejectOld = rejectPlayback;

  time = 20000;
  select({ ...announcement, startTimeMs: time });
  assert.equal(calls, 2);
  rejectOld(new Error('Old load'));
  await Promise.resolve();
  assert.equal(context.mediaStatus, 'loading');
  audio.dispatchEvent(new Event('error'));
  assert.equal(context.mediaStatus, 'loading');
  const retry = timers.get(context.recoveryTimer);
  assert.equal(retry.delay, 500);
  timers.delete(context.recoveryTimer);
  time += 500;
  retry.fn();
  assert.equal(calls, 3);
  audio.dispatchEvent(new Event('waiting'));
  assert.equal(timers.get(context.recoveryTimer).delay, 8000);
  select({ ...announcement, startTimeMs: time, url: 'other.mp3' });
  assert.equal(timers.size, 1);
  rejectPlayback(Object.assign(new Error('Playback rejected'), { name: 'NotAllowedError' }));
  await Promise.resolve();
  assert.equal(context.mediaStatus, 'error');
  time += 5000;
  select(announcement);
  assert.equal(calls, 4);
  assert.equal(audio.src, '');
  assert.equal(context.mediaStatus, 'idle');
  console.log('Renderer: immediate transition, real media state, repeat, errors, expiry and one update per second passed');
}

test().catch((error) => { console.error(error); process.exitCode = 1; });
