const crypto = require('crypto');
const { db } = require('../db');

const COOLDOWN_MS = 5 * 60 * 1000;

function groupSignature(group) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      id: group.id,
      name: group.name,
      members: [...group.memberFamilyIds].sort(),
      stops: group.stops.map((stop) => [
        stop.hostId,
        stop.seq,
        stop.tower,
        stop.floor,
        stop.apartmentCode,
        stop.isQuest,
      ]),
    }))
    .digest('hex');
}

async function sendTelegram(userId, text) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return false;
  const response = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: userId,
        text,
        reply_markup: process.env.APP_BASE_URL
          ? { inline_keyboard: [[{ text: '🎃 Открыть маршрут', web_app: { url: process.env.APP_BASE_URL } }]] }
          : undefined,
      }),
    }
  );
  if (!response.ok) throw new Error(`Telegram API: ${response.status} ${await response.text()}`);
  return true;
}

async function sendMax(userId, text) {
  if (!process.env.MAX_BOT_TOKEN) return false;
  const url = new URL('https://platform-api2.max.ru/messages');
  url.searchParams.set('user_id', userId);
  const attachments = process.env.MAX_BOT_USERNAME
    ? [{
        type: 'inline_keyboard',
        payload: {
          buttons: [[{
            type: 'open_app',
            text: '🎃 Открыть маршрут',
            web_app: process.env.MAX_BOT_USERNAME.replace(/^@/, ''),
          }]],
        },
      }]
    : undefined;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.MAX_BOT_TOKEN,
    },
    body: JSON.stringify({ text, attachments }),
  });
  if (!response.ok) throw new Error(`MAX API: ${response.status} ${await response.text()}`);
  return true;
}

async function notifyChangedGroups(groupsWithRoutes) {
  const now = Date.now();
  const results = { sent: 0, ignoredByCooldown: 0, failed: 0 };

  for (const group of groupsWithRoutes) {
    const signature = groupSignature(group);
    if (group.memberFamilyIds.length === 0) continue;
    const links = db
      .prepare(`SELECT DISTINCT pl.platform, pl.platform_user_id
                FROM parent_links pl
                WHERE pl.family_id IN (${group.memberFamilyIds.map(() => '?').join(',')})`)
      .all(...group.memberFamilyIds);
    const groupName = group.name || group.id;
    const text = `🎃 Ваша группа «${groupName}» сформирована. Маршрут уже доступен в мини-приложении.`;

    for (const link of links) {
      if (!['telegram', 'max'].includes(link.platform)) continue;
      const previous = db.prepare(`SELECT signature, last_notified_at FROM recipient_notification_state
                                   WHERE platform = ? AND platform_user_id = ?`)
        .get(link.platform, link.platform_user_id);
      if (previous?.signature === signature) continue;
      if (previous && now - previous.last_notified_at < COOLDOWN_MS) {
        results.ignoredByCooldown += 1;
        continue;
      }
      try {
        const delivered = link.platform === 'telegram'
          ? await sendTelegram(link.platform_user_id, text)
          : await sendMax(link.platform_user_id, text);
        if (!delivered) continue;
        results.sent += 1;
        db.prepare(`INSERT INTO recipient_notification_state
          (group_id, platform, platform_user_id, signature, last_notified_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(platform, platform_user_id) DO UPDATE SET
            group_id = excluded.group_id, signature = excluded.signature,
            last_notified_at = excluded.last_notified_at`)
          .run(group.id, link.platform, link.platform_user_id, signature, now);
      } catch (error) {
        results.failed += 1;
        console.error('Group notification error:', error);
      }
    }

  }

  return results;
}

module.exports = { notifyChangedGroups, groupSignature, COOLDOWN_MS };
