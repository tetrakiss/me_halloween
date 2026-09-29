require('dotenv').config();
const express = require('express');
const path = require('path');
const { validateInitData } = require('./lib/validateInitData');
const { db } = require('./db');

const app = express();
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '32kb' }));

const CLIENT_LOG_EVENTS = new Set([
  'html_started',
  'resource_loaded',
  'resource_error',
  'app_initializing',
  'api_started',
  'api_finished',
  'api_failed',
  'loading_splash_leaving',
  'styles_timeout',
  'loading_timeout',
  'app_load_failed',
  'ui_rendered',
  'javascript_error',
  'unhandled_rejection',
  'retry_requested',
  'page_hidden',
]);
const CLIENT_LOG_DETAIL_KEYS = new Set([
  'resource', 'tag', 'message', 'file', 'line', 'method', 'status', 'elapsedMs',
]);
const clientLogBuckets = new Map();

function cleanClientLogDetail(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => CLIENT_LOG_DETAIL_KEYS.has(key))
    .slice(0, 6)
    .map(([key, detail]) => [key, String(detail).replace(/[\r\n\t]/g, ' ').slice(0, 160)]));
}

app.post('/client-log', (req, res) => {
  const event = typeof req.body?.event === 'string' ? req.body.event : '';
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
  if (!CLIENT_LOG_EVENTS.has(event) || !/^[a-z0-9-]{8,80}$/i.test(sessionId)) {
    return res.sendStatus(204);
  }

  const now = Date.now();
  const bucketKey = `${req.ip}:${sessionId}`;
  const currentBucket = clientLogBuckets.get(bucketKey);
  const bucket = !currentBucket || now - currentBucket.startedAt > 10 * 60 * 1000
    ? { startedAt: now, count: 0 }
    : currentBucket;
  bucket.count += 1;
  clientLogBuckets.set(bucketKey, bucket);
  if (clientLogBuckets.size > 5000) {
    for (const [key, value] of clientLogBuckets) {
      if (now - value.startedAt > 10 * 60 * 1000) clientLogBuckets.delete(key);
    }
  }
  if (bucket.count > 120) return res.sendStatus(204);

  const elapsedMs = Number.isFinite(Number(req.body.elapsedMs))
    ? Math.max(0, Math.min(Number(req.body.elapsedMs), 24 * 60 * 60 * 1000))
    : null;
  console.log(JSON.stringify({
    type: 'client_boot',
    time: new Date(now).toISOString(),
    ip: req.ip,
    sessionId,
    event,
    elapsedMs,
    detail: cleanClientLogDetail(req.body.detail),
    userAgent: String(req.get('user-agent') || '').slice(0, 240),
  }));
  return res.sendStatus(204);
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ---- Middleware: определяем platform + platformUserId по initData ----
// Заголовки от фронтенда: X-Platform: telegram|max|dev, X-Init-Data: <сырая строка>
function authMiddleware(req, res, next) {
  const platform = req.header('x-platform');
  const initData = req.header('x-init-data');

  if (!platform) return res.status(400).json({ error: 'Заголовок X-Platform обязателен' });
  if (!['telegram', 'max', 'dev'].includes(platform)) {
    return res.status(400).json({ error: 'Неизвестная платформа' });
  }

  // dev-режим — ТОЛЬКО для локальной разработки, никогда не включать в проде.
  if (platform === 'dev' && !IS_PROD) {
    const devUserId = req.header('x-dev-user-id');
    if (!devUserId) return res.status(400).json({ error: 'X-Dev-User-Id обязателен в dev-режиме' });
    req.platform = 'dev';
    req.platformUserId = devUserId;
    req.platformUser = { id: devUserId, first_name: 'Dev' };
    return next();
  }

  if (platform === 'dev') return res.status(401).json({ error: 'Dev-режим отключён' });

  const token = platform === 'telegram' ? process.env.TELEGRAM_BOT_TOKEN : process.env.MAX_BOT_TOKEN;
  const parsed = validateInitData(initData, token);
  if (!parsed || !parsed.user || !parsed.user.id) {
    return res.status(401).json({ error: 'Невалидные данные инициализации' });
  }

  req.platform = platform;
  req.platformUserId = String(parsed.user.id);
  req.platformUser = parsed.user;
  req.platformChatId = parsed.chat?.id ? String(parsed.chat.id) : null;
  db.prepare(`UPDATE parent_links SET chat_id = COALESCE(?, chat_id), first_name = ?, last_name = ?, username = ?, updated_at = ?
              WHERE platform = ? AND platform_user_id = ?`)
    .run(
      req.platformChatId,
      parsed.user.first_name || parsed.user.name || null,
      parsed.user.last_name || null,
      parsed.user.username || null,
      Date.now(),
      platform,
      req.platformUserId
    );
  next();
}

app.use('/api', authMiddleware, require('./routes/families'));
app.use('/admin-api', require('./routes/admin'));

// ---- Telegram webhook ----
app.post('/telegram-webhook', async (req, res) => {
  res.sendStatus(200); // отвечаем сразу, обрабатываем асинхронно
  try {
    const update = req.body;
    const message = update.message;
    if (!message || !message.text) return;

    if (message.text.startsWith('/start')) {
      const parts = message.text.split(' ');
      const payload = parts[1]; // например join_ABC123
      const url =
        payload && payload.startsWith('join_')
          ? `${process.env.APP_BASE_URL}?join=${payload.slice(5)}`
          : process.env.APP_BASE_URL;

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.chat.id,
          text: '🎃 Добро пожаловать в Монстрополию!\n\nЧтобы запустить приложение, нажми кнопку «Открыть» слева от поля ввода. Если кнопки нет, используй кнопку ниже.',
          reply_markup: {
            inline_keyboard: [[{ text: '🎃 Открыть приложение', web_app: { url } }]],
          },
        }),
      });
    }
  } catch (err) {
    console.error('Telegram webhook error:', err);
  }
});

