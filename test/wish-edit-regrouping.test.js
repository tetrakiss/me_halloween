const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { db } = require('../db');
const router = require('../routes/families');
const handler = router.stack.find((entry) => entry.route?.path === '/me' && entry.route.methods.patch).route.stack[0].handle;
const { setFamilyWish } = require('../lib/wish-links');
async function edit(id, wished) {
  let result;
  const req = { platform: 'dev', platformUserId: id, body: { wishFamilyId: wished } };
  const res = { status(code) { this.code = code; return this; }, json(body) { result = { status: this.code || 200, body }; return this; } };
  await handler(req, res, (error) => { throw error; });
  return result;
}
let apartmentNumber = 100;
function reset() {
  apartmentNumber = 100;
  db.exec('DELETE FROM route_stops; DELETE FROM group_members; DELETE FROM groups; DELETE FROM families;');
}
function family(id, childCount = 1) {
  db.prepare("INSERT INTO families(id,family_code,tower,floor,apartment_code,walking,created_at) VALUES (?,?,'A',1,?,1,0)").run(id,id,String(++apartmentNumber));
  db.prepare("INSERT INTO parent_links(platform,platform_user_id,family_id) VALUES ('dev',?,?)").run(id,id);
  for (let i=0; i<childCount; i++) db.prepare('INSERT INTO children(family_id,name,age) VALUES (?,?,8)').run(id,`Child ${i}`);
}
function group(id, members) {
  db.prepare('INSERT INTO groups(id,name,child_count) VALUES (?,?,?)').run(id,`Name ${id}`,members.length);
  for(const member of members) db.prepare('INSERT INTO group_members(group_id,family_id) VALUES (?,?)').run(id,member);
}
const groupOf = (id) => db.prepare('SELECT group_id FROM group_members WHERE family_id=?').get(id)?.group_id;

test('editing wishes joins existing groups, preserves chains, displaces only unrelated members, and is idempotent', async () => {
  reset();
  for(let i=0;i<12;i++)family(`f${i}`);
  group('source',['f0','f1','f2','f3','f4','f5']);
  group('target',['f6','f7','f8','f9','f10','f11']);
  setFamilyWish(db,'f1','f0');
  setFamilyWish(db,'f7','f8');
  const result=await edit('f0','f6');
  assert.equal(result.status,200);
  assert.ok(result.body.regrouping);
  for(const id of ['f0','f1','f6','f7','f8'])assert.equal(groupOf(id),'target');
  assert.equal(db.prepare("SELECT child_count FROM groups WHERE id='target'").get().child_count,6);
  assert.equal(db.prepare("SELECT name FROM groups WHERE id='target'").get().name,'Name target');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM group_members').get().n,12);
  assert.equal(db.prepare('SELECT COUNT(DISTINCT family_id) AS n FROM group_members').get().n,12);
  const before=db.prepare('SELECT * FROM group_members ORDER BY group_id,family_id').all();
  assert.equal((await edit('f0','f6')).body.regrouping,null);
  assert.deepEqual(db.prepare('SELECT * FROM group_members ORDER BY group_id,family_id').all(),before);
});

test('a waiting linked family joins a full target without admitting unrelated waiting families', async () => {
  reset();
  for(let i=0;i<12;i++)family(`f${i}`);
  family('waiting1',2);family('unrelated1');
  group('full',['f0','f1','f2','f3','f4','f5']);
  group('other',['f6','f7','f8','f9','f10','f11']);
  const result=await edit('waiting1','f0');
  assert.equal(groupOf('waiting1'),'full');
  assert.equal(groupOf('unrelated1'),undefined);
  assert.equal(result.body.regrouping.createdGroupCount,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM group_members').get().n,13);
  assert.ok(db.prepare('SELECT child_count FROM groups').all().every(g=>g.child_count<=6));
});

test('a regrouping failure rolls back both the changed wish and group membership', async () => {
  reset();family('a1');family('b1');group('a',['a1']);group('b',['b1']);
  db.exec("CREATE TRIGGER reject_regroup BEFORE UPDATE ON groups BEGIN SELECT RAISE(ABORT,'test regroup failure'); END;");
  try { await assert.rejects(edit('a1','b1'), /test regroup failure/); }
  finally { db.exec('DROP TRIGGER reject_regroup'); }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wish_links').get().n,0);
  assert.equal(groupOf('a1'),'a');assert.equal(groupOf('b1'),'b');
});

test('saving a wish before any groups exist only stores the link', async () => {
  reset();family('a1');family('b1');
  const result=await edit('a1','b1');
  assert.equal(result.status,200);
  assert.equal(result.body.regrouping,null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM groups').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wish_links').get().n,1);
});
