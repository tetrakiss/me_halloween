const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_GROUP_START_LOCATION = 'Парковка Вена -2 этаж';

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'halloween.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  family_code TEXT UNIQUE NOT NULL,
  tower TEXT NOT NULL,
  floor INTEGER NOT NULL,
  apartment_code TEXT NOT NULL,
  walking INTEGER NOT NULL DEFAULT 1,
  adult_chaperone INTEGER NOT NULL DEFAULT 0,
  hosting INTEGER NOT NULL DEFAULT 0,
  quest INTEGER NOT NULL DEFAULT 0,
  quest_duration_min INTEGER,
  manual_group_id TEXT,
  grouping_paused INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS children (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wish_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_a TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  family_b TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  UNIQUE(family_a, family_b)
);

CREATE TABLE IF NOT EXISTS parent_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  chat_id TEXT,
  first_name TEXT,
  last_name TEXT,
  username TEXT,
  updated_at INTEGER,
  UNIQUE(platform, platform_user_id)
);

CREATE TABLE IF NOT EXISTS special_points (
  id TEXT PRIMARY KEY,
  tower TEXT NOT NULL,
  floor INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  quest INTEGER NOT NULL DEFAULT 0,
  quest_duration_min INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT,
  start_location TEXT NOT NULL DEFAULT 'Парковка Вена -2 этаж',
  avg_age REAL,
  child_count INTEGER,
  is_manual INTEGER NOT NULL DEFAULT 0,
  total_min INTEGER
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, family_id)
);

-- host_id — это family_id ИЛИ id спецточки (special_points), без жёсткой FK,
-- т.к. точка может быть любой из двух сущностей. Данные для отображения
-- (башня/этаж/название) дублируются в момент пересчёта маршрута, поэтому
-- сам route_stops не требует live-джойна на families/special_points.
CREATE TABLE IF NOT EXISTS route_stops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  host_id TEXT NOT NULL,
  host_type TEXT NOT NULL DEFAULT 'family', -- 'family' | 'special'
  seq INTEGER NOT NULL,
  tower TEXT NOT NULL,
  floor INTEGER NOT NULL,
  apartment_code TEXT,
  display_name TEXT,
  is_quest INTEGER NOT NULL DEFAULT 0,
  arrival_min INTEGER,
  departure_min INTEGER
);

-- host_id — та же логика, что и в route_stops (family_id или id спецточки)
CREATE TABLE IF NOT EXISTS door_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  status TEXT NOT NULL,
  reported_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recipient_notification_state (
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  last_notified_at INTEGER NOT NULL,
  PRIMARY KEY (platform, platform_user_id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Лёгкие миграции для уже существующей SQLite-базы.
function ensureColumn(table, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

ensureColumn('groups', 'name', 'TEXT');
ensureColumn('groups', 'start_location', "TEXT NOT NULL DEFAULT 'Парковка Вена -2 этаж'");
// Preserve the current name for recipients notified before name tracking existed.
ensureColumn('recipient_notification_state', 'group_name', 'TEXT');
db.exec(`UPDATE recipient_notification_state SET group_name = (
  SELECT COALESCE(NULLIF(g.name, ''), g.id) FROM groups g
  WHERE g.id = recipient_notification_state.group_id
) WHERE group_name IS NULL;`);
db.prepare("UPDATE groups SET start_location = ? WHERE TRIM(COALESCE(start_location, '')) = ''")
  .run(DEFAULT_GROUP_START_LOCATION);
// Legacy links have no known author: preserve them as mutual requests.
ensureColumn('wish_links', 'requested_by_a', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('wish_links', 'requested_by_b', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('families', 'grouping_paused', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('families', 'adult_chaperone', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('families', 'candy_brought', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('parent_links', 'chat_id', 'TEXT');
ensureColumn('parent_links', 'first_name', 'TEXT');
ensureColumn('parent_links', 'last_name', 'TEXT');
ensureColumn('parent_links', 'username', 'TEXT');
ensureColumn('parent_links', 'updated_at', 'INTEGER');

db.exec(`CREATE TABLE IF NOT EXISTS group_name_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  age_min INTEGER NOT NULL,
  age_max INTEGER NOT NULL
);`);
if (!db.prepare("SELECT 1 FROM app_settings WHERE key = 'group_names_seeded'").get()) {
  db.transaction(() => {
    const insert = db.prepare('INSERT OR IGNORE INTO group_name_catalog(name, age_min, age_max) VALUES (?, ?, ?)');
    for (const [name, min, max] of [
      ['Тыквята', 1, 6], ['Маленькие привидения', 1, 6], ['Пушистые монстрики', 1, 6],
      ['Конфетные летучие мышки', 1, 6], ['Волшебные котята', 1, 6],
      ['Тыквенный патруль', 7, 10], ['Охотники за конфетами', 7, 10], ['Летучая банда', 7, 10],
      ['Призрачные разведчики', 7, 10], ['Ведьмин отряд', 7, 10],
      ['Стражи полуночи', 11, 17], ['Орден чёрной луны', 11, 17], ['Теневые охотники', 11, 17],
      ['Ночные оборотни', 11, 17], ['Легион вампиров', 11, 17],
    ]) insert.run(name, min, max);
    db.prepare("INSERT INTO app_settings(key, value) VALUES ('group_names_seeded', '1')").run();
  })();
}

if (!db.prepare("SELECT 1 FROM app_settings WHERE key = 'group_names_seeded_v2'").get()) {
  db.transaction(() => {
    const insert = db.prepare('INSERT OR IGNORE INTO group_name_catalog(name, age_min, age_max) VALUES (?, ?, ?)');
    for (const [name, min, max] of [
      ['Пряничные привидения', 1, 6], ['Тыквенные огоньки', 1, 6], ['Карамельные совята', 1, 6],
      ['Хихикающие паучки', 1, 6], ['Зефирные чудики', 1, 6],
      ['Скелеты на каникулах', 7, 10], ['Пираты тыквенного моря', 7, 10], ['Клуб храбрых привидений', 7, 10],
      ['Паучья дружина', 7, 10], ['Заклинатели сладостей', 7, 10],
      ['Хранители склепа', 11, 17], ['Ковен багровой луны', 11, 17], ['Полуночный дозор', 11, 17],
      ['Всадники тумана', 11, 17], ['Братство забытых теней', 11, 17],
    ]) insert.run(name, min, max);
    db.prepare("INSERT INTO app_settings(key, value) VALUES ('group_names_seeded_v2', '1')").run();
  })();
}

db.exec(`CREATE TABLE IF NOT EXISTS candy_reminder_deliveries (
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, platform, platform_user_id)
);`);

// One-time freeze/reset of premature door reports; later admin activation persists.
if (!db.prepare("SELECT 1 FROM app_settings WHERE key = 'door_status_freeze_v1'").get()) {
  db.transaction(() => {
    db.prepare("DELETE FROM door_status WHERE status = 'no_answer'").run();
    db.prepare("INSERT INTO app_settings(key,value) VALUES ('door_status_enabled','0') ON CONFLICT(key) DO UPDATE SET value='0'").run();
    db.prepare("INSERT INTO app_settings(key,value) VALUES ('door_status_freeze_v1','1')").run();
  })();
}

function shortCode(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих символов (0/O, 1/I)
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

module.exports = { db, shortCode, newId, DEFAULT_GROUP_START_LOCATION };
