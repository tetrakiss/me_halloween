const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSchedule, parkingLocation, startTowerFor } = require('../lib/route-schedule');
const stop = (hostId, tower, isQuest = false) => ({ hostId, tower, isQuest, hostType: 'family' });
const start = Date.UTC(2026, 9, 31, 13, 0);
test('gathering and first travel use each group start tower; timing ignores obsolete stored minutes', () => {
  const groups = [{ id: 'a', name: 'A', startLocation: parkingLocation('Афины'), stops: [
    { ...stop('one', 'Афины', true), arrivalMin: 999 }, stop('two', 'Афины'), stop('three', 'Вена'),
  ] }];
  const g = buildSchedule(groups, start).groups[0];
  assert.equal(g.startTower, 'Афины');
  assert.equal(g.startLocation, 'Афины, парковка -2 этаж');
  assert.equal(g.departureAt, start + 10 * 60000);
  assert.deepEqual(g.stops.map((s) => [s.arrivalMin, s.departureMin]), [[15, 30], [35, 40], [52, 57]]);
  assert.equal(g.endAt, start + 57 * 60000);
  const shifted = buildSchedule(groups, start + 3600000).groups[0];
  assert.equal(shifted.stops[2].arrivalAt - g.stops[2].arrivalAt, 3600000);
  assert.equal(groups[0].stops[0].arrivalMin, 999);
});
test('legacy starts are understood; different starting tower affects the first transition', () => {
  assert.equal(startTowerFor({ start_location: 'Парковка Вена -2 этаж' }), 'Вена');
  assert.equal(startTowerFor({ startLocation: 'Венеция, парковка -2 этаж' }), 'Венеция');
  const g = buildSchedule([{ id: 'a', startLocation: parkingLocation('Вена'), stops: [stop('x', 'Афины')] }], start).groups[0];
  assert.equal(g.stops[0].arrivalMin, 22);
});
test('overlapping visit intervals conflict across different stages; touching intervals do not', () => {
  const result = buildSchedule([
    { id: 'a', name: 'A', startLocation: parkingLocation('Вена'), stops: [stop('shared', 'Вена', true)] },
    { id: 'b', name: 'B', startLocation: parkingLocation('Вена'), stops: [stop('other', 'Вена'), stop('shared', 'Вена', true)] },
  ], start);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].fromAt, start + 25 * 60000);
  assert.equal(result.conflicts[0].toAt, start + 30 * 60000);
  assert.equal(result.groups[0].stops[0].conflicts[0].groupName, 'B');
  const noConflict = buildSchedule([
    { id: 'a', stops: [stop('shared', 'Вена', true)] },
    { id: 'b', stops: [stop('other', 'Вена', true), stop('shared', 'Вена', true)] },
  ], start);
  assert.equal(noConflict.conflicts.length, 0);
});
test('unset start produces no invented clock times, empty routes are supported', () => {
  const result = buildSchedule([{ id: 'a', stops: [stop('x', 'Вена')] }, { id: 'b', stops: [] }], null);
  assert.equal(result.eventStartAt, null);
  assert.equal(result.groups[0].stops[0].arrivalAt, null);
  assert.equal(result.groups[1].endAt, null);
});
