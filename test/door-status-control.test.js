const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { db } = require('../db');
const admin = require('../routes/admin');
const families = require('../routes/families');
const { getEventSettings } = require('../lib/event-settings');
const handler = (router, path, method) => router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]).route.stack[0].handle;
async function invoke(fn, req) {
  let result;
  const response = { status(code) { this.code = code; return this; }, json(body) { result = { status: this.code || 200, body }; return this; } };
  await fn(req, response, (error) => { throw error; });
  return result;
}
const setting = (key, value) => db.prepare('INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));

test('door reports require admin activation and event start; removed members enter normal waiting', async () => {
  db.prepare("INSERT INTO families(id,family_code,tower,floor,apartment_code,candy_brought,manual_group_id,created_at) VALUES ('f','code','A',1,'101',1,'g',0)").run();
  db.prepare("INSERT INTO parent_links(platform,platform_user_id,family_id) VALUES ('dev','user','f')").run();
  db.prepare("INSERT INTO children(family_id,name,age) VALUES ('f','Child',8)").run();
  db.prepare("INSERT INTO groups(id,name,child_count) VALUES ('g','Group',1)").run();
  db.prepare("INSERT INTO group_members(group_id,family_id) VALUES ('g','f')").run();
  const report = handler(families, '/door-status', 'post');
  const request = { platform: 'dev', platformUserId: 'user', body: { hostId: 'host', status: 'no_answer' } };
  assert.equal(getEventSettings().doorStatusEnabled, false);
  assert.equal((await invoke(report, request)).status, 403);
  const toggle = handler(admin, '/door-status-settings', 'put');
  assert.equal((await invoke(toggle, { body: { doorStatusEnabled: 'yes' } })).status, 400);
  await invoke(toggle, { body: { doorStatusEnabled: true } });
  assert.equal((await invoke(report, request)).status, 403); // No event date.
  setting('event_start_at', Date.now() + 60000);
  assert.equal((await invoke(report, request)).status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM door_status').get().n, 0);
  setting('event_start_at', Date.now() - 1000);
  assert.equal(getEventSettings().doorStatusActive, true);
  assert.equal((await invoke(report, request)).status, 200);
  await invoke(toggle, { body: { doorStatusEnabled: false } });
  assert.equal(getEventSettings().doorStatusActive, false);
  assert.equal((await invoke(report, request)).status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM door_status').get().n, 1);
  await invoke(handler(admin, '/groups/:id/members/:familyId', 'delete'), { params: { id: 'g', familyId: 'f' } });
  assert.equal(db.prepare("SELECT 1 FROM group_members WHERE family_id='f'").get(), undefined);
  const family = db.prepare("SELECT grouping_paused,manual_group_id FROM families WHERE id='f'").get();
  assert.equal(family.grouping_paused, 0);
  assert.equal(family.manual_group_id, null);
});
