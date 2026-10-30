const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { db } = require('../db');
const admin = require('../routes/admin');
const handler = admin.stack.find((entry) => entry.route?.path === '/override').route.stack[0].handle;
async function apply(familyId, groupId) {
  let result;
  const res = { status(code) { this.code = code; return this; }, json(body) { result = { status: this.code || 200, body }; return this; } };
  await handler({ body: { familyId, groupId } }, res, (error) => { throw error; });
  return result;
}

test('manual group applies immediately and updates both group totals without duplicating memberships', async () => {
  const insert = db.prepare("INSERT INTO families(id,family_code,tower,floor,apartment_code,walking,candy_brought,created_at) VALUES (?,?,'A',1,?,1,1,0)");
  for (const [id, age] of [['move',8],['old',10],['target',6]]) {
    insert.run(id,id,id);
    db.prepare('INSERT INTO children(family_id,name,age) VALUES (?,?,?)').run(id,id,age);
  }
  db.prepare("INSERT INTO groups(id,name,child_count) VALUES ('auto','Auto',2),('chosen','Chosen',1)").run();
  db.prepare("INSERT INTO group_members(group_id,family_id) VALUES ('auto','move'),('auto','old'),('chosen','target')").run();
  db.prepare("INSERT INTO route_stops(group_id,host_id,host_type,seq,tower,floor) VALUES ('chosen','move','family',1,'A',1),('chosen','another','family',2,'B',2)").run();
  assert.equal((await apply('move','chosen')).status,200);
  const membership = () => db.prepare("SELECT group_id FROM group_members WHERE family_id='move'").all();
  assert.deepEqual(membership(),[{group_id:'chosen'}]);
  assert.equal(db.prepare("SELECT manual_group_id FROM families WHERE id='move'").get().manual_group_id,'chosen');
  assert.equal(db.prepare("SELECT child_count FROM groups WHERE id='auto'").get().child_count,1);
  assert.equal(db.prepare("SELECT child_count FROM groups WHERE id='chosen'").get().child_count,2);
  assert.equal(db.prepare("SELECT 1 FROM route_stops WHERE group_id='chosen' AND host_id='move'").get(),undefined);
  assert.equal(db.prepare("SELECT seq FROM route_stops WHERE group_id='chosen' AND host_id='another'").get().seq,1);
  assert.equal((await apply('move','chosen')).status,200);
  const saveFamily = admin.stack.find((entry) => entry.route?.path === '/families/:id' && entry.route.methods.patch).route.stack[0].handle;
  const saveResponse = { status() { return this; }, json() { return this; } };
  await saveFamily({ params: { id: 'move' }, body: { candyBrought: true } }, saveResponse, (error) => { throw error; });
  assert.deepEqual(membership(), [{ group_id: 'chosen' }]);
  assert.equal(membership().length,1);
  assert.equal((await apply('move',null)).status,200);
  assert.equal(db.prepare("SELECT manual_group_id FROM families WHERE id='move'").get().manual_group_id,null);
  assert.deepEqual(membership(),[{group_id:'chosen'}]);
  assert.equal((await apply('move','missing')).status,404);
  assert.equal((await apply('missing',null)).status,404);
  assert.equal((await apply('move',{})).status,400);
  assert.deepEqual(membership(),[{group_id:'chosen'}]);
});

test('manual override bypasses capacity while ordinary assignment still enforces it', async () => {
  for(let i=0;i<6;i++) {
    db.prepare("INSERT INTO families(id,family_code,tower,floor,apartment_code,walking,candy_brought,created_at) VALUES (?,?,'B',1,?,1,1,0)").run(`full${i}`,`full${i}`,`${i}`);
    db.prepare('INSERT INTO children(family_id,name,age) VALUES (?,?,8)').run(`full${i}`,`Child ${i}`);
  }
  db.prepare("INSERT INTO groups(id,name,child_count) VALUES ('full','Full',6)").run();
  for(let i=0;i<6;i++)db.prepare("INSERT INTO group_members(group_id,family_id) VALUES ('full',?)").run(`full${i}`);
  const ordinary = admin.stack.find((entry) => entry.route?.path === '/groups/:id/members' && entry.route.methods.post).route.stack[0].handle;
  let ordinaryStatus;
  const res = { status(code) { ordinaryStatus = code; return this; }, json() { return this; } };
  await ordinary({ params: { id: 'full' }, body: { familyId: 'move' } }, res, (error) => { throw error; });
  assert.equal(ordinaryStatus,400);
  assert.equal(db.prepare("SELECT group_id FROM group_members WHERE family_id='move'").get().group_id,'chosen');
  assert.equal(db.prepare("SELECT manual_group_id FROM families WHERE id='move'").get().manual_group_id,null);
  assert.equal((await apply('move','full')).status,200);
  assert.equal(db.prepare("SELECT group_id FROM group_members WHERE family_id='move'").get().group_id,'full');
  assert.equal(db.prepare("SELECT manual_group_id FROM families WHERE id='move'").get().manual_group_id,'full');
  assert.equal(db.prepare("SELECT child_count FROM groups WHERE id='full'").get().child_count,7);
});
