const crypto = require('crypto');

/**
 * Валидация initData — одинаковый алгоритм у Telegram и у MAX
 * (см. dev.max.ru/docs/webapps/validation — та же схема WebAppData + HMAC-SHA256).
 * Возвращает распарсенный объект данных (включая user) при успехе, иначе null.
 *
 * ВАЖНО: у MAX API в 2026 продолжает меняться (переезд на platform-api.max.ru,
 * токен в заголовке Authorization для серверных вызовов) — саму схему валидации
 * initData стоит свериться с актуальной документацией перед продакшн-релизом.
 */
function validateInitData(initDataRaw, botToken) {
  if (!initDataRaw || !botToken) return null;

  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  const result = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  if (result.user) {
    try {
      result.user = JSON.parse(result.user);
    } catch {
      // оставляем как строку, если не распарсилось
    }
  }
  return result;
}

module.exports = { validateInitData };
