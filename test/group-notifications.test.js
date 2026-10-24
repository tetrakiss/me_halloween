const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { db } = require('../db');
const { notifyChangedGroups, COOLDOWN_MS } = require('../lib/notifications');

test('group notifications skip existing recipients after changes and concurrent requests', async () => {
  db.prepare("INSERT INTO families(id,family_code,tower,floor,apartment_code,created_at) VALUES ('f','f','A',1,'1',0)").run();
  db.prepare("INSERT INTO parent_links(platform,platform_user_id,family_id) VALUES ('telegram','u','f')").run();
  process.env.TELEGRAM_BOT_TOKEN = 'test';
  const originalFetch = global.fetch;
  let calls = 0;
  let fail = false;
  global.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return { ok: !fail, status: 500, text: async () => 'test failure' };
  };
  const group = { id: 'g', name: 'Group', memberFamilyIds: ['f'], stops: [] };
  const expireCooldown = () => db.prepare('UPDATE recipient_notification_state SET last_notified_at = ?').run(Date.now() - COOLDOWN_MS - 1000);
  try {
    const results = await Promise.all([notifyChangedGroups([group]), notifyChangedGroups([group])]);
    assert.equal(results.reduce((n, r) => n + r.sent, 0), 1);
    expireCooldown();
    assert.equal((await notifyChangedGroups([{ ...group, name: 'Renamed', stops: [{ hostId: 'h', seq: 1 }] }])).sent, 0);
    assert.equal(calls, 1);
    db.prepare("INSERT INTO parent_links(platform,platform_user_id,family_id) VALUES ('telegram','new','f')").run();
    assert.equal((await notifyChangedGroups([group])).sent, 1);
    expireCooldown();
    assert.equal((await notifyChangedGroups([{ ...group, id: 'other' }])).sent, 2);
    expireCooldown();
    fail = true;
    assert.equal((await notifyChangedGroups([{ ...group, id: 'retry' }])).failed, 2);
    fail = false;
    assert.equal((await notifyChangedGroups([{ ...group, id: 'retry' }])).sent, 2);
  } finally { global.fetch = originalFetch; }
});
