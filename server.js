require('dotenv').config();
const express = require('express');
const path = require('path');
const { validateInitData } = require('./lib/validateInitData');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ---- Middleware: определяем platform + platformUserId по initData ----
// Заголовки от фронтенда: X-Platform: telegram|max|dev, X-Init-Data: <сырая строка>
function authMiddleware(req, res, next) {
  const platform = req.header('x-platform');
  const initData = req.header('x-init-data');

  if (!platform) return res.status(400).json({ error: 'Заголовок X-Platform обязателен' });

  // dev-режим — ТОЛЬКО для локальной разработки, никогда не включать в проде.
  if (platform === 'dev' && !IS_PROD) {
    const devUserId = req.header('x-dev-user-id');
    if (!devUserId) return res.status(400).json({ error: 'X-Dev-User-Id обязателен в dev-режиме' });
    req.platform = 'dev';
    req.platformUserId = devUserId;
    return next();
  }

  const token = platform === 'telegram' ? process.env.TELEGRAM_BOT_TOKEN : process.env.MAX_BOT_TOKEN;
  const parsed = validateInitData(initData, token);
  if (!parsed || !parsed.user || !parsed.user.id) {
    return res.status(401).json({ error: 'Невалидные данные инициализации' });
  }

  req.platform = platform;
  req.platformUserId = String(parsed.user.id);
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
          text: '🎃 Добро пожаловать в Монстрополию! Открой приложение, чтобы записаться или посмотреть свой маршрут.',
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
// Структура запроса и точный формат ответа стоит свериться с актуальной
// документацией dev.max.ru на момент интеграции — платформа быстро меняется
// (в 2026 API переехало на platform-api.max.ru, токен — в заголовке Authorization).
app.post('/max-webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const update = req.body;
    const message = update.message;
    if (!message || !message.text) return;

    if (message.text.startsWith('/start')) {
      const parts = message.text.split(' ');
      const payload = parts[1];
      const url =
        payload && payload.startsWith('join_')
          ? `${process.env.APP_BASE_URL}?join=${payload.slice(5)}`
          : process.env.APP_BASE_URL;

      await fetch(`https://platform-api.max.ru/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.MAX_BOT_TOKEN}`,
        },
        body: JSON.stringify({
          chat_id: message.chat.id,
          text: '🎃 Добро пожаловать в Монстрополию! Открой приложение, чтобы записаться или посмотреть свой маршрут.',
          attachments: [{ type: 'web_app', payload: { url } }],
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