// ---- MAX webhook ----
// Webhook MAX: события bot_started/message_created приходят объектом Update,
// серверные вызовы выполняются через platform-api2.max.ru.
app.post('/max-webhook', async (req, res) => {
  if (
    process.env.MAX_WEBHOOK_SECRET &&
    req.header('x-max-bot-api-secret') !== process.env.MAX_WEBHOOK_SECRET
  ) {
    return res.sendStatus(401);
  }
  res.sendStatus(200);
  try {
    const update = req.body;
    const messageText = update.message?.body?.text || update.message?.text || '';
    const isStart = update.update_type === 'bot_started' || messageText.startsWith('/start');
    if (isStart) {
      const textPayload = messageText.split(' ')[1];
      const payload = update.payload || textPayload;
      const joinPayload = payload && payload.startsWith('join_') ? payload : null;
      const endpoint = new URL('https://platform-api2.max.ru/messages');
      if (update.chat_id) endpoint.searchParams.set('chat_id', String(update.chat_id));
      else if (update.user?.user_id) endpoint.searchParams.set('user_id', String(update.user.user_id));

      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: process.env.MAX_BOT_TOKEN,
        },
        body: JSON.stringify({
          text: '🎃 Добро пожаловать в Монстрополию!\n\nЧтобы запустить приложение, нажми кнопку «Открыть». Если кнопки нет, используй кнопку «🎃 Открыть приложение» под сообщением.',
          attachments: [{
            type: 'inline_keyboard',
            payload: {
              buttons: [[{
                type: 'open_app',
                text: '🎃 Открыть приложение',
                web_app: (process.env.MAX_BOT_USERNAME || process.env.APP_BASE_URL || '').replace(/^@/, ''),
                payload: joinPayload || undefined,
              }]],
            },
          }],
        }),
      });
    }
  } catch (err) {
    console.error('MAX webhook error:', err);
  }
});

app.listen(PORT, () => {
  console.log(`Halloween backend listening on port ${PORT}`);
});
