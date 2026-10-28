const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRoutes } = require('../lib/route-planner');
const { buildSchedule } = require('../lib/route-schedule');
const host = (id, tower, quest = false) => ({ id, tower, floor: 1, apartmentCode: id, hosting: true, quest, children: [] });
const group = (id, members = []) => ({ id, memberFamilyIds: members, startLocation: 'Вена, парковка -2 этаж' });
function verify(routes, groups) {
  const scheduled = buildSchedule(routes.map((r) => ({ ...groups.find((g) => g.id === r.groupId), stops: r.stops })), 0);
  assert.equal(scheduled.conflicts.length, 0);
  for (const r of routes) {
    const counts = new Map(); const blocks = [];
    for (const s of r.stops) {
      counts.set(s.tower, (counts.get(s.tower) || 0) + 1);
      if (blocks.at(-1) !== s.tower) blocks.push(s.tower);
      assert.equal(s.departure - s.arrival, s.isQuest ? 15 : 5);
    }
    assert([...counts.values()].every((n) => n <= 3));
    assert.equal(new Set(blocks).size, blocks.length);
    assert.equal(new Set(r.stops.map((s) => `${s.hostType}:${s.hostId}`)).size, r.stops.length);
    const g = scheduled.groups.find((g) => g.id === r.groupId);
    assert.deepEqual(g.stops.map((s) => [s.arrivalMin, s.departureMin]), r.stops.map((s) => [s.arrival, s.departure]));
  }
}
test('scarce towers shorten the route instead of breaking the three-stop limit', () => {
  const groups = [group('g')]; const hosts = Array.from({ length: 8 }, (_, i) => host(`h${i}`, 'Вена'));
  const routes = buildRoutes(groups, hosts);
  assert.equal(routes[0].stops.length, 3); assert.equal(routes[0].shortened, true); verify(routes, groups);
});
test('unavoidable contention creates explicit waiting for candy as well as quests', () => {
  for (const quest of [false, true]) {
    const groups = [group('a'), group('b'), group('c')];
    const routes = buildRoutes(groups, [host('h', 'Вена', quest)]);
    const duration = quest ? 15 : 5;
    assert.deepEqual(routes.map((r) => r.stops[0].waitMin), [0, duration, duration * 2]);
    assert.deepEqual(routes.map((r) => r.stops[0].arrival), [15, 15 + duration, 15 + duration * 2]);
    verify(routes, groups);
  }
});
test('start tower affects travel; hosts and special points with equal IDs stay distinct', () => {
  const groups = [{ ...group('g'), startLocation: 'Афины, парковка -2 этаж' }];
  const routes = buildRoutes(groups, [host('same', 'Афины', true)], [{ id: 'same', tower: 'Вена', floor: 1, active: true, quest: false, name: 'Точка' }]);
  assert.equal(routes[0].stops.length, 2); verify(routes, groups);
});
test('repeatable planning balances visit counts and child loads without changing inputs', () => {
  const hosts = Array.from({ length: 20 }, (_, i) => host(`h${i}`, `T${i % 5}`, i < 5));
  const walkers = [3, 4, 5, 6, 7].map((n, i) => ({ id: `w${i}`, children: Array.from({ length: n }, () => ({ age: 8 })) }));
  const groups = walkers.map((w) => group(w.id, [w.id])); const input = [...hosts, ...walkers]; const before = JSON.stringify({ groups, input });
  const first = buildRoutes(groups, input); assert.deepEqual(buildRoutes(groups, input), first);
  assert.equal(JSON.stringify({ groups, input }), before); verify(first, groups);
  const loads = new Map(hosts.map((h) => [h.id, 0]));
  for (const r of first) for (const s of r.stops) loads.set(s.hostId, loads.get(s.hostId) + 1);
  for (const quest of [false, true]) {
    const values = hosts.filter((h) => h.quest === quest).map((h) => loads.get(h.id));
    assert(Math.max(...values) - Math.min(...values) <= 1);
  }
});
