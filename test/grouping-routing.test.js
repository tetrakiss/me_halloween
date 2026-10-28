const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGroups,
  fillExistingGroups,
  buildRoutes,
  MIN_GROUP_SIZE,
  MAX_GROUP_SIZE,
  TARGET_ROUTE_STOPS,
  MAX_ROUTE_STOPS,
} = require('../lib/grouping-routing');

function family(id, age, tower, overrides = {}) {
  return {
    id,
    tower,
    floor: Number(id.replace(/\D/g, '')) || 1,
    apartmentCode: id,
    children: [{ name: `Ребёнок ${id}`, age }],
    walking: true,
    hosting: false,
    candyBrought: true,
    quest: false,
    questDurationMin: null,
    manualGroupId: null,
    groupingPaused: false,
    cancelled: false,
    ...overrides,
  };
}

test('без приёма гостей семья допускается только после отметки о принесённых конфетах', () => {
  const families = [
    family('blocked', 8, 'A', { candyBrought: false, manualGroupId: 'manual' }),
    family('approved', 8, 'A'),
    family('host', 8, 'A', { hosting: true, candyBrought: false }),
    family('quest', 8, 'A', { quest: true, candyBrought: false }),
  ];
  const groups = buildGroups(families, []);
  assert.deepEqual(groups.flatMap((group) => group.memberFamilyIds).sort(), ['approved', 'host', 'quest']);
  const result = fillExistingGroups([{ id: 'existing', memberFamilyIds: ['host'] }], families, [], () => 0);
  assert.deepEqual(result.assignments.map((assignment) => assignment.familyId).sort(), ['approved', 'quest']);
  assert.ok(result.groups.every((group) => !group.memberFamilyIds.includes('blocked')));
});

test('пожелания ходить вместе остаются неделимыми и имеют высший приоритет', () => {
  const families = [
    family('f1', 4, 'A'),
    family('f2', 14, 'B'),
    ...Array.from({ length: 10 }, (_, index) => family(`x${index + 1}`, index < 5 ? 6 : 12, index < 5 ? 'A' : 'B')),
  ];
  const groups = buildGroups(families, [{ a: 'f1', b: 'f2' }]);
  const linkedGroup = groups.find((group) => group.memberFamilyIds.includes('f1'));
  assert.ok(linkedGroup);
  assert.ok(linkedGroup.memberFamilyIds.includes('f2'));
});

test('группы сохраняют близкий возраст и предел шесть детей', () => {
  const families = Array.from({ length: 18 }, (_, index) => (
    family(`f${index + 1}`, index < 6 ? 5 : index < 12 ? 9 : 13, index < 9 ? 'A' : 'B')
  ));
  const groups = buildGroups(families, []);
  const byId = new Map(families.map((item) => [item.id, item]));
  for (const group of groups) {
    assert.ok(group.childCount >= MIN_GROUP_SIZE && group.childCount <= MAX_GROUP_SIZE);
    const ages = group.memberFamilyIds.flatMap((id) => byId.get(id).children.map((child) => child.age));
    assert.ok(Math.max(...ages) - Math.min(...ages) <= 8);
  }
});

test('двенадцать детей разделяются на две группы по шесть', () => {
  const families = [
    ...Array.from({ length: 6 }, (_, index) => family(`a${index + 1}`, 8, 'A')),
    ...Array.from({ length: 6 }, (_, index) => family(`b${index + 1}`, 8, 'B')),
  ];
  const groups = buildGroups(families, []);
  const byId = new Map(families.map((item) => [item.id, item]));
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.childCount), [6, 6]);
  assert.ok(groups.every((group) => new Set(group.memberFamilyIds.map((id) => byId.get(id).tower)).size === 1));
});

test('двадцать один ребёнок распределяется без превышения шести', () => {
  const families = Array.from({ length: 21 }, (_, index) => family(`f${index + 1}`, 8, 'A'));
  const groups = buildGroups(families, []);
  assert.deepEqual(groups.map((group) => group.childCount), [5, 5, 5, 6]);
});

test('неполная группа не вызывает переполнение других групп', () => {
  const families = Array.from({ length: 19 }, (_, index) => family(`f${index + 1}`, 8, 'A'));
  const groups = buildGroups(families, []);
  assert.deepEqual(groups.map((group) => group.childCount), [4, 5, 5, 5]);
});

