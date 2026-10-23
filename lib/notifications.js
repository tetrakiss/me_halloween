const crypto = require('crypto');
const { db } = require('../db');

const COOLDOWN_MS = 5 * 60 * 1000;

function groupSignature(group) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      id: group.id,
      name: group.name,
      startLocation: group.startLocation || '',
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

async function sendTelegram(userId, text, buttonText = '🎃 Открыть маршрут') {
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
          ? { inline_keyboard: [[{ text: buttonText, web_app: { url: process.env.APP_BASE_URL } }]] }
          : undefined,
      }),
    }
  );
  if (!response.ok) throw new Error(`Telegram API: ${response.status} ${await response.text()}`);
  return true;
}

async function sendMax(userId, text, buttonText = '🎃 Открыть маршрут') {
  if (!process.env.MAX_BOT_TOKEN) return false;
  const url = new URL('https://platform-api2.max.ru/messages');
  url.searchParams.set('user_id', userId);
  const attachments = process.env.MAX_BOT_USERNAME
    ? [{
        type: 'inline_keyboard',
        payload: {
          buttons: [[{
            type: 'open_app',
            text: buttonText,
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

async function notifyCandyAccepted(familyId) {
  const text = '🎃 Конфеты приняты! Сладкий взнос в фонд маленьких монстров засчитан 🍬👻\n\nСпасибо! Теперь ваша семья допущена к распределению по группам. Когда группа будет сформирована, мы пришлём отдельное сообщение 🦇';
  const links = db.prepare(`SELECT DISTINCT platform, platform_user_id FROM parent_links
    WHERE family_id = ? AND platform IN ('telegram', 'max')`).all(familyId);
  const results = { sent: 0, failed: 0 };
  for (const link of links) {
    try {
      const delivered = link.platform === 'telegram'
        ? await sendTelegram(link.platform_user_id, text, '🎃 Открыть приложение')
        : await sendMax(link.platform_user_id, text, '🎃 Открыть приложение');
      if (delivered) results.sent += 1;
    } catch (error) {
      results.failed += 1;
      console.error('Candy acceptance notification error:', error);
    }
  }
  return results;
}

async function notifyAdminNewFamily(family) {
  if (!db.prepare('SELECT 1 FROM route_stops LIMIT 1').get()) return;
  const explicitId = String(process.env.SUPER_ADMIN_TELEGRAM_ID || '').trim();
  const username = (process.env.SUPER_ADMIN_TELEGRAM_USERNAME || 'a_togulev').replace(/^@/, '').toLowerCase();
  const recipients = explicitId ? [explicitId] : db.prepare(`SELECT DISTINCT platform_user_id
    FROM parent_links WHERE platform = 'telegram' AND LOWER(username) = ?`).all(username)
    .map((link) => link.platform_user_id);
  if (!recipients.length) {
    console.error('Admin notification skipped: configure SUPER_ADMIN_TELEGRAM_ID');
    return;
  }
  const children = family.children.map((child) => `${child.name}, ${child.age} лет`).join('; ');
  const text = `🔔 Новая семья зарегистрировалась после формирования маршрутов.\n\n🏙 Башня: ${family.tower}\n📍 Этаж: ${family.floor} · квартира: ${family.apartmentCode}\n👧 Дети: ${children}\n🍬 Участие: ${family.quest ? 'квест' : family.hosting ? 'раздача конфет' : 'тип не выбран'}\n👣 Идут в обход: ${family.walking ? 'да' : 'нет'}\n\nПроверьте семью в админке: участников может понадобиться добавить в группу, а принимающую квартиру — включить в маршруты.`;
  for (const recipient of recipients) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: recipient, text,
          reply_markup: process.env.APP_BASE_URL ? { inline_keyboard: [[{
            text: 'Открыть админку', web_app: { url: new URL('/admin.html', process.env.APP_BASE_URL).href },
          }]] } : undefined }),
      });
      if (!response.ok) console.error('Admin notification failed:', response.status);
    } catch (error) { console.error('Admin notification failed:', error.message); }
  }
}

const CANDY_CHAT_URL = 'https://t.me/halloweenME2';
const CANDY_REMINDER_TEXT = `🍬 Маленькие монстры уже точат зубки, а мы всё ещё ждём ваши конфеты! 👻\n\nЧтобы ваша семья попала в группу, нужно передать конфеты. Напишите в общий чат (${CANDY_CHAT_URL}), чтобы узнать, как это сделать 🎃🦇\n\nЕсли вы уже передали конфеты, сообщите об этом в чате — возможно, галочка ещё не успела вас догнать ✅`;
let candyReminderRunning = false;

async function notifyWaitingCandy() {
  if (candyReminderRunning) {
    const error = new Error('Рассылка уже выполняется. Дождитесь завершения.');
    error.status = 409;
    throw error;
  }
  candyReminderRunning = true;
  const result = { sent: 0, skipped: 0, failed: 0 };
  try {
    const links = db.prepare(`SELECT DISTINCT f.id AS family_id, pl.platform, pl.platform_user_id
      FROM families f JOIN parent_links pl ON pl.family_id = f.id
      WHERE f.cancelled = 0 AND f.hosting = 0 AND f.quest = 0 AND f.candy_brought = 0
        AND pl.platform IN ('telegram', 'max')`).all();
    const alreadySent = db.prepare('SELECT 1 FROM candy_reminder_deliveries WHERE family_id = ? AND platform = ? AND platform_user_id = ?');
    const markSent = db.prepare('INSERT OR IGNORE INTO candy_reminder_deliveries(family_id, platform, platform_user_id, sent_at) VALUES (?, ?, ?, ?)');
    for (const link of links) {
      if (alreadySent.get(link.family_id, link.platform, link.platform_user_id)) { result.skipped += 1; continue; }
      // Recheck eligibility in case another admin accepted the candy during a long batch.
      if (!db.prepare('SELECT 1 FROM families WHERE id = ? AND cancelled = 0 AND hosting = 0 AND quest = 0 AND candy_brought = 0').get(link.family_id)) continue;
      try {
        const token = link.platform === 'telegram' ? process.env.TELEGRAM_BOT_TOKEN : process.env.MAX_BOT_TOKEN;
        if (!token) { result.failed += 1; continue; }
        const url = link.platform === 'telegram'
          ? `https://api.telegram.org/bot${token}/sendMessage`
          : `https://platform-api2.max.ru/messages?user_id=${encodeURIComponent(link.platform_user_id)}`;
        const response = await fetch(url, {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/json', ...(link.platform === 'max' ? { Authorization: token } : {}) },
          body: JSON.stringify(link.platform === 'telegram'
            ? { chat_id: link.platform_user_id, text: CANDY_REMINDER_TEXT, reply_markup: { inline_keyboard: [[{ text: '💬 Общий чат', url: CANDY_CHAT_URL }]] } }
            : { text: CANDY_REMINDER_TEXT }),
        });
        if (!response.ok) throw new Error(`Notification API status ${response.status}`);
        markSent.run(link.family_id, link.platform, link.platform_user_id, Date.now());
        result.sent += 1;
      } catch (error) {
        result.failed += 1;
        console.error('Candy reminder failed:', error.message);
      }
    }
    return result;
  } finally { candyReminderRunning = false; }
}

module.exports = { notifyChangedGroups, notifyCandyAccepted, notifyAdminNewFamily, notifyWaitingCandy, CANDY_REMINDER_TEXT, groupSignature, COOLDOWN_MS };
