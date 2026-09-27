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
    quest: false,
    questDurationMin: null,
    manualGroupId: null,
    groupingPaused: false,
    cancelled: false,
    ...overrides,
  };
}

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

test('группы сохраняют близкий возраст, а маленький хвост распределяют сверх восьми', () => {
  const families = Array.from({ length: 18 }, (_, index) => (
    family(`f${index + 1}`, index < 6 ? 5 : index < 12 ? 9 : 13, index < 9 ? 'A' : 'B')
  ));
  const groups = buildGroups(families, []);
  const byId = new Map(families.map((item) => [item.id, item]));
  for (const group of groups) {
    assert.ok(group.childCount >= MIN_GROUP_SIZE && group.childCount <= MAX_GROUP_SIZE + 4);
    const ages = group.memberFamilyIds.flatMap((id) => byId.get(id).children.map((child) => child.age));
    assert.ok(Math.max(...ages) - Math.min(...ages) <= 8);
  }
});

test('при остатке четыре ребёнка не создаётся отдельная группа', () => {
  const families = [
    ...Array.from({ length: 6 }, (_, index) => family(`a${index + 1}`, 8, 'A')),
    ...Array.from({ length: 6 }, (_, index) => family(`b${index + 1}`, 8, 'B')),
  ];
  const groups = buildGroups(families, []);
  const byId = new Map(families.map((item) => [item.id, item]));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].childCount, 12);
  assert.equal(new Set(groups[0].memberFamilyIds.map((id) => byId.get(id).tower)).size, 2);
});

test('группы последовательно заполняются до восьми без маленького хвоста', () => {
  const families = Array.from({ length: 21 }, (_, index) => family(`f${index + 1}`, 8, 'A'));
  const groups = buildGroups(families, []);
  assert.deepEqual(groups.map((group) => group.childCount), [8, 8, 5]);
});

test('при первом распределении хвост до четырёх детей распределяется по существующим группам', () => {
  const families = Array.from({ length: 19 }, (_, index) => family(`f${index + 1}`, 8, 'A'));
  const groups = buildGroups(families, []);
  assert.deepEqual(groups.map((group) => group.childCount), [10, 9]);
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

test('пожелание сохраняется, даже если нужная группа уже набрана до восьми', () => {
  const families = [
    ...Array.from({ length: 8 }, (_, index) => family(`friend${index + 1}`, 12, 'B')),
    family('other', 6, 'A'),
    family('waiting', 6, 'A', { groupingPaused: true }),
  ];
  const result = fillExistingGroups([
    { id: 'full-friend-group', memberFamilyIds: families.slice(0, 8).map((item) => item.id) },
    { id: 'other-group', memberFamilyIds: ['other'] },
  ], families, [{ a: 'waiting', b: 'friend1' }], () => 0);
  assert.deepEqual(result.assignments, [{ familyId: 'waiting', groupId: 'full-friend-group' }]);
  assert.equal(result.groups.find((group) => group.id === 'full-friend-group').childCount, 9);
});

test('остаток до четырёх детей равномерно добавляется в полные группы', () => {
  const families = [
    ...Array.from({ length: 16 }, (_, index) => family(`m${index + 1}`, 8, 'A')),
    family('waiting1', 8, 'A', { groupingPaused: true }),
    family('waiting2', 8, 'A', { groupingPaused: true }),
  ];
  const result = fillExistingGroups(
    [
      { id: 'full1', memberFamilyIds: families.slice(0, 8).map((item) => item.id) },
      { id: 'full2', memberFamilyIds: families.slice(8, 16).map((item) => item.id) },
    ],
    families,
    [],
    () => 0
  );
  assert.deepEqual(result.groups.map((group) => group.childCount), [9, 9]);
  assert.deepEqual(result.unassignedFamilyIds, []);
  assert.deepEqual(result.createdGroupIds, []);
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

test('маршрут содержит до 8–10 адресов и идёт блоками не более трёх адресов одной башни', () => {
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
  let runLength = 0;
  let previousTower = null;
  for (const stop of route.stops) {
    runLength = stop.tower === previousTower ? runLength + 1 : 1;
    assert.ok(runLength <= 3);
    previousTower = stop.tower;
  }
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