test('семья из очереди ожидания не возвращается при автоматическом пересчёте', () => {
  const families = Array.from({ length: 9 }, (_, index) => family(`f${index + 1}`, 8, 'A', {
    groupingPaused: index === 0,
  }));
  const groups = buildGroups(families, []);
  assert.ok(groups.every((group) => !group.memberFamilyIds.includes('f1')));
  assert.equal(groups.reduce((sum, group) => sum + group.childCount, 0), 8);
});

test('ожидающие семьи дозаполняют существующие группы по возрасту и башне', () => {
  const families = [
    ...Array.from({ length: 5 }, (_, index) => family(`a${index + 1}`, 6, 'A')),
    ...Array.from({ length: 5 }, (_, index) => family(`b${index + 1}`, 13, 'B')),
    family('wa', 7, 'A', { groupingPaused: true }),
    family('wb', 12, 'B', { groupingPaused: true }),
  ];
  const result = fillExistingGroups([
    { id: 'young', memberFamilyIds: ['a1', 'a2', 'a3', 'a4', 'a5'] },
    { id: 'older', memberFamilyIds: ['b1', 'b2', 'b3', 'b4', 'b5'] },
  ], families, [], () => 0);

  assert.equal(result.starterFamilyId, 'wa');
  assert.deepEqual(result.assignments, [
    { familyId: 'wa', groupId: 'young' },
    { familyId: 'wb', groupId: 'older' },
  ]);
  assert.ok(result.groups.every((group) => group.childCount <= MAX_GROUP_SIZE));
  assert.deepEqual(result.unassignedFamilyIds, []);
});

test('случайная семья действительно задаёт начало распределения', () => {
  const families = [
    family('member', 8, 'A'),
    family('w1', 8, 'A', { groupingPaused: true }),
    family('w2', 8, 'A', { groupingPaused: true }),
    family('w3', 8, 'A', { groupingPaused: true }),
  ];
  const result = fillExistingGroups(
    [{ id: 'group', memberFamilyIds: ['member'] }],
    families,
    [],
    () => 0.5
  );
  assert.equal(result.starterFamilyId, 'w2');
  assert.equal(result.assignments[0].familyId, 'w2');
});

test('пожелание к участнику существующей группы важнее возраста и башни', () => {
  const families = [
    family('young', 6, 'A'),
    family('friend', 14, 'B'),
    family('waiting', 6, 'A', { groupingPaused: true }),
  ];
  const result = fillExistingGroups([
    { id: 'young-group', memberFamilyIds: ['young'] },
    { id: 'friend-group', memberFamilyIds: ['friend'] },
  ], families, [{ a: 'waiting', b: 'friend' }], () => 0);
  assert.deepEqual(result.assignments, [{ familyId: 'waiting', groupId: 'friend-group' }]);
});

test('пожелание сохраняется, даже если нужная группа уже набрана до шести', () => {
  const families = [
    ...Array.from({ length: 6 }, (_, index) => family(`friend${index + 1}`, 12, 'B')),
    family('other', 6, 'A'),
    family('waiting', 6, 'A', { groupingPaused: true }),
  ];
  const result = fillExistingGroups([
    { id: 'full-friend-group', memberFamilyIds: families.slice(0, 6).map((item) => item.id) },
    { id: 'other-group', memberFamilyIds: ['other'] },
  ], families, [{ a: 'waiting', b: 'friend1' }], () => 0);
  assert.deepEqual(result.assignments, [{ familyId: 'waiting', groupId: 'full-friend-group' }, { familyId: 'friend2', groupId: 'other-group' }]);
  assert.equal(result.groups.find((group) => group.id === 'full-friend-group').childCount, 6);
});

test('для двух ожидающих создаётся новая группа вместо переполнения', () => {
  const families = [
    ...Array.from({ length: 12 }, (_, index) => family(`m${index + 1}`, 8, 'A')),
    family('waiting1', 8, 'A', { groupingPaused: true }),
    family('waiting2', 8, 'A', { groupingPaused: true }),
  ];
  const result = fillExistingGroups(
    [
      { id: 'full1', memberFamilyIds: families.slice(0, 6).map((item) => item.id) },
      { id: 'full2', memberFamilyIds: families.slice(6, 12).map((item) => item.id) },
    ],
    families,
    [],
    () => 0
  );
  assert.deepEqual(result.groups.map((group) => group.childCount), [6, 6, 2]);
  assert.deepEqual(result.unassignedFamilyIds, []);
  assert.equal(result.createdGroupIds.length, 1);
});

