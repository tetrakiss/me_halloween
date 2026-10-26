const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { db } = require('../db');
const router = require('../routes/admin');
const handler = router.stack.find((entry) => entry.route?.path === '/groups/distribute-unassigned').route.stack[0].handle;

test('distribution persists relocated members without duplicates and can be repeated', async () => {
  const insert = db.prepare("INSERT INTO families(id,family_code,tower,floor,apartment_code,candy_brought,created_at) VALUES (?,?,'Вена',1,?,1,0)");
  for (let i = 0; i < 13; i += 1) {
    insert.run(`f${i}`, `f${i}`, `${i}`);
    db.prepare('INSERT INTO children(family_id,name,age) VALUES (?,?,8)').run(`f${i}`, `Child ${i}`);
  }
  for (let g = 0; g < 2; g += 1) {
    db.prepare('INSERT INTO groups(id,name,child_count) VALUES (?,?,6)').run(`old${g}`, `Group ${g}`);
    for (let i = g * 6; i < g * 6 + 6; i += 1) db.prepare('INSERT INTO group_members(group_id,family_id) VALUES (?,?)').run(`old${g}`, `f${i}`);
  }
  db.prepare("INSERT INTO wish_links(family_a,family_b) VALUES ('f0','f12')").run();
  let body;
  const response = { json(value) { body = value; return this; }, status() { return this; } };
  await handler({}, response, (error) => { throw error; });
  assert.equal(body.assignedFamilyCount, 1);
  assert.equal(body.movedFamilyCount, 1);
  assert.equal(body.createdGroupCount, 1);
  assert.equal(db.prepare("SELECT group_id FROM group_members WHERE family_id = 'f12'").get().group_id, 'old0');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM group_members').get().n, 13);
  assert.equal(db.prepare('SELECT COUNT(DISTINCT family_id) AS n FROM group_members').get().n, 13);
  assert.ok(db.prepare('SELECT child_count FROM groups').all().every((g) => g.child_count <= 6));
  assert.equal(db.prepare("SELECT name FROM groups WHERE id = 'old0'").get().name, 'Group 0');
  const snapshot = db.prepare('SELECT * FROM group_members ORDER BY group_id,family_id').all();
  await handler({}, response, (error) => { throw error; });
  assert.equal(body.assignedFamilyCount, 0);
  assert.deepEqual(db.prepare('SELECT * FROM group_members ORDER BY group_id,family_id').all(), snapshot);
});
