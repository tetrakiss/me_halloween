const express = require('express');
const { db, newId, shortCode } = require('../db');
const { buildGroups, buildRoutes } = require('../lib/grouping-routing');
const { validateInitData } = require('../lib/validateInitData');
const { isTelegramSuperAdmin } = require('../lib/admin-auth');
const { notifyChangedGroups } = require('../lib/notifications');

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const TEST_TOWERS = ['Венеция', 'Санкт-Петербург', 'Стокгольм', 'Вена', 'Амстердам', 'Копенгаген', 'Флоренция', 'Барселона', 'Екатеринбург', 'Великий Новгород', 'Владивосток', 'Гонконг', 'Сингапур', 'Стамбул', 'Афины'];
const TEST_CHILD_NAMES = ['Алиса', 'Миша', 'Соня', 'Лёва', 'Маша', 'Федя', 'Варя', 'Кирилл', 'Полина', 'Саша', 'Даша', 'Максим'];

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

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
    if (isTelegramSuperAdmin(platform, parsed?.user)) {
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

function loadGroupDetails(groupId) {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group) return null;
  return {
    id: group.id,
    name: group.name || group.id,
    memberFamilyIds: db.prepare('SELECT family_id FROM group_members WHERE group_id = ?').all(groupId).map((r) => r.family_id),
    stops: db.prepare('SELECT * FROM route_stops WHERE group_id = ? ORDER BY seq').all(groupId).map((stop) => ({
      id: stop.id,
      hostId: stop.host_id,
      hostType: stop.host_type,
      seq: stop.seq,
      tower: stop.tower,
      floor: stop.floor,
      apartmentCode: stop.apartment_code,
      displayName: stop.display_name,
      isQuest: !!stop.is_quest,
      arrivalMin: stop.arrival_min,
      departureMin: stop.departure_min,
    })),
  };
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
      familyCode: db.prepare('SELECT family_code FROM families WHERE id = ?').get(f.id).family_code,
      parents: db.prepare(`SELECT id, platform, platform_user_id AS platformUserId,
                           chat_id AS chatId, first_name AS firstName, last_name AS lastName,
                           username, updated_at AS updatedAt
                           FROM parent_links WHERE family_id = ? ORDER BY id`).all(f.id),
      wishFamilyIds: db.prepare(`SELECT CASE WHEN family_a = ? THEN family_b ELSE family_a END AS familyId
                                 FROM wish_links WHERE family_a = ? OR family_b = ?`).all(f.id, f.id, f.id).map((r) => r.familyId),
      currentGroupId: byFamily.get(f.id)?.group_id || null,
    })),
  });
});

// Пакет случайных анкет для проверки группировки и маршрутов администратором.
router.post('/test-data', (req, res) => {
  const requestedCount = Number(req.body.count ?? 20);
  const count = Number.isInteger(requestedCount) ? Math.min(Math.max(requestedCount, 1), 50) : 20;
  const createdFamilyIds = [];

  const tx = db.transaction(() => {
    const insertFamily = db.prepare(`
      INSERT INTO families (id, family_code, tower, floor, apartment_code, walking, hosting, quest, quest_duration_min, cancelled, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 0, ?)
    `);
    const insertChild = db.prepare('INSERT INTO children (family_id, name, age) VALUES (?, ?, ?)');
    const insertWish = db.prepare('INSERT OR IGNORE INTO wish_links (family_a, family_b) VALUES (?, ?)');

    for (let index = 0; index < count; index += 1) {
      const familyId = newId('test');
      const hosting = Math.random() < 0.7;
      const quest = hosting && Math.random() < 0.25;
      insertFamily.run(
        familyId,
        shortCode(),
        randomItem(TEST_TOWERS),
        randomInt(1, 35),
        String(randomInt(10, 999)),
        hosting ? 1 : 0,
        quest ? 1 : 0,
        quest ? randomItem([10, 15, 20]) : null,
        Date.now() + index
      );
      const childCount = randomInt(1, 3);
      for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
        insertChild.run(familyId, `Тест ${randomItem(TEST_CHILD_NAMES)} ${index + 1}`, randomInt(4, 14));
      }
      createdFamilyIds.push(familyId);
    }

    for (let index = 0; index + 1 < createdFamilyIds.length; index += 4) {
      const pair = [createdFamilyIds[index], createdFamilyIds[index + 1]].sort();
      insertWish.run(pair[0], pair[1]);
    }
  });
  tx();

  res.json({ ok: true, created: createdFamilyIds.length });
});

