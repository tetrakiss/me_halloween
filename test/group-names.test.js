const test = require('node:test');
const assert = require('node:assert/strict');
const { assignGroupNames } = require('../lib/group-names');
const catalog = [
  { id: 1, name: 'Тыквята', age_min: 1, age_max: 6 },
  { id: 2, name: 'Патруль', age_min: 7, age_max: 10 },
  { id: 3, name: 'Стражи', age_min: 11, age_max: 17 },
];
test('названия подбираются по возрасту, ручные названия сохраняются', () => {
  const groups = assignGroupNames([
    { id: 'g1', avgAge: 5 }, { id: 'g2', avgAge: 9 }, { id: 'g3', avgAge: 14 },
    { id: 'g4', avgAge: 10 },
  ], catalog, new Map([['g4', { name: 'Моя команда' }]]));
  assert.deepEqual(groups.map((group) => group.name), ['Тыквята', 'Патруль', 'Стражи', 'Моя команда']);
});
test('при нехватке названий и пустом каталоге названия уникальны', () => {
  for (const names of [catalog, []]) {
    const groups = assignGroupNames(Array.from({ length: 20 }, (_, index) => ({ id: `g${index}`, avgAge: 8 })), names);
    assert.equal(new Set(groups.map((group) => group.name)).size, 20);
  }
});
