const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { db } = require('../db');
const { notifyChangedGroups } = require('../lib/notifications');

test('notify only new recipients or changed names, with retries and concurrent deduplication', async () => {
  db.prepare("INSERT INTO families(id,family_code,tower,floor,apartment_code,created_at) VALUES ('f','f','A',1,'1',0)").run();
  const addLink = db.prepare('INSERT INTO parent_links(platform,platform_user_id,family_id) VALUES (?,?,?)');
  addLink.run('telegram', 'u', 'f');
  addLink.run('max', 'm', 'f');
  process.env.TELEGRAM_BOT_TOKEN = 'test';
  process.env.MAX_BOT_TOKEN = 'test';
  const originalFetch = global.fetch;
  const calls = [];
  let fail = false;
  global.fetch = async (url, options) => {
    calls.push(JSON.parse(options.body));
    await new Promise((resolve) => setImmediate(resolve));
    return { ok: !fail, status: 500, text: async () => 'test failure' };
  };
  const group = { id: 'g', name: 'Group', memberFamilyIds: ['f'], stops: [] };
  try {
    const results = await Promise.all([notifyChangedGroups([group]), notifyChangedGroups([group])]);
    assert.equal(results.reduce((n, r) => n + r.sent, 0), 2);
    assert.ok(calls.every((body) => body.text.includes('сформирована')));
    assert.equal((await notifyChangedGroups([{ ...group, id: 'new-id', stops: [{ hostId: 'h', seq: 1 }] }])).sent, 0);
    assert.equal(calls.length, 2);

    const renamed = { ...group, name: 'Renamed' };
    // A real name change must notify immediately, even within the former cooldown.
    assert.equal((await notifyChangedGroups([renamed])).sent, 2);
    assert.ok(calls.slice(2).every((body) => body.text.includes('Ваша группа изменилась') && body.text.includes('«Renamed»')));
    assert.equal((await notifyChangedGroups([renamed])).sent, 0);

    addLink.run('telegram', 'new', 'f');
    assert.equal((await notifyChangedGroups([renamed])).sent, 1);
    assert.ok(calls.at(-1).text.includes('сформирована'));

    const retry = { ...group, name: 'Retry' };
    fail = true;
    assert.equal((await notifyChangedGroups([retry])).failed, 3);
    assert.equal(db.prepare("SELECT group_name FROM recipient_notification_state WHERE platform_user_id = 'u'").get().group_name, 'Renamed');
    fail = false;
    assert.equal((await notifyChangedGroups([retry])).sent, 3);
    assert.equal((await notifyChangedGroups([retry])).sent, 0);

    // Legacy records with no recoverable name establish a baseline without a duplicate.
    db.prepare('UPDATE recipient_notification_state SET group_name = NULL').run();
    assert.equal((await notifyChangedGroups([retry])).sent, 0);
    assert.equal(db.prepare("SELECT group_name FROM recipient_notification_state WHERE platform_user_id = 'u'").get().group_name, 'Retry');
  } finally { global.fetch = originalFetch; }
});
