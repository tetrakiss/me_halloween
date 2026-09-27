const express = require('express');
const { db, newId } = require('../db');
const { buildGroups, buildRoutes } = require('../lib/grouping-routing');
const { validateInitData } = require('../lib/validateInitData');

const router = express.Router();

const SUPER_ADMIN_USERNAME = (process.env.SUPER_ADMIN_TELEGRAM_USERNAME || 'a_togulev')
  .replace(/^@/, '')
  .toLowerCase();

// Доступ разрешён двумя способами:
// 1) заголовок X-Admin-Password совпадает с ADMIN_PASSWORD (для всех админов);
// 2) запрос пришёл из Telegram-мини-аппа с валидным initData от @a_togulev —
//    этот пользователь получает права супер-администратора без пароля.
router.use((req, res, next) => {
  const providedPassword = req.header('x-admin-password');
  if (process.env.ADMIN_PASSWORD && providedPassword === process.env.ADMIN_PASSWORD) {
    req.isSuperAdmin = false;
    return next();
  }

  const platform = req.header('x-platform');
  const initData = req.header('x-init-data');
  if (platform === 'telegram' && initData) {
    const parsed = validateInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
    const username = parsed?.user?.username?.toLowerCase();
    if (username && username === SUPER_ADMIN_USERNAME) {
      req.isSuperAdmin = true;
      return next();
    }
  }

  return res.status(401).json({ error: 'Доступ запрещён' });
});

function loadFamiliesForAlgo() {
  const rows = db.prepare('SELECT * FROM families').all();
  return rows.map((f) => ({
    id: f.id,
    tower: f.tower,
    floor: f.floor,
    apartmentCode: f.apartment_code,
    children: db.prepare('SELECT name, age FROM children WHERE family_id = ?').all(f.id),
    walking: !!f.walking,
    hosting: !!f.hosting,
    quest: !!f.quest,
    questDurationMin: f.quest_duration_min,
    manualGroupId: f.manual_group_id,
    cancelled: !!f.cancelled,
  }));
}

function loadWishLinks() {
  return db
    .prepare('SELECT family_a AS a, family_b AS b FROM wish_links')
    .all();
}

function loadSpecialPoints() {
  return db.prepare('SELECT * FROM special_points').all().map((sp) => ({
    id: sp.id,
    tower: sp.tower,
    floor: sp.floor,
    name: sp.name,
    active: !!sp.active,
    quest: !!sp.quest,
    questDurationMin: sp.quest_duration_min,
  }));
}

// ---- Спецточки маршрута (рестораны/магазины и т.п.) ----
router.get('/special-points', (req, res) => {
  res.json({ specialPoints: loadSpecialPoints() });
});

router.post('/special-points', (req, res) => {
  const { tower, floor = 0, name, quest = false, questDurationMin } = req.body;
  if (!tower || !name) return res.status(400).json({ error: 'tower и name обязательны' });

  const id = newId('sp');
  db.prepare(`
    INSERT INTO special_points (id, tower, floor, name, active, quest, quest_duration_min, created_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
  `).run(id, tower, floor, name, quest ? 1 : 0, quest ? questDurationMin || 20 : null, Date.now());

  res.json({ ok: true, id });
});

router.patch('/special-points/:id', (req, res) => {
  const { tower, floor, name, active, quest, questDurationMin } = req.body;
  db.prepare(`
    UPDATE special_points SET
      tower = COALESCE(@tower, tower),
      floor = COALESCE(@floor, floor),
      name = COALESCE(@name, name),
      active = COALESCE(@active, active),
      quest = COALESCE(@quest, quest),
      quest_duration_min = COALESCE(@questDurationMin, quest_duration_min)
    WHERE id = @id
  `).run({
    id: req.params.id,
    tower: tower ?? null,
    floor: floor === undefined ? null : floor,
    name: name ?? null,
    active: active === undefined ? null : active ? 1 : 0,
    quest: quest === undefined ? null : quest ? 1 : 0,
    questDurationMin: questDurationMin === undefined ? null : questDurationMin,
  });
  res.json({ ok: true });
});

