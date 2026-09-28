const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { removeFamilyAndRepair } = require('../lib/family-removal');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE families (
      id TEXT PRIMARY KEY, tower TEXT NOT NULL, floor INTEGER NOT NULL,
      apartment_code TEXT NOT NULL, walking INTEGER NOT NULL DEFAULT 1,
      hosting INTEGER NOT NULL DEFAULT 0, quest INTEGER NOT NULL DEFAULT 0,
      quest_duration_min INTEGER, cancelled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE children (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      name TEXT NOT NULL, age INTEGER NOT NULL
    );
    CREATE TABLE groups (
      id TEXT PRIMARY KEY, name TEXT, start_location TEXT,
      avg_age REAL, child_count INTEGER, total_min INTEGER
    );
    CREATE TABLE group_members (
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, family_id)
    );
    CREATE TABLE special_points (
      id TEXT PRIMARY KEY, tower TEXT NOT NULL, floor INTEGER NOT NULL,
      name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      quest INTEGER NOT NULL DEFAULT 0, quest_duration_min INTEGER
    );
    CREATE TABLE route_stops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      host_id TEXT NOT NULL, host_type TEXT NOT NULL DEFAULT 'family',
      seq INTEGER NOT NULL, tower TEXT NOT NULL, floor INTEGER NOT NULL,
      apartment_code TEXT, display_name TEXT, is_quest INTEGER NOT NULL DEFAULT 0,
      arrival_min INTEGER, departure_min INTEGER
    );
    CREATE TABLE door_status (id INTEGER PRIMARY KEY, host_id TEXT, group_id TEXT, status TEXT, reported_at INTEGER);
    CREATE TABLE recipient_notification_state (platform TEXT, platform_user_id TEXT, group_id TEXT, signature TEXT, last_notified_at INTEGER);
  `);
  return db;
}

function addFamily(db, id, apartment, { hosting = false, age = 8 } = {}) {
  db.prepare(`INSERT INTO families
    (id, tower, floor, apartment_code, walking, hosting, quest, cancelled)
    VALUES (?, 'Вена', 22, ?, 1, ?, 0, 0)`).run(id, apartment, hosting ? 1 : 0);
  db.prepare('INSERT INTO children (family_id, name, age) VALUES (?, ?, ?)').run(id, id, age);
}

function addGroup(db, id, members) {
  db.prepare('INSERT INTO groups (id, name, start_location, child_count) VALUES (?, ?, ?, ?)')
    .run(id, id, 'Парковка Вена -2 этаж', members.length);
  members.forEach((familyId) => db.prepare('INSERT INTO group_members (group_id, family_id) VALUES (?, ?)').run(id, familyId));
}

function addStop(db, groupId, hostId, seq, arrival, departure) {
  db.prepare(`INSERT INTO route_stops
    (group_id, host_id, host_type, seq, tower, floor, apartment_code, is_quest, arrival_min, departure_min)
    VALUES (?, ?, 'family', ?, 'Вена', 22, ?, 0, ?, ?)`)
    .run(groupId, hostId, seq, hostId, arrival, departure);
}

test('до начала события маршруты перестраиваются, а состав групп сохраняется', () => {
  const db = createDb();
  addFamily(db, 'leaving', '2201', { hosting: true });
  addFamily(db, 'member', '2202');
  addFamily(db, 'host', '2203', { hosting: true });
  addGroup(db, 'g1', ['leaving', 'member']);
  addGroup(db, 'g2', ['host']);
  addStop(db, 'g1', 'leaving', 1, 0, 7);
  addStop(db, 'g2', 'leaving', 1, 0, 7);

  const result = removeFamilyAndRepair(db, 'leaving', { eventStarted: false });

  assert.equal(result.mode, 'rebuild');
  assert.deepEqual(db.prepare('SELECT family_id FROM group_members WHERE group_id = ?').all('g1'), [{ family_id: 'member' }]);
  assert.deepEqual(db.prepare('SELECT family_id FROM group_members WHERE group_id = ?').all('g2'), [{ family_id: 'host' }]);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM route_stops WHERE host_id = 'leaving'").get().count, 0);
  assert.equal(db.prepare("SELECT child_count FROM groups WHERE id = 'g1'").get().child_count, 1);
  assert.equal(db.prepare("SELECT start_location FROM groups WHERE id = 'g1'").get().start_location, 'Парковка Вена -2 этаж');
  assert.ok(result.groupsNeedingAttention.some((group) => group.id === 'g1'));
  db.close();
});

test('после начала события сохраняется порядок оставшихся остановок', () => {
  const db = createDb();
  addFamily(db, 'leaving', '2201');
  addFamily(db, 'member', '2202');
  addFamily(db, 'host-a', '2203', { hosting: true });
  addFamily(db, 'host-b', '2204', { hosting: true });
  addGroup(db, 'g1', ['leaving', 'member']);
  addStop(db, 'g1', 'host-a', 1, 0, 7);
  addStop(db, 'g1', 'leaving', 2, 12, 19);
  addStop(db, 'g1', 'host-b', 3, 24, 31);

  const result = removeFamilyAndRepair(db, 'leaving', { eventStarted: true });
  const stops = db.prepare('SELECT host_id, seq, arrival_min, departure_min FROM route_stops WHERE group_id = ? ORDER BY seq').all('g1');

  assert.equal(result.mode, 'compact');
  assert.deepEqual(stops, [
    { host_id: 'host-a', seq: 1, arrival_min: 0, departure_min: 7 },
    { host_id: 'host-b', seq: 2, arrival_min: 12, departure_min: 19 },
  ]);
  assert.deepEqual(db.prepare('SELECT family_id FROM group_members WHERE group_id = ?').all('g1'), [{ family_id: 'member' }]);
  db.close();
});

test('пустая после удаления группа удаляется автоматически', () => {
  const db = createDb();
  addFamily(db, 'only', '2201');
  addGroup(db, 'g1', ['only']);

  const result = removeFamilyAndRepair(db, 'only', { eventStarted: false });

  assert.deepEqual(result.removedGroupIds, ['g1']);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM groups').get().count, 0);
  db.close();
});