test('если ожидают больше четырёх детей, создаётся новая группа', () => {
  const families = [
    ...Array.from({ length: 8 }, (_, index) => family(`m${index + 1}`, 8, 'A')),
    ...Array.from({ length: 6 }, (_, index) => family(`waiting${index + 1}`, 8, 'B', { groupingPaused: true })),
  ];
  const result = fillExistingGroups(
    [{ id: 'group_1', memberFamilyIds: families.slice(0, 8).map((item) => item.id) }],
    families,
    [],
    () => 0
  );
  assert.deepEqual(result.createdGroupIds, ['group_2']);
  assert.equal(result.groups.find((group) => group.id === 'group_2').childCount, 6);
  assert.deepEqual(result.unassignedFamilyIds, []);
});

function assertTowerBlocks(route) {
  const visited = new Set();
  let previousTower = null;
  for (const stop of route.stops) {
    if (stop.tower !== previousTower) {
      assert.ok(!visited.has(stop.tower), `Route returns to ${stop.tower}`);
      visited.add(stop.tower);
      previousTower = stop.tower;
    }
  }
}

test('маршрут содержит десять адресов и проходит каждую башню целиком', () => {
  const towers = ['A', 'B', 'C', 'D'];
  const hosts = towers.flatMap((tower, towerIndex) => Array.from({ length: 4 }, (_, index) => (
    family(`h${towerIndex + 1}${index + 1}`, 8, tower, {
      floor: index + 1,
      apartmentCode: `${towerIndex + 1}0${index + 1}`,
      hosting: true,
    })
  )));
  const walker = family('walker', 8, 'A');
  const [route] = buildRoutes([{ id: 'group_1', memberFamilyIds: [walker.id] }], [...hosts, walker]);

  assert.equal(route.stops.length, TARGET_ROUTE_STOPS);
  assert.ok(route.stops.length <= MAX_ROUTE_STOPS);
  assert.equal(new Set(route.stops.map((stop) => stop.hostId)).size, route.stops.length);
  assertTowerBlocks(route);

});

test('квесты и обычные квартиры распределяются между маршрутами равномерно', () => {
  const towers = ['A', 'B', 'C', 'D'];
  const hosts = Array.from({ length: 16 }, (_, index) => family(`h${index + 1}`, 8, towers[index % towers.length], {
    floor: 1 + Math.floor(index / towers.length),
    apartmentCode: String(100 + index),
    hosting: true,
    quest: index < 2,
    questDurationMin: index < 2 ? 20 : null,
  }));
  const walkers = Array.from({ length: 6 }, (_, index) => family(`w${index + 1}`, 8, towers[index % towers.length]));
  const groups = walkers.map((walker, index) => ({ id: `group_${index + 1}`, memberFamilyIds: [walker.id] }));
  const routes = buildRoutes(groups, [...hosts, ...walkers]);
  const questCounts = routes.map((route) => route.stops.filter((stop) => stop.isQuest).length);
  const candyCounts = routes.map((route) => route.stops.filter((stop) => !stop.isQuest).length);
  assert.ok(routes.every((route) => route.stops.length === TARGET_ROUTE_STOPS));
  assert.ok(Math.max(...questCounts) - Math.min(...questCounts) <= 1);
  assert.ok(Math.max(...candyCounts) - Math.min(...candyCounts) <= 1);
  assert.ok(routes.every((route) => route.stops.some((stop) => stop.isQuest) && route.stops.some((stop) => !stop.isQuest)));
});

test('интервалы посещений одной квартиры у разных групп не пересекаются', () => {
  const towers = ['A', 'B', 'C', 'D'];
  const hosts = Array.from({ length: 20 }, (_, index) => family(`host${index + 1}`, 8, towers[index % towers.length], {
    floor: 1 + Math.floor(index / towers.length),
    apartmentCode: String(200 + index),
    hosting: true,
  }));
  const walkers = Array.from({ length: 6 }, (_, index) => family(`walker${index + 1}`, 8, towers[index % towers.length]));
  const groups = walkers.map((walker, index) => ({ id: `group_${index + 1}`, memberFamilyIds: [walker.id] }));
  const routes = buildRoutes(groups, [...hosts, ...walkers]);
  routes.forEach(assertTowerBlocks);
  const { buildSchedule } = require('../lib/route-schedule');
  const schedule = buildSchedule(routes.map((route) => ({ ...groups.find((g) => g.id === route.groupId), stops: route.stops })), 0);
  assert.equal(schedule.conflicts.length, 0);
});

