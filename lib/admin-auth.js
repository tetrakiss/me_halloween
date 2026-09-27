const SUPER_ADMIN_USERNAME = (process.env.SUPER_ADMIN_TELEGRAM_USERNAME || 'a_togulev')
  .replace(/^@/, '')
  .toLowerCase();
const SUPER_ADMIN_ID = String(process.env.SUPER_ADMIN_TELEGRAM_ID || '').trim();

function isTelegramSuperAdmin(platform, user) {
  if (platform !== 'telegram' || !user) return false;
  if (SUPER_ADMIN_ID && String(user.id) === SUPER_ADMIN_ID) return true;
  return Boolean(user.username && user.username.toLowerCase() === SUPER_ADMIN_USERNAME);
}

module.exports = { isTelegramSuperAdmin };
