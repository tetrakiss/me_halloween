const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { db } = require('../db');
const router = require('../routes/families');
const me = router.stack.find((layer) => layer.route?.path === '/me' && layer.route.methods.get).route.stack[0].handle;

test('состав своей группы не раскрывает состав приходящих или чужих групп', () => {
  const family = db.prepare('INSERT INTO families(id, family_code, tower, floor, apartment_code, hosting, created_at) VALUES (?, ?, ?, 1, ?, 1, 0)');
  const child = db.prepare('INSERT INTO children(family_id, name, age) VALUES (?, ?, ?)');
  for (const [id, name, age] of [['own', 'Алиса', 7], ['friend', 'Миша', 9], ['other', 'Чужой ребёнок', 14], ['host', 'Хозяин', 10]]) {
    family.run(id, id.toUpperCase(), 'Вена', id);
    child.run(id, name, age);
    db.prepare('INSERT INTO parent_links(platform, platform_user_id, family_id) VALUES (\'dev\', ?, ?)').run(id, id);
  }
  db.prepare('INSERT INTO groups(id, name, child_count) VALUES (\'ours\', \'Тыквята\', 2), (\'theirs\', \'Стражи\', 1)').run();
  db.prepare('INSERT INTO group_members(group_id, family_id) VALUES (\'ours\', \'own\'), (\'ours\', \'friend\'), (\'theirs\', \'other\')').run();
  db.prepare("INSERT INTO route_stops(group_id, host_id, seq, tower, floor, arrival_min) VALUES ('theirs', 'own', 1, 'Вена', 1, 0), ('ours', 'host', 1, 'Вена', 1, 0)").run();
  let result;
  me({ platform: 'dev', platformUserId: 'own' }, { json(value) { result = value; } });
  assert.equal(result.group.families.length, 2);
  assert.ok(result.group.families.some((entry) => entry.isOwnFamily));
  assert.equal(result.incomingVisits.groups[0].childCount, 1);
  assert.equal(JSON.stringify(result).includes('Чужой ребёнок'), false);
  assert.equal(JSON.stringify(result.group.families).includes('familyCode'), false);
  me({ platform: 'dev', platformUserId: 'host' }, { json(value) { result = value; } });
  assert.equal(result.group, null);
  assert.equal(result.incomingVisits.groups[0].childCount, 2);
  assert.equal(JSON.stringify(result.incomingVisits).includes('Алиса'), false);
});
