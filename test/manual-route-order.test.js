const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { db } = require('../db');
const admin = require('../routes/admin');
const handler = admin.stack.find((entry) => entry.route?.path === '/groups/:id/route' && entry.route.methods.put).route.stack[0].handle;
async function reorder(stopIds) {
  let result;
  const res = { status(code) { this.code = code; return this; }, json(body) { result = { status: this.code || 200, body }; return this; } };
  await handler({ params: { id: 'a' }, body: { stopIds } }, res, (error) => { throw error; });
  return result;
}
test('manual route can save stage conflicts but must retain every stop exactly once', async () => {
  db.prepare("INSERT INTO groups(id,name) VALUES ('a','A'),('b','B')").run();
  const insert = db.prepare("INSERT INTO route_stops(group_id,host_id,host_type,seq,tower,floor) VALUES (?,?,'family',?,'Tower',1)");
  const one = Number(insert.run('a', 'one', 1).lastInsertRowid);
  const two = Number(insert.run('a', 'two', 2).lastInsertRowid);
  insert.run('b', 'two', 1);
  insert.run('b', 'one', 2);
  const before = db.prepare("SELECT * FROM route_stops WHERE group_id='b' ORDER BY seq").all();
  assert.equal((await reorder([two, one])).status, 200);
  const ids = () => db.prepare("SELECT id FROM route_stops WHERE group_id='a' ORDER BY seq").all().map((r) => r.id);
  assert.deepEqual(ids(), [two, one]);
  assert.deepEqual(db.prepare("SELECT * FROM route_stops WHERE group_id='b' ORDER BY seq").all(), before);
  for (const invalid of [[two], [one, one], [one, 999], [one, two, 999]]) {
    assert.equal((await reorder(invalid)).status, 400);
    assert.deepEqual(ids(), [two, one]);
  }
});