router.patch('/families/:id', (req, res) => {
  const current = db.prepare('SELECT * FROM families WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Семья не найдена' });
  const { tower, floor, apartmentCode, walking, hosting, quest, questDurationMin, cancelled, children } = req.body;
  if (floor !== undefined && (!Number.isInteger(Number(floor)) || Number(floor) < 0)) {
    return res.status(400).json({ error: 'Некорректный этаж' });
  }
  if (children !== undefined && (!Array.isArray(children) || children.length === 0)) {
    return res.status(400).json({ error: 'Нужен хотя бы один ребёнок' });
  }
  if (tower !== undefined && !String(tower).trim()) return res.status(400).json({ error: 'Башня обязательна' });
  if (apartmentCode !== undefined && !String(apartmentCode).trim()) return res.status(400).json({ error: 'Квартира обязательна' });
  if (Array.isArray(children) && children.some((child) => {
    const age = Number(child.age);
    return !String(child.name || '').trim() || !Number.isInteger(age) || age < 1 || age > 17;
  })) return res.status(400).json({ error: 'Некорректные данные ребёнка' });

  db.transaction(() => {
    db.prepare(`UPDATE families SET tower = COALESCE(@tower, tower), floor = COALESCE(@floor, floor),
      apartment_code = COALESCE(@apartmentCode, apartment_code), walking = COALESCE(@walking, walking),
      hosting = COALESCE(@hosting, hosting), quest = COALESCE(@quest, quest),
      quest_duration_min = @questDurationMin, cancelled = COALESCE(@cancelled, cancelled)
      WHERE id = @id`).run({
      id: req.params.id,
      tower: tower === undefined ? null : String(tower).trim(),
      floor: floor === undefined ? null : Number(floor),
      apartmentCode: apartmentCode === undefined ? null : String(apartmentCode).trim(),
      walking: walking === undefined ? null : walking ? 1 : 0,
      hosting: hosting === undefined ? null : hosting ? 1 : 0,
      quest: quest === undefined ? null : quest ? 1 : 0,
      questDurationMin: quest === false ? null : questDurationMin === undefined ? current.quest_duration_min : Number(questDurationMin) || 20,
      cancelled: cancelled === undefined ? null : cancelled ? 1 : 0,
    });
    if (Array.isArray(children)) {
      db.prepare('DELETE FROM children WHERE family_id = ?').run(req.params.id);
      const insert = db.prepare('INSERT INTO children (family_id, name, age) VALUES (?, ?, ?)');
      for (const child of children) {
        const name = String(child.name || '').trim();
        const age = Number(child.age);
        if (!name || !Number.isInteger(age) || age < 1 || age > 17) {
          throw new Error('Некорректные данные ребёнка');
        }
        insert.run(req.params.id, name, age);
      }
    }
    const currentAddress = db.prepare('SELECT tower, floor, apartment_code FROM families WHERE id = ?').get(req.params.id);
    db.prepare(`UPDATE route_stops SET tower = ?, floor = ?, apartment_code = ?
                WHERE host_type = 'family' AND host_id = ?`)
      .run(currentAddress.tower, currentAddress.floor, currentAddress.apartment_code, req.params.id);
  })();
  res.json({ ok: true });
});

router.get('/groups', (req, res) => {
  const groups = db.prepare('SELECT * FROM groups').all();
  res.json({
    groups: groups.map((g) => ({ ...g, ...loadGroupDetails(g.id), name: g.name || g.id })),
  });
});

router.patch('/groups/:id', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Название группы обязательно' });
  const result = db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Группа не найдена' });
  const group = loadGroupDetails(req.params.id);
  const notifications = await notifyChangedGroups([group]);
  res.json({ ok: true, notifications });
}));

router.put('/groups/:id/route', asyncRoute(async (req, res) => {
  const stopIds = Array.isArray(req.body.stopIds) ? req.body.stopIds.map(Number) : [];
  const existing = db.prepare('SELECT id FROM route_stops WHERE group_id = ? ORDER BY seq').all(req.params.id).map((r) => r.id);
  if (stopIds.length !== existing.length || new Set(stopIds).size !== existing.length || existing.some((id) => !stopIds.includes(id))) {
    return res.status(400).json({ error: 'Порядок должен содержать все точки маршрута ровно один раз' });
  }
  db.transaction(() => {
    const update = db.prepare('UPDATE route_stops SET seq = ? WHERE id = ? AND group_id = ?');
    stopIds.forEach((id, index) => update.run(index + 1, id, req.params.id));
  })();
  const group = loadGroupDetails(req.params.id);
  const notifications = group ? await notifyChangedGroups([group]) : { sent: 0 };
  res.json({ ok: true, notifications });
}));

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
router.post('/recompute', asyncRoute(async (req, res) => {
  const families = loadFamiliesForAlgo();
  const wishLinks = loadWishLinks();
  const specialPoints = loadSpecialPoints();

  const groups = buildGroups(families, wishLinks);
  const routes = buildRoutes(groups, families, specialPoints);
  const oldNames = new Map(db.prepare('SELECT id, name FROM groups').all().map((g) => [g.id, g.name]));

  const tx = db.transaction(() => {
    db.exec('DELETE FROM route_stops; DELETE FROM group_members; DELETE FROM groups;');

    const insertGroup = db.prepare(
      'INSERT INTO groups (id, name, avg_age, child_count, is_manual, total_min) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertMember = db.prepare('INSERT INTO group_members (group_id, family_id) VALUES (?, ?)');
    const insertStop = db.prepare(`
      INSERT INTO route_stops (group_id, host_id, host_type, seq, tower, floor, apartment_code, display_name, is_quest, arrival_min, departure_min)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const routeByGroup = new Map(routes.map((r) => [r.groupId, r]));

    for (const g of groups) {
      const route = routeByGroup.get(g.id);
      insertGroup.run(g.id, oldNames.get(g.id) || g.id, g.avgAge, g.childCount, g.isManual ? 1 : 0, route ? route.totalMin : null);
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

  const notificationGroups = groups.map((group) => {
    const route = routes.find((item) => item.groupId === group.id);
    return {
      id: group.id,
      name: oldNames.get(group.id) || group.id,
      memberFamilyIds: group.memberFamilyIds,
      stops: route?.stops || [],
    };
  });
  const notifications = await notifyChangedGroups(notificationGroups);
  res.json({ ok: true, groupCount: groups.length, notifications });
}));

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
