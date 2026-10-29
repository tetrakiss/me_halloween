const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { db } = require('../db');
const { rebuildStoredRoutes } = require('../lib/extra-host-visits');
const { buildRoutes } = require('../lib/grouping-routing');
const router = require('../routes/admin');
const route = (path) => router.stack.find((r) => r.route?.path === path && r.route.methods.post).route.stack[0].handle;
async function call(fn, req) {
  let result;
  await fn(req, { status(code) { this.code=code;return this; }, json(body) { result={status:this.code||200,body}; } }, (error) => { throw error; });
  return result;
}
function blocks(stops) {
  const towers=stops.map(s=>s.tower).filter((t,i,a)=>!i||t!==a[i-1]);
  assert.equal(new Set(towers).size,towers.length);
}

test('admin adds extra visits without replacing automatic stops, duplicates, membership changes or notification writes', async () => {
  const insert=db.prepare('INSERT INTO families(id,family_code,tower,floor,apartment_code,hosting,walking,candy_brought,created_at) VALUES (?,?,?,?,?,?,?,1,0)');
  for(let i=0;i<14;i++)insert.run(`h${i}`,`c${i}`,`T${i%5}`,i+1,`${i+100}`,1,0);
  insert.run('walker','walk','A',1,'999',0,1);
  for(let i=0;i<6;i++)db.prepare("INSERT INTO children(family_id,name,age) VALUES ('walker',?,?)").run(`Child ${i}`,4+i%4);
  db.prepare("INSERT INTO groups(id,name,child_count) VALUES ('group_1','Тыквята',6)").run();
  db.prepare("INSERT INTO group_members(group_id,family_id) VALUES ('group_1','walker')").run();
  rebuildStoredRoutes(db);
  const before=db.prepare('SELECT host_id FROM route_stops').all().map(r=>r.host_id);
  assert.equal(before.length,8);
  const beforeRows=db.prepare('SELECT host_id,tower FROM route_stops').all();
  const missing=Array.from({length:14},(_,i)=>`h${i}`).find((id,i)=>!before.includes(id) && beforeRows.filter(s=>s.tower===`T${i%5}`).length<3);
  const add=route('/hosts/:familyId/visits');
  const req={params:{familyId:missing},body:{groupId:'group_1'}};
  assert.equal((await call(add,req)).body.stopCount,9);
  const after=db.prepare('SELECT * FROM route_stops ORDER BY seq').all();
  assert.ok(before.every(id=>after.some(s=>s.host_id===id)));
  assert.equal(after.filter(s=>s.host_id===missing).length,1);
  blocks(after);
  assert.equal((await call(add,req)).body.stopCount,9);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM extra_host_visits').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recipient_notification_state').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM group_members').get().n,1);
  await call(route('/recompute-routes'),{});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM route_stops').get().n,9);
  await call(route('/recompute'),{});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM extra_host_visits').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM route_stops').get().n,9);
  assert.equal((await call(add,{params:{familyId:'walker'},body:{groupId:'group_1'}})).status,400);
  assert.equal((await call(add,{params:{familyId:missing},body:{groupId:'absent'}})).status,400);
});

test('long manually extended routes retain every visit while respecting tower caps', () => {
  const hosts=Array.from({length:40},(_,i)=>({id:`h${i}`,tower:`T${i%14}`,floor:i,apartmentCode:`${i}`,children:[],hosting:true}));
  const extra=hosts.map(h=>({groupId:'g',familyId:h.id}));
  const [route]=buildRoutes([{id:'g',memberFamilyIds:[]}],hosts,[],extra);
  assert.equal(route.stops.length,40);
  assert.equal(new Set(route.stops.map(s=>s.hostId)).size,40);
  blocks(route.stops);
  assert.equal(route.totalMin,route.stops.at(-1).departure);
  assert.deepEqual(route.stops.map(s=>s.seq),Array.from({length:40},(_,i)=>i+1));
});


test('pinned visits cannot override the three-stop limit', () => {
  const hosts=Array.from({length:4},(_,i)=>({id:`h${i}`,tower:'A',floor:i,children:[],hosting:true}));
  const extras=hosts.map(h=>({groupId:'g',familyId:h.id}));
  assert.throws(()=>buildRoutes([{id:'g',memberFamilyIds:[]}],hosts,[],extras),{code:'ROUTE_CONSTRAINT'});
});
