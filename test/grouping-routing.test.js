const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGroups,
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

test('при достаточном количестве детей группы имеют размер 5–8 и близкий возраст', () => {
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

test('при одинаковом возрасте алгоритм сначала собирает детей одной башни', () => {
  const families = [
    ...Array.from({ length: 6 }, (_, index) => family(`a${index + 1}`, 8, 'A')),
    ...Array.from({ length: 6 }, (_, index) => family(`b${index + 1}`, 8, 'B')),
  ];
  const groups = buildGroups(families, []);
  const byId = new Map(families.map((item) => [item.id, item]));
  assert.equal(groups.length, 2);
  for (const group of groups) {
    assert.equal(new Set(group.memberFamilyIds.map((id) => byId.get(id).tower)).size, 1);
  }
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
