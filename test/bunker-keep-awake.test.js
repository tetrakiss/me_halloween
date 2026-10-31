'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync('public/games/bunker/keep-awake.js', 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(request) {
  const events = {}, timers = new Map(); let timerId = 0;
  const video = { paused: true, plays: 0, play() { this.paused = false; this.plays++; return Promise.resolve(); }, pause() { this.paused = true; } };
  const document = { hidden: false, getElementById: () => video, addEventListener: (type, fn) => { events[type] = fn; } };
  vm.runInNewContext(code, {
    document, navigator: request ? { wakeLock: { request } } : {},
    window: { addEventListener: (type, fn) => { events[type] = fn; } },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id)
  });
  return { events, document, video, timers };
}
function sentinel() {
  return { releases: 0, addEventListener(type, fn) { this.releaseEvent = fn; }, async release() { this.releases++; if (this.releaseEvent) this.releaseEvent(); } };
}
test('bunker holds screen while visible, releases on exit and reacquires on return', async () => {
  const locks = [];
  const g = setup(async type => { assert.equal(type, 'screen'); const lock = sentinel(); locks.push(lock); return lock; });
  await flush();
  g.events.click(); await flush(); assert.equal(locks.length, 1);
  g.document.hidden = true; g.events.visibilitychange(); await flush();
  assert.equal(locks[0].releases, 1); assert(g.video.paused);
  g.document.hidden = false; g.events.visibilitychange(); await flush(); assert.equal(locks.length, 2);
  g.events.pagehide(); await flush(); assert.equal(locks[1].releases, 1);
  g.events.pageshow(); await flush(); assert.equal(locks.length, 3);
});
test('legacy video fallback starts, pauses in background and resumes on a real gesture', async () => {
  const g = setup(); assert.equal(g.video.plays, 1);
  g.events.click(); assert.equal(g.video.plays, 1);
  g.document.hidden = true; g.events.visibilitychange(); assert(g.video.paused);
  g.events.keydown(); assert(g.video.paused);
  g.document.hidden = false; g.events.visibilitychange(); assert.equal(g.video.plays, 2);
  g.events.pagehide(); assert(g.video.paused); assert.equal(g.timers.size, 0);
});
test('denied native lock falls back without breaking the screensaver', async () => {
  const g = setup(async () => { throw new Error('NotAllowedError'); });
  await flush(); assert.equal(g.video.plays, 1);
  g.events.pagehide(); assert(g.video.paused);
});
test('a pending request resolving after exit is released instead of keeping the TV awake', async () => {
  let resolve; const lock = sentinel();
  const g = setup(() => new Promise(done => { resolve = done; }));
  g.events.pagehide(); resolve(lock); await flush();
  assert.equal(lock.releases, 1); assert(g.video.paused);
});
test('system-released lock uses video while waiting for a bounded retry', async () => {
  let count = 0; const lock = sentinel();
  const g = setup(async () => { count++; return lock; }); await flush();
  await lock.release(); await flush();
  assert.equal(count, 1); assert.equal(g.video.plays, 1); assert.equal(g.timers.size, 1);
  g.events.pagehide(); assert.equal(g.timers.size, 0); assert(g.video.paused);
});