test('собственная конфетная квартира исключается, а собственный квест разрешён', () => {
  const onlyFamily = family('only', 8, 'A', { hosting: true });
  const group = { id: 'group_1', memberFamilyIds: [onlyFamily.id] };
  assert.equal(buildRoutes([group], [onlyFamily])[0].stops.length, 0);
  const [route] = buildRoutes([group], [{ ...onlyFamily, quest: true }]);
  assert.equal(route.stops.length, 1);
  assert.equal(route.stops[0].hostId, onlyFamily.id);
  assert.equal(route.stops[0].departure - route.stops[0].arrival, 15);
});

test('собственная квартира не попадает в маршрут, а в единственной внешней башне берутся максимум три точки', () => {
  const memberHost = family('member', 8, 'A', { hosting: true });
  const externalHosts = Array.from({ length: TARGET_ROUTE_STOPS }, (_, index) => family(`host${index + 1}`, 8, 'B', {
    hosting: true,
    floor: index + 1,
    apartmentCode: String(300 + index),
  }));
  const [route] = buildRoutes([{ id: 'group_1', memberFamilyIds: [memberHost.id] }], [memberHost, ...externalHosts]);
  assert.equal(route.stops.length, 3);
  assert.equal(route.shortened, true);
  assert.ok(route.stops.every((stop) => stop.hostId !== memberHost.id));
});


test('oversized wish component stays together without unrelated families', () => {
  const families = Array.from({ length: 9 }, (_, i) => family(`w${i}`, 8, 'A'));
  const wishes = Array.from({ length: 6 }, (_, i) => ({ a: `w${i}`, b: `w${i + 1}` }));
  const groups = buildGroups(families, wishes);
  assert.deepEqual(groups.map((g) => g.childCount).sort((a, b) => a - b), [2, 7]);
  assert.equal(new Set(groups.flatMap((g) => g.memberFamilyIds)).size, 9);
});

test('manual assignments cannot retain twelve children without wishes', () => {
  const families = Array.from({ length: 12 }, (_, i) => family(`m${i}`, 8, 'A', { manualGroupId: 'manual' }));
  const groups = buildGroups(families, []);
  assert.deepEqual(groups.map((g) => g.childCount), [6, 6]);
  assert.equal(groups[0].id, 'manual');
  assert.equal(new Set(groups.map((g) => g.id)).size, 2);
});

test('nine waiting children form two new groups when existing groups are full', () => {
  const families = Array.from({ length: 15 }, (_, i) => family(`n${i}`, 8, 'A'));
  const result = fillExistingGroups([{ id: 'full', memberFamilyIds: families.slice(0, 6).map((f) => f.id) }], families, [], () => 0);
  assert.deepEqual(result.groups.map((g) => g.childCount), [6, 6, 3]);
  assert.equal(result.assignments.length, 9);
});


test('three Vienna stops remain together with Stockholm, including unavoidable stage conflicts', () => {
  const hosts = ['Вена', 'Вена', 'Вена', 'Стокгольм'].map((tower, i) => family(`h${i}`, 8, tower, {
    hosting: true, floor: i + 1, quest: i === 1,
  }));
  const walkers = Array.from({ length: 7 }, (_, i) => family(`walker${i}`, 8, 'Вена'));
  const routes = buildRoutes(walkers.map((w) => ({ id: w.id, memberFamilyIds: [w.id] })), [...hosts, ...walkers]);
  for (const route of routes) {
    assertTowerBlocks(route);
    assert.equal(route.stops.length, 4);
    assert.equal(new Set(route.stops.map((s) => s.hostId)).size, 4);
    assert.equal(route.homeTower, route.stops[0].tower);
    assert.equal(route.totalMin, route.stops.at(-1).departure);
    route.stops.forEach((stop, i) => {
      assert.equal(stop.seq, i + 1);
      assert.ok(stop.departure > stop.arrival);
      if (i) assert.ok(stop.arrival >= route.stops[i - 1].departure + 5);
    });
  }
});


test('a whole unlinked family is moved to a new group while existing wish pairs stay', () => {
  const families = Array.from({ length: 7 }, (_, i) => family(`p${i}`, 8, 'A'));
  families[5].children.push({ name: 'Sibling', age: 9 });
  const wishes = [{ a: 'p6', b: 'p0' }, { a: 'p1', b: 'p2' }, { a: 'p3', b: 'p4' }];
  const result = fillExistingGroups([{ id: 'full', memberFamilyIds: families.slice(0, 6).map((f) => f.id) }], families, wishes, () => 0);
  const target = result.groups.find((g) => g.id === 'full');
  assert.deepEqual(target.memberFamilyIds.sort(), ['p0', 'p1', 'p2', 'p3', 'p4', 'p6']);
  assert.equal(target.childCount, 6);
  assert.equal(result.createdGroupIds.length, 1);
  assert.deepEqual(result.groups.find((g) => g.id !== 'full').memberFamilyIds, ['p5']);
  assert.equal(new Set(result.groups.flatMap((g) => g.memberFamilyIds)).size, families.length);
});

