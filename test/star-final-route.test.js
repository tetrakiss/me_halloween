const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { db } = require('../db');
const { rebuildStoredRoutes } = require('../lib/extra-host-visits');
const { readStoredSchedule } = require('../lib/stored-route-schedule');
const { buildRoutes } = require('../lib/route-planner');
const { buildSchedule } = require('../lib/route-schedule');
const admin = require('../routes/admin');

test('eight main stops keep quests and extras; final is additional, unique, last and allows parallel visits', async () => {
  const insert = db.prepare("INSERT INTO families(id,family_code,tower,floor,apartment_code,hosting,quest,created_at) VALUES (?,?,?,?,?,1,?,0)");
  for (let i = 0; i < 24; i += 1) insert.run(`h${i}`,`c${i}`,['Вена','Афины','Венеция','Стокгольм','Флоренция','Сингапур'][i%6],i+1,`${100+i}`,i<12?1:0);
  db.prepare("INSERT INTO special_points(id,tower,floor,name,active,quest,route_final,allow_parallel,created_at) VALUES ('star','Флоренция',0,'STARboxing',1,0,1,1,0)").run();
  for (const id of ['g1','g2','g3']) db.prepare('INSERT INTO groups(id,name) VALUES (?,?)').run(id,id);
  db.prepare("INSERT INTO extra_host_visits(group_id,family_id) VALUES ('g1','h12'),('g1','h13')").run();
  const routes = rebuildStoredRoutes(db);
  assert.deepEqual(routes.map(r=>r.stops.length),[11,9,9]);
  const counts = routes.map(r=>r.stops.filter(s=>s.isQuest).length);
  for (const r of routes) {
    assert.equal(r.stops.at(-1).hostId,'star');assert.equal(r.stops.filter(s=>s.hostId==='star').length,1);
    assert.equal(r.stops.at(-1).waitMin,0);
    const towers = r.stops.map(s=>s.tower);for (const t of new Set(towers)) assert(towers.filter(a=>a===t).length<=3);
    const blocks=towers.filter((t,i)=>i===0||t!==towers[i-1]);assert.equal(new Set(blocks).size,blocks.length);
  }
  const again = rebuildStoredRoutes(db);
  assert.deepEqual(again.map(r=>r.stops.filter(s=>s.isQuest).length),counts);
  assert.deepEqual(again,routes);
  const schedule=readStoredSchedule();assert.equal(schedule.conflicts.length,0);
  assert(schedule.groups.every(g=>g.stops.at(-1).allowParallel && g.stops.at(-1).isFinal));
  const before=db.prepare('SELECT * FROM route_stops ORDER BY id').all();
  const stops=before.filter(s=>s.group_id==='g2').sort((a,b)=>a.seq-b.seq);
  const handler=admin.stack.find(r=>r.route?.path==='/groups/:id/route'&&r.route.methods.put).route.stack[0].handle;
  let response;const res={status(code){this.code=code;return this;},json(body){response={status:this.code||200,body};}};
  await handler({params:{id:'g2'},body:{stopIds:[stops.at(-1).id,...stops.slice(0,-1).map(s=>s.id)]}},res,e=>{throw e;});
  assert.equal(response.status,400);assert.deepEqual(db.prepare('SELECT * FROM route_stops ORDER BY id').all(),before);
});

test('parallel final does not cause waiting even when every group arrives together', () => {
  const groups=Array.from({length:5},(_,i)=>({id:`g${i}`,memberFamilyIds:[]}));
  const special=[{id:'star',tower:'Флоренция',floor:0,name:'STARboxing',active:true,routeFinal:true,allowParallel:true}];
  const routes=buildRoutes(groups,[],special);
  assert(routes.every(r=>r.stops.length===1 && r.waitingMin===0));
  const scheduled=buildSchedule(routes.map(r=>({...groups.find(g=>g.id===r.groupId),stops:r.stops})),0);
  assert.equal(scheduled.conflicts.length,0);assert.equal(new Set(routes.map(r=>r.stops[0].arrival)).size,1);
});
