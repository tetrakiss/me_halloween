const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { db } = require('../db');
const router = require('../routes/admin');
const handler = router.stack.find((entry) => entry.route?.path === '/recompute-routes').route.stack[0].handle;
const invoke = () => {
  let result;
  const res = { status(code) { this.code = code; return this; }, json(body) { result = { status: this.code || 200, body }; } };
  handler({}, res);
  return result;
};

test('route-only rebuild preserves groups and memberships and is repeatable without notifications', () => {
  assert.equal(invoke().status, 400);
  const family = db.prepare("INSERT INTO families(id,family_code,tower,floor,apartment_code,hosting,created_at) VALUES (?,?,?,?,?,?,0)");
  for (let i = 0; i < 12; i += 1) family.run(`f${i}`, `f${i}`, i < 6 ? 'Вена' : 'Стокгольм', i + 1, `${i}`, 1);
  db.prepare("INSERT INTO groups(id,name,start_location,avg_age,child_count,is_manual) VALUES ('g','Имя','Старт',8,12,1)").run();
  for (let i = 0; i < 12; i += 1) db.prepare("INSERT INTO group_members(group_id,family_id) VALUES ('g',?)").run(`f${i}`);
  db.prepare("INSERT INTO recipient_notification_state(platform,platform_user_id,group_id,group_name,signature,last_notified_at) VALUES ('telegram','u','g','Имя','old',1)").run();
  const snapshot = () => ({
    groups: db.prepare('SELECT id,name,start_location,avg_age,child_count,is_manual FROM groups').all(),
    members: db.prepare('SELECT * FROM group_members ORDER BY group_id,family_id').all(),
    families: db.prepare('SELECT * FROM families ORDER BY id').all(),
    notifications: db.prepare('SELECT * FROM recipient_notification_state').all(),
  });
  const before = snapshot();
  const originalFetch = global.fetch;
  global.fetch = () => { throw new Error('No notification should be sent'); };
  try {
    assert.deepEqual(invoke(), { status: 200, body: { ok: true, groupCount: 1, stopCount: 10 } });
    const stops = () => db.prepare('SELECT group_id,host_id,host_type,seq,tower,floor,arrival_min,departure_min FROM route_stops ORDER BY group_id,seq').all();
    const first = stops();
    const towers = first.map((stop) => stop.tower).filter((tower, i, all) => !i || tower !== all[i - 1]);
    assert.equal(new Set(towers).size, towers.length);
    assert.deepEqual(snapshot(), before);
    invoke();
    assert.deepEqual(stops(), first);
    assert.deepEqual(snapshot(), before);
  } finally { global.fetch = originalFetch; }
});