test('an oversized wish chain is preserved when there are no unrelated families to move', () => {
  const families = Array.from({ length: 8 }, (_, i) => family(`c${i}`, 8, 'A'));
  const wishes = Array.from({ length: 7 }, (_, i) => ({ a: `c${i}`, b: `c${i + 1}` }));
  const result = fillExistingGroups([{ id: 'full', memberFamilyIds: families.slice(0, 6).map((f) => f.id) }], families, wishes, () => 0);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].childCount, 8);
  assert.equal(result.assignments.length, 2);
});

test('waiting wishes join friends from multiple existing groups and follow transitive links', () => {
  const families = Array.from({ length: 5 }, (_, i) => family(`t${i}`, 8, 'A'));
  const wishes = [{ a: 't4', b: 't0' }, { a: 't4', b: 't1' }, { a: 't1', b: 't2' }];
  const result = fillExistingGroups([{ id: 'a', memberFamilyIds: ['t0'] }, { id: 'b', memberFamilyIds: ['t1', 't2', 't3'] }], families, wishes, () => 0);
  const together = result.groups.find((g) => g.memberFamilyIds.includes('t4'));
  assert.ok(['t0', 't1', 't2', 't4'].every((id) => together.memberFamilyIds.includes(id)));
  assert.equal(new Set(result.groups.flatMap((g) => g.memberFamilyIds)).size, 5);
  assert.equal(result.groups.flatMap((g) => g.memberFamilyIds).length, 5);
});

test('нагрузка выравнивается по квартирам, включая одиночные точки и башни разного размера', () => {
  const sizes = [1, 1, 2, 2, 2, 3, 4, 5];
  const hosts = sizes.flatMap((size, tower) => Array.from({ length: size }, (_, index) => family(`host-${tower}-${index}`, 8, `T${tower}`, {
    hosting: true, quest: tower % 2 === 0, questDurationMin: 12 + index,
  })));
  const groups = Array.from({ length: 17 }, (_, index) => ({ id: `g${index}`, memberFamilyIds: [hosts[index % hosts.length].id] }));
  const routes = buildRoutes(groups, hosts);
  assert.deepEqual(buildRoutes(groups, hosts), routes, 'repeated rebuild is deterministic');
  const loads = new Map(hosts.map((host) => [host.id, 0]));
  routes.forEach((route, index) => {
    assert.equal(route.stops.length, TARGET_ROUTE_STOPS);
    assert.equal(new Set(route.stops.map((stop) => stop.hostId)).size, TARGET_ROUTE_STOPS);
    assert.ok(!route.stops.some((stop) => !stop.isQuest && groups[index].memberFamilyIds.includes(stop.hostId)));
    assertTowerBlocks(route);
    for (const stop of route.stops) {
      loads.set(stop.hostId, loads.get(stop.hostId) + 1);
      const host = hosts.find((item) => item.id === stop.hostId);
      assert.equal(stop.departure - stop.arrival, host.quest ? 15 : 5);
    }
  });
  // Per-route rounding can give quest and candy hosts different average loads.
  for (const quest of [true, false]) {
    const values = hosts.filter((host) => host.quest === quest).map((host) => loads.get(host.id));
    assert.ok(Math.max(...values) - Math.min(...values) <= 1, JSON.stringify(values));
  }
});

test('выравнивание сохраняет закреплённые остановки и дополнительные посещения', () => {
  const hosts = Array.from({ length: 20 }, (_, index) => family(`host${index}`, 8, `T${index % 5}`, { hosting: true }));
  const groups = Array.from({ length: 12 }, (_, index) => ({ id: `g${index}`, memberFamilyIds: [] }));
  const extras = groups.map((group) => ({ groupId: group.id, familyId: hosts[0].id }));
  const fixed = new Map([['g0', ['family:host1', 'family:host2']]]);
  const routes = buildRoutes(groups, hosts, [], extras, fixed);
  assert.deepEqual(routes[0].stops.map((stop) => stop.hostId).sort(), ['host0', 'host1', 'host2']);
  assert.ok(routes.every((route) => route.stops.filter((stop) => stop.hostId === 'host0').length === 1));
  assert.ok(routes.slice(1).every((route) => route.stops.length === TARGET_ROUTE_STOPS + 1));
});
