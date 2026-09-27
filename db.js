const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
  hosting INTEGER NOT NULL DEFAULT 0,
  quest INTEGER NOT NULL DEFAULT 0,
  quest_duration_min INTEGER,
  manual_group_id TEXT,
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
`);

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

module.exports = { db, shortCode, newId };