router.delete('/special-points/:id', (req, res) => {
  db.prepare('DELETE FROM special_points WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/families', (req, res) => {
  const families = loadFamiliesForAlgo();
  const groupMembers = db
    .prepare(
      `SELECT gm.family_id, gm.group_id, g.is_manual FROM group_members gm
       JOIN groups g ON g.id = gm.group_id`
    )
    .all();
  const byFamily = new Map(groupMembers.map((r) => [r.family_id, r]));

  res.json({
    families: families.map((f) => ({
      ...f,
      currentGroupId: byFamily.get(f.id)?.group_id || null,
    })),
  });
});

router.get('/groups', (req, res) => {
  const groups = db.prepare('SELECT * FROM groups').all();
  res.json({
    groups: groups.map((g) => ({
      ...g,
      members: db
        .prepare('SELECT family_id FROM group_members WHERE group_id = ?')
        .all(g.id)
        .map((r) => r.family_id),
    })),
  });
});

// Ручная привязка семьи к группе — высший приоритет над алгоритмом.
// groupId можно передать новый (например "manual_1") — группа создастся при recompute.
router.post('/override', (req, res) => {
  const { familyId, groupId } = req.body;
  if (!familyId) return res.status(400).json({ error: 'familyId обязателен' });

  db.prepare('UPDATE families SET manual_group_id = ? WHERE id = ?').run(groupId || null, familyId);
  res.json({ ok: true });
});

// Пересчитать группы и маршруты по текущему состоянию БД.
// manual_group_id уважается алгоритмом (buildGroups сам выделяет такие семьи).
router.post('/recompute', (req, res) => {
  const families = loadFamiliesForAlgo();
  const wishLinks = loadWishLinks();
  const specialPoints = loadSpecialPoints();

  const groups = buildGroups(families, wishLinks);
  const routes = buildRoutes(groups, families, specialPoints);

  const tx = db.transaction(() => {
    db.exec('DELETE FROM route_stops; DELETE FROM group_members; DELETE FROM groups;');

    const insertGroup = db.prepare(
      'INSERT INTO groups (id, avg_age, child_count, is_manual, total_min) VALUES (?, ?, ?, ?, ?)'
    );
    const insertMember = db.prepare('INSERT INTO group_members (group_id, family_id) VALUES (?, ?)');
    const insertStop = db.prepare(`
      INSERT INTO route_stops (group_id, host_id, host_type, seq, tower, floor, apartment_code, display_name, is_quest, arrival_min, departure_min)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const routeByGroup = new Map(routes.map((r) => [r.groupId, r]));

    for (const g of groups) {
      const route = routeByGroup.get(g.id);
      insertGroup.run(g.id, g.avgAge, g.childCount, g.isManual ? 1 : 0, route ? route.totalMin : null);
      for (const familyId of g.memberFamilyIds) {
        insertMember.run(g.id, familyId);
      }
      if (route) {
        for (const stop of route.stops) {
          insertStop.run(
            g.id,
            stop.hostId,
            stop.hostType,
            stop.seq,
            stop.tower,
            stop.floor,
            stop.apartmentCode,
            stop.displayName,
            stop.isQuest ? 1 : 0,
            stop.arrival,
            stop.departure
          );
        }
      }
    }
  });
  tx();

  res.json({ ok: true, groupCount: groups.length });
});

router.get('/quest-slots', (req, res) => {
  const rows = db
    .prepare(
      `SELECT rs.host_id, rs.host_type, rs.tower, rs.floor, rs.apartment_code, rs.display_name, rs.group_id, rs.arrival_min, rs.departure_min
       FROM route_stops rs WHERE rs.is_quest = 1 ORDER BY rs.host_id, rs.arrival_min`
    )
    .all();

  const byHost = new Map();
  for (const r of rows) {
    if (!byHost.has(r.host_id)) {
      byHost.set(r.host_id, {
        tower: r.tower,
        floor: r.floor,
        apartmentCode: r.apartment_code,
        displayName: r.display_name,
        hostType: r.host_type,
        slots: [],
      });
    }
    byHost.get(r.host_id).slots.push({
      groupId: r.group_id,
      arrivalMin: r.arrival_min,
      departureMin: r.departure_min,
    });
  }

  res.json({ questApartments: [...byHost.values()] });
});

module.exports = router;
