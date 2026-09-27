const { db } = require('../db');

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatServerLocal(timestamp = Date.now(), seconds = false) {
  const date = new Date(timestamp);
  const value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return seconds ? `${value}:${pad(date.getSeconds())}` : value;
}

function getEventSettings() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'event_start_at'").get();
  const parsed = row ? Number(row.value) : null;
  const eventStartAt = Number.isFinite(parsed) ? parsed : null;
  const now = Date.now();
  return {
    serverNow: now,
    serverLocalNow: formatServerLocal(now, true),
    eventStartAt,
    eventStartLocal: eventStartAt ? formatServerLocal(eventStartAt) : '',
  };
}

function parseServerLocal(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hours, minutes] = match.map(Number);
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (
    date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
    date.getHours() !== hours || date.getMinutes() !== minutes
  ) return null;
  return date.getTime();
}

function saveEventStartLocal(value) {
  const timestamp = parseServerLocal(value);
  if (timestamp === null) return null;
  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('event_start_at', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(timestamp));
  return timestamp;
}

module.exports = { getEventSettings, saveEventStartLocal };
