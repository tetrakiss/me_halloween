const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { db } = require('../db');
const { notifyWaitingCandy, CANDY_REMINDER_TEXT } = require('../lib/notifications');

test('напоминание отправляется только ожидающим, не дублируется и повторяет ошибки', async () => {
  const insert = db.prepare('INSERT INTO families(id,family_code,tower,floor,apartment_code,hosting,quest,candy_brought,cancelled,created_at) VALUES (?,?,\'A\',1,?, ?,?,?,?,0)');
  const link = db.prepare('INSERT INTO parent_links(platform,platform_user_id,family_id) VALUES (?,?,?)');
  for (const [id, hosting, quest, brought, cancelled] of [
    ['waiting',0,0,0,0], ['retry',0,0,0,0], ['host',1,0,0,0],
    ['quest',0,1,0,0], ['brought',0,0,1,0], ['cancelled',0,0,0,1],
  ]) {
    insert.run(id,id,id,hosting,quest,brought,cancelled);
    link.run('telegram',id,id);
  }
  link.run('max','waiting-max','waiting');
  process.env.TELEGRAM_BOT_TOKEN = 'test'; process.env.MAX_BOT_TOKEN = 'test';
  const originalFetch = global.fetch;
  const calls = [];
  let failRetry = true;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({url,body});
    assert.equal(body.text, CANDY_REMINDER_TEXT);
    assert.ok(body.text.includes('https://t.me/halloweenME2'));
    return { ok: !(body.chat_id === 'retry' && failRetry), status: 500 };
  };
  try {
    assert.deepEqual(await notifyWaitingCandy(), { sent:2, skipped:0, failed:1 });
    failRetry = false;
    assert.deepEqual(await notifyWaitingCandy(), { sent:1, skipped:2, failed:0 });
    assert.deepEqual(await notifyWaitingCandy(), { sent:0, skipped:3, failed:0 });
    assert.equal(calls.length,4);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM candy_reminder_deliveries').get().n,3);
  } finally { global.fetch = originalFetch; }
});
