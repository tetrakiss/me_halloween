const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { db } = require('../db');
const { rebuildStoredRoutes } = require('../lib/extra-host-visits');
const { readStoredSchedule } = require('../lib/stored-route-schedule');
const admin = require('../routes/admin');

test('waiting persists through rebuilds and is used by the public dynamic schedule', () => {
  db.prepare("INSERT INTO families(id,family_code,tower,floor,apartment_code,hosting,quest,created_at) VALUES ('h','code','Вена',1,'101',1,1,0)").run();
  for (const id of ['a', 'b', 'c']) db.prepare('INSERT INTO groups(id,name) VALUES (?,?)').run(id, id);
  db.prepare("INSERT INTO app_settings(key,value) VALUES ('event_start_at','0')").run();
  const result = rebuildStoredRoutes(db);
  assert.equal(result.reduce((sum, r) => sum + r.waitingMin, 0), 45);
  const waits = () => db.prepare('SELECT wait_min FROM route_stops ORDER BY group_id').all().map((r) => r.wait_min);
  assert.deepEqual(waits(), [0, 15, 30]);
  let schedule = readStoredSchedule(); assert.equal(schedule.conflicts.length, 0);
  assert.deepEqual(schedule.groups.map((g) => g.stops[0].arrivalMin), [15, 30, 45]);
  rebuildStoredRoutes(db); assert.deepEqual(waits(), [0, 15, 30]);
  db.prepare("UPDATE app_settings SET value='3600000' WHERE key='event_start_at'").run();
  schedule = readStoredSchedule();
  assert.deepEqual(schedule.groups.map((g) => g.stops[0].arrivalAt), [4500000, 5400000, 6300000]);
});

test('an incompatible fourth pinned stop rolls back the whole admin action', () => {
  for (let i = 0; i < 4; i += 1) db.prepare("INSERT INTO families(id,family_code,tower,floor,apartment_code,hosting,created_at) VALUES (?,?,'Афины',1,?,1,0)").run(`p${i}`,`p${i}`,`${i}`);
  db.prepare("INSERT INTO groups(id,name) VALUES ('fixed','Fixed')").run();
  for (let i = 0; i < 3; i += 1) db.prepare("INSERT INTO extra_host_visits(group_id,family_id) VALUES ('fixed',?)").run(`p${i}`);
  rebuildStoredRoutes(db);
  const before = db.prepare('SELECT * FROM route_stops ORDER BY id').all();
  const handler = admin.stack.find((r) => r.route?.path === '/hosts/:familyId/visits').route.stack[0].handle;
  assert.throws(() => handler({ params: { familyId: 'p3' }, body: { groupId: 'fixed' } }, { json() {} }), { code: 'ROUTE_CONSTRAINT' });
  assert.equal(db.prepare("SELECT count(*) n FROM extra_host_visits WHERE group_id='fixed'").get().n, 3);
  assert.deepEqual(db.prepare('SELECT * FROM route_stops ORDER BY id').all(), before);
});
