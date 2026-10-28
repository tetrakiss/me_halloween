const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { db } = require('../db');
const admin = require('../routes/admin');
const families = require('../routes/families');
const publicSchedule = require('../routes/schedule');
const handler = (router, path, method) => router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]).route.stack[0].handle;
async function invoke(fn, req) {
  let result;
  const res = { set() { return this; }, status(code) { this.code = code; return this; }, json(body) { result = { status: this.code || 200, body }; return this; } };
  await fn(req, res, (error) => { throw error; });
  return result;
}
test('schedule reflects event start and saved tower; participants see selected parking', async () => {
  db.prepare("INSERT INTO groups(id,name) VALUES ('g','Group')").run();
  db.prepare("INSERT INTO families(id,family_code,tower,floor,apartment_code,created_at) VALUES ('f','code','Вена',1,'101',0)").run();
  db.prepare("INSERT INTO children(family_id,name,age) VALUES ('f','Child',8)").run();
  db.prepare("INSERT INTO parent_links(platform,platform_user_id,family_id) VALUES ('dev','user','f')").run();
  db.prepare("INSERT INTO group_members(group_id,family_id) VALUES ('g','f')").run();
  db.prepare("INSERT INTO route_stops(group_id,host_id,seq,tower,floor,is_quest) VALUES ('g','host',1,'Афины',2,1)").run();
  const schedule = () => invoke(handler(admin, '/route-schedule', 'get'), {});
  assert.equal((await schedule()).body.eventStartAt, null);
  const at = new Date(2026, 9, 31, 16, 0).getTime();
  db.prepare("INSERT INTO app_settings(key,value) VALUES ('event_start_at',?)").run(String(at));
  let result = (await schedule()).body;
  assert.equal(result.groups[0].stops[0].arrivalAt, at + 22 * 60000);
  const save = (startTower) => invoke(handler(admin, '/groups/:id', 'patch'), { params: { id: 'g' }, body: { name: 'Group', startTower } });
  assert.equal((await save('invalid')).status, 400);
  assert.equal((await save('Афины')).status, 200);
  result = (await schedule()).body;
  assert.equal(result.groups[0].stops[0].arrivalAt, at + 15 * 60000);
  assert.match(result.groups[0].stops[0].arrivalLocal, /16:15$/);
  const me = await invoke(handler(families, '/me', 'get'), { platform: 'dev', platformUserId: 'user' });
  assert.equal(me.body.group.startLocation, 'Афины, парковка -2 этаж');
  assert.equal(me.body.route[0].arrivalTime, '16:15');
  assert.equal(me.body.route[0].arrivalLocal, result.groups[0].stops[0].arrivalLocal);
  assert.equal(Object.hasOwn(me.body.route[0], 'departureLocal'), false);
  assert.equal(Object.hasOwn(me.body.route[0], 'departureTime'), false);

  db.prepare("UPDATE app_settings SET value=? WHERE key='event_start_at'").run(String(at + 3600000));
  assert.equal((await schedule()).body.groups[0].stops[0].arrivalAt, at + 75 * 60000);
  const shifted = await invoke(handler(families, '/me', 'get'), { platform: 'dev', platformUserId: 'user' });
  assert.equal(shifted.body.route[0].arrivalTime, '17:15');
  db.prepare("UPDATE route_stops SET wait_min=5 WHERE group_id='g'").run();
  const waiting = await invoke(handler(families, '/me', 'get'), { platform: 'dev', platformUserId: 'user' });
  assert.equal(waiting.body.route[0].arrivalTime, '17:20');
  assert.equal(waiting.body.route[0].arrivalLocal, (await schedule()).body.groups[0].stops[0].arrivalLocal);

  const publicResult = await invoke(handler(publicSchedule, '/route-schedule', 'get'), {});
  assert.equal(publicResult.status, 200);
  assert.deepEqual(publicResult.body.groups, (await schedule()).body.groups);
  const serialized = JSON.stringify(publicResult.body);
  for (const privateField of ['familyCode', 'family_code', 'memberFamilyIds', 'username', 'platformUserId', 'hostId']) {
    assert.equal(serialized.includes(`"${privateField}"`), false, privateField);
  }
  assert.equal(serialized.includes('Child'), false);
  assert.equal(serialized.includes('"code"'), false);

});
