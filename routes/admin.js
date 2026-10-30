const { readStoredSchedule } = require('../lib/stored-route-schedule');
const { TOWERS, startTowerFor, parkingLocation, displayStartLocation } = require('../lib/route-schedule');
const express = require('express');
const { loadExtraHostVisits, rebuildStoredRoutes } = require('../lib/extra-host-visits');
const { assertWishGroups } = require('../lib/wish-links');
const { createExportDownload, getExportDownload, sendExcel } = require('../lib/export-downloads');
const { assignGroupNames } = require('../lib/group-names');
const { db, newId, shortCode, DEFAULT_GROUP_START_LOCATION } = require('../db');
const { buildGroups, fillExistingGroups, buildRoutes, MAX_GROUP_SIZE, isFamilyEligibleForGrouping } = require('../lib/grouping-routing');
const { validateInitData } = require('../lib/validateInitData');
const { isTelegramSuperAdmin } = require('../lib/admin-auth');
const { notifyChangedGroups, notifyCandyAccepted, notifyWaitingCandy } = require('../lib/notifications');
const { getEventSettings, saveEventStartLocal } = require('../lib/event-settings');
const { apartmentNumberKey, findApartmentConflict } = require('../lib/apartment-identity');
const { participantsWorkbookBuffer, routesWorkbookBuffer } = require('../lib/excel-exports');
const { removeFamilyAndRepair } = require('../lib/family-removal');

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
// Download managers cannot forward admin headers. Only an unguessable,
// short-lived token created by an authenticated export grants this access.
router.get('/export-downloads/:token', (req, res) => {
  const entry = getExportDownload(req.params.token);
  if (!entry) return res.status(404).set('Cache-Control', 'no-store').send('Ссылка истекла. Сформируйте Excel заново в админке.');
  return sendExcel(res, entry.buffer, entry.filename);
});

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
    adultChaperone: !!f.adult_chaperone,
    candyBrought: !!f.candy_brought,
    hosting: !!f.hosting,
    quest: !!f.quest,
    questDurationMin: f.quest_duration_min,
    manualGroupId: f.manual_group_id,
    groupingPaused: !!f.grouping_paused,
    cancelled: !!f.cancelled,
  }));
}

router.get('/group-names', (req, res) => {
  res.json({ names: db.prepare('SELECT * FROM group_name_catalog ORDER BY age_min, id').all() });
});

function saveCatalogName(req, res) {
  const name = String(req.body.name || '').trim();
  const min = Number(req.body.ageMin), max = Number(req.body.ageMax);
  if (!name || name.length > 80 || !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 17 || min > max) {
    return res.status(400).json({ error: 'Укажите название до 80 символов и возраст от 1 до 17 лет' });
  }
  if (db.prepare('SELECT id FROM group_name_catalog WHERE name = ? AND id != ?').get(name, Number(req.params.id) || 0)) {
    return res.status(409).json({ error: 'Такое название уже существует' });
  }
  if (req.params.id) {
    const result = db.prepare('UPDATE group_name_catalog SET name = ?, age_min = ?, age_max = ? WHERE id = ?').run(name, min, max, req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Название не найдено' });
  } else db.prepare('INSERT INTO group_name_catalog(name, age_min, age_max) VALUES (?, ?, ?)').run(name, min, max);
  res.json({ ok: true });
}
router.post('/group-names', saveCatalogName);
router.patch('/group-names/:id', saveCatalogName);
router.delete('/group-names/:id', (req, res) => {
  db.prepare('DELETE FROM group_name_catalog WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

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
    quest: !!sp.quest, routeFinal: !!sp.route_final, allowParallel: !!sp.allow_parallel,
    questDurationMin: sp.quest_duration_min,
  }));
}

function loadGroupDetails(groupId) {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group) return null;
  return {
    id: group.id,
    name: group.name || group.id,
    startLocation: displayStartLocation(group),
    startTower: startTowerFor(group),
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
      isFinal: stop.host_type === 'special' && !!db.prepare('SELECT route_final FROM special_points WHERE id=?').get(stop.host_id)?.route_final,
      arrivalMin: stop.arrival_min,
      departureMin: stop.departure_min,
      waitMin: stop.wait_min || 0,
    })),
  };
}

function recalculateGroupStats(groupId) {
  const stats = db.prepare(`SELECT COUNT(c.id) AS childCount, AVG(c.age) AS avgAge
    FROM group_members gm
    LEFT JOIN children c ON c.family_id = gm.family_id
    WHERE gm.group_id = ?`).get(groupId);
  db.prepare('UPDATE groups SET child_count = ?, avg_age = ? WHERE id = ?')
    .run(stats.childCount || 0, stats.avgAge === null ? null : Math.round(stats.avgAge * 10) / 10, groupId);
}

function resequenceStoredRoute(groupId) {
  const stops = db.prepare('SELECT id FROM route_stops WHERE group_id = ? ORDER BY seq, id').all(groupId);
  const update = db.prepare('UPDATE route_stops SET seq = ? WHERE id = ?');
  stops.forEach((stop, index) => update.run(index + 1, stop.id));
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

router.get('/export/participants.xlsx', asyncRoute(async (req, res) => {
  const rows = db.prepare(`
    SELECT c.name AS child_name, c.age, f.tower, f.floor,
           f.apartment_code, f.family_code, f.walking, f.hosting,
           f.quest, f.cancelled, g.name AS group_name, g.id AS group_id
    FROM children c
    JOIN families f ON f.id = c.family_id
    LEFT JOIN group_members gm ON gm.family_id = f.id
    LEFT JOIN groups g ON g.id = gm.group_id
    ORDER BY f.cancelled, f.tower COLLATE NOCASE, f.floor,
             f.apartment_code COLLATE NOCASE, c.age, c.name COLLATE NOCASE
  `).all().map((row) => ({
    childName: row.child_name,
    age: row.age,
    tower: row.tower,
    floor: row.floor,
    apartmentCode: row.apartment_code,
    familyCode: row.family_code,
    groupName: row.group_name || row.group_id || 'Не распределён',
    walking: row.walking ? 'Да' : 'Нет',
    hostingType: row.quest ? 'Квест' : row.hosting ? 'Раздаёт конфеты' : 'Не выбран',
    status: row.cancelled ? 'Отменена' : 'Активна',
  }));
  const buffer = await participantsWorkbookBuffer(rows);
  if (req.query.download === '1') return res.set('Cache-Control', 'no-store').json(createExportDownload(buffer, 'halloween-participants.xlsx'));
  sendExcel(res, buffer, 'halloween-participants.xlsx');
}));

router.get('/export/routes.xlsx', asyncRoute(async (req, res) => {
  const groups = db.prepare('SELECT id, name, start_location, child_count FROM groups ORDER BY id').all();
  const memberFamilies = db.prepare(`
    SELECT f.tower, f.floor, f.apartment_code
    FROM group_members gm
    JOIN families f ON f.id = gm.family_id
    WHERE gm.group_id = ?
    ORDER BY f.tower COLLATE NOCASE, f.floor, f.apartment_code COLLATE NOCASE
  `);
  const memberChildren = db.prepare(`
    SELECT c.name, c.age
    FROM group_members gm
    JOIN children c ON c.family_id = gm.family_id
    WHERE gm.group_id = ?
    ORDER BY c.age, c.name COLLATE NOCASE
  `);
  const routeStops = db.prepare('SELECT * FROM route_stops WHERE group_id = ? ORDER BY seq');
  const rows = groups.flatMap((group) => {
    const familiesText = memberFamilies.all(group.id)
      .map((family) => `${family.tower}, эт. ${family.floor}, кв. ${family.apartment_code}`).join('; ');
    const children = memberChildren.all(group.id);
    const childrenText = children.map((child) => `${child.name}, ${child.age}`).join('; ');
    const base = {
      groupName: group.name || group.id,
      childCount: group.child_count ?? children.length,
      memberFamilies: familiesText,
      memberChildren: childrenText,
    };
    const stops = routeStops.all(group.id);
    const startRow = {
      ...base,
      stage: 'Старт',
      stopType: 'Место сбора',
      displayName: group.start_location || DEFAULT_GROUP_START_LOCATION,
    };
    if (!stops.length) return [startRow, { ...base, stopType: 'Маршрут пуст' }];
    return [startRow, ...stops.map((stop) => ({
      ...base,
      stage: stop.seq,
      stopType: stop.is_quest ? 'Квест' : 'Конфеты',
      displayName: stop.display_name || (stop.host_type === 'family' ? 'Квартира' : ''),
      tower: stop.tower,
      floor: stop.floor,
      apartmentCode: stop.apartment_code || '',
      arrivalMin: stop.arrival_min,
      departureMin: stop.departure_min,
    }))];
  });
  const buffer = await routesWorkbookBuffer(rows);
  if (req.query.download === '1') return res.set('Cache-Control', 'no-store').json(createExportDownload(buffer, 'halloween-routes.xlsx'));
  sendExcel(res, buffer, 'halloween-routes.xlsx');
}));

router.delete('/families/:id', asyncRoute(async (req, res) => {
  const { eventStartAt } = getEventSettings();
  const maintenance = removeFamilyAndRepair(db, req.params.id, {
    eventStarted: !!eventStartAt && Date.now() >= eventStartAt,
  });
  if (!maintenance) return res.status(404).json({ error: 'Семья не найдена' });
  const notifications = await notifyChangedGroups(maintenance.changedGroups);
  res.json({ ok: true, maintenance: { ...maintenance, changedGroups: undefined }, notifications });
}));

router.get('/event-settings', (req, res) => {
  res.json(getEventSettings());
});

router.post('/notifications/waiting-candy', asyncRoute(async (req, res) => {
  try {
    res.json({ ok: true, ...await notifyWaitingCandy() });
  } catch (error) {
    if (error.status === 409) return res.status(409).json({ error: error.message });
    throw error;
  }
}));

router.put('/registration-settings', (req, res) => {
  if (typeof req.body.registrationClosed !== 'boolean') {
    return res.status(400).json({ error: 'Укажите состояние регистрации' });
  }
  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('registration_closed', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(req.body.registrationClosed ? '1' : '0');
  res.json({ ok: true, ...getEventSettings() });
});

router.put('/children-addition-settings', (req, res) => {
  if (typeof req.body.childrenAdditionClosed !== 'boolean') {
    return res.status(400).json({ error: 'Укажите состояние добавления детей' });
  }
  db.prepare(`INSERT INTO app_settings(key,value) VALUES ('children_addition_closed',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(req.body.childrenAdditionClosed ? '1' : '0');
  res.json({ ok: true, ...getEventSettings() });
});

router.put('/door-status-settings', (req, res) => {
  if (typeof req.body.doorStatusEnabled !== 'boolean') {
    return res.status(400).json({ error: 'Укажите состояние отметок «Не открыли»' });
  }
  db.prepare(`INSERT INTO app_settings(key,value) VALUES ('door_status_enabled',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(req.body.doorStatusEnabled ? '1' : '0');
  res.json({ ok: true, ...getEventSettings() });
});

router.put('/event-settings', (req, res) => {
  const timestamp = saveEventStartLocal(req.body.eventStartLocal);
  if (timestamp === null) {
    return res.status(400).json({ error: 'Укажите корректные дату и время сервера' });
  }
  res.json({ ok: true, ...getEventSettings() });
});

// Пакет случайных анкет для проверки группировки и маршрутов администратором.
router.post('/test-data', (req, res) => {
  const requestedCount = Number(req.body.count ?? 20);
  const count = Number.isInteger(requestedCount) ? Math.min(Math.max(requestedCount, 1), 50) : 20;
  const createdFamilyIds = [];

  const tx = db.transaction(() => {
    const insertFamily = db.prepare(`
      INSERT INTO families (id, family_code, tower, floor, apartment_code, walking, adult_chaperone, hosting, quest, quest_duration_min, cancelled, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 0, ?)
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
        Math.random() < 0.55 ? 1 : 0,
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

// Полная очистка данных участников для нового тестового прогона.
// Настройки события и спецточки намеренно сохраняются.
router.delete('/test-data/all', (req, res) => {
  const deleted = {
    families: db.prepare('SELECT COUNT(*) AS count FROM families').get().count,
    children: db.prepare('SELECT COUNT(*) AS count FROM children').get().count,
    groups: db.prepare('SELECT COUNT(*) AS count FROM groups').get().count,
    routes: db.prepare('SELECT COUNT(*) AS count FROM route_stops').get().count,
  };
  db.transaction(() => {
    db.prepare('DELETE FROM door_status').run();
    db.prepare('DELETE FROM recipient_notification_state').run();
    db.prepare('DELETE FROM route_stops').run();
    db.prepare('DELETE FROM group_members').run();
    db.prepare('DELETE FROM groups').run();
    db.prepare('DELETE FROM families').run();
  })();
  res.json({ ok: true, deleted });
});

router.patch('/families/:id', asyncRoute(async (req, res) => {
  const current = db.prepare('SELECT * FROM families WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Семья не найдена' });
  const { tower, floor, apartmentCode, walking, adultChaperone, candyBrought, hosting, quest, questDurationMin, cancelled, children } = req.body;
  if (candyBrought !== undefined && typeof candyBrought !== 'boolean') {
    return res.status(400).json({ error: 'Отметка «Принесли конфеты» должна быть галочкой' });
  }
  if (floor !== undefined && (!Number.isInteger(Number(floor)) || Number(floor) < 0)) {
    return res.status(400).json({ error: 'Некорректный этаж' });
  }
  if (children !== undefined && !Array.isArray(children)) {
    return res.status(400).json({ error: 'Нужен хотя бы один ребёнок' });
  }
  const nextChildren = children === undefined ? db.prepare('SELECT name, age FROM children WHERE family_id = ?').all(current.id) : children;
  if (!nextChildren.length && (!(hosting ?? current.hosting) && !(quest ?? current.quest) || (walking ?? current.walking) || (adultChaperone ?? current.adult_chaperone))) {
    return res.status(400).json({ error: 'Для квартиры без детей выберите конфеты или квест и отключите обход и сопровождение' });
  }
  if (tower !== undefined && !String(tower).trim()) return res.status(400).json({ error: 'Башня обязательна' });
  if (apartmentCode !== undefined && !String(apartmentCode).trim()) return res.status(400).json({ error: 'Квартира обязательна' });
  const nextTower = tower === undefined ? current.tower : String(tower).trim();
  const nextFloor = floor === undefined ? current.floor : Number(floor);
  const nextApartmentCode = apartmentCode === undefined ? current.apartment_code : String(apartmentCode).trim();
  const nextCancelled = cancelled === undefined ? !!current.cancelled : !!cancelled;
  if (!apartmentNumberKey(nextApartmentCode)) {
    return res.status(400).json({ error: 'Номер квартиры должен содержать цифры' });
  }
  const apartmentConflict = !nextCancelled && findApartmentConflict(db, {
    tower: nextTower,
    floor: nextFloor,
    apartmentCode: nextApartmentCode,
    excludeFamilyId: current.id,
  });
  if (apartmentConflict) {
    return res.status(409).json({ error: 'На этом этаже уже зарегистрирована квартира с таким номером.' });
  }
  if (Array.isArray(children) && children.some((child) => {
    const age = Number(child.age);
    return !String(child.name || '').trim() || !Number.isInteger(age) || age < 1 || age > 17;
  })) return res.status(400).json({ error: 'Некорректные данные ребёнка' });

  db.transaction(() => {
    db.prepare(`UPDATE families SET tower = COALESCE(@tower, tower), floor = COALESCE(@floor, floor),
      apartment_code = COALESCE(@apartmentCode, apartment_code), walking = COALESCE(@walking, walking),
      adult_chaperone = COALESCE(@adultChaperone, adult_chaperone),
      candy_brought = COALESCE(@candyBrought, candy_brought),
      hosting = COALESCE(@hosting, hosting), quest = COALESCE(@quest, quest),
      quest_duration_min = @questDurationMin, cancelled = COALESCE(@cancelled, cancelled)
      WHERE id = @id`).run({
      id: req.params.id,
      tower: tower === undefined ? null : String(tower).trim(),
      floor: floor === undefined ? null : Number(floor),
      apartmentCode: apartmentCode === undefined ? null : String(apartmentCode).trim(),
      walking: walking === undefined ? null : walking ? 1 : 0,
      adultChaperone: adultChaperone === undefined ? null : adultChaperone ? 1 : 0,
      candyBrought: candyBrought === undefined ? null : candyBrought ? 1 : 0,
      hosting: hosting === undefined && quest !== true ? null : hosting || quest ? 1 : 0,
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
  const notifications = candyBrought === true && !current.candy_brought
    ? await notifyCandyAccepted(req.params.id)
    : { sent: 0, failed: 0 };
  res.json({ ok: true, notifications });
}));

router.get('/route-schedule', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(readStoredSchedule());
});

router.get('/groups', (req, res) => {
  const groups = db.prepare('SELECT * FROM groups').all();
  res.json({
    groups: groups.map((g) => ({ ...g, ...loadGroupDetails(g.id), name: g.name || g.id })),
  });
});

// Дозаполняет существующие группы семьями из очереди, не пересоздавая их и
// не меняя названия. При большом остатке добавляет новые группы; начальная
// семья выбирается случайно при каждом запуске.
router.post('/groups/distribute-unassigned', asyncRoute(async (req, res) => {
  const storedGroups = db.prepare('SELECT * FROM groups ORDER BY id').all().map((group) => ({
    id: group.id,
    name: group.name || group.id,
    startLocation: group.start_location || DEFAULT_GROUP_START_LOCATION,
    routeQuestCount: db.prepare('SELECT SUM(is_quest) AS n FROM route_stops WHERE group_id=?').get(group.id).n ?? undefined,
    isManual: !!group.is_manual,
    memberFamilyIds: db.prepare('SELECT family_id FROM group_members WHERE group_id = ? ORDER BY family_id')
      .all(group.id).map((row) => row.family_id),
  }));
  if (!storedGroups.length) {
    return res.status(400).json({ error: 'Сначала сформируйте хотя бы одну группу' });
  }

  const families = loadFamiliesForAlgo();
  const result = fillExistingGroups(storedGroups, families, loadWishLinks());
  assignGroupNames(result.groups, db.prepare('SELECT * FROM group_name_catalog').all(), new Map(storedGroups.map((group) => [group.id, group])));
  if (!result.assignments.length) {
    return res.json({
      ok: true,
      assignedFamilyCount: 0,
      waitingFamilyCount: result.unassignedFamilyIds.length,
      starterFamilyId: result.starterFamilyId,
      createdGroupCount: 0,
      notifications: { sent: 0, ignoredByCooldown: 0 },
    });
  }

  const routes = buildRoutes(result.groups, families, loadSpecialPoints(), loadExtraHostVisits(db));
  const routeByGroup = new Map(routes.map((route) => [route.groupId, route]));
  db.transaction(() => {
    const insertGroup = db.prepare(
      'INSERT INTO groups (id, name, start_location, avg_age, child_count, is_manual, total_min) VALUES (?, ?, ?, ?, ?, 0, ?)'
    );
    for (const groupId of result.createdGroupIds) {
      const group = result.groups.find((item) => item.id === groupId);
      const route = routeByGroup.get(groupId);
      insertGroup.run(groupId, group.name, DEFAULT_GROUP_START_LOCATION, group.avgAge, group.childCount, route?.totalMin ?? null);
    }
    const insertMember = db.prepare('INSERT INTO group_members (group_id, family_id) VALUES (?, ?)');
    const activateFamily = db.prepare('UPDATE families SET grouping_paused = 0, manual_group_id = NULL WHERE id = ?');
    const removeMembership = db.prepare('DELETE FROM group_members WHERE family_id = ?');
    for (const assignment of result.assignments) {
      removeMembership.run(assignment.familyId);
      insertMember.run(assignment.groupId, assignment.familyId);
      activateFamily.run(assignment.familyId);
    }

    const updateGroup = db.prepare('UPDATE groups SET avg_age = ?, child_count = ?, total_min = ? WHERE id = ?');
    for (const group of result.groups) {
      updateGroup.run(group.avgAge, group.childCount, routeByGroup.get(group.id)?.totalMin ?? null, group.id);
    }

    db.prepare('DELETE FROM route_stops').run();
    const insertStop = db.prepare(`
      INSERT INTO route_stops (group_id, host_id, host_type, seq, tower, floor, apartment_code, display_name, is_quest, arrival_min, departure_min, wait_min)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const route of routes) {
      for (const stop of route.stops) {
        insertStop.run(
          route.groupId,
          stop.hostId,
          stop.hostType,
          stop.seq,
          stop.tower,
          stop.floor,
          stop.apartmentCode,
          stop.displayName,
          stop.isQuest ? 1 : 0,
          stop.arrival,
          stop.departure,
          stop.waitMin || 0
        );
      }
    }
  })();

  // Перестроение маршрутов может затронуть и соседние группы из-за общей
  // балансировки квартир, поэтому проверяем уведомления для всех групп.
  const changedGroups = result.groups.map((group) => ({
      ...group,
      name: group.name || group.id,
      startLocation: storedGroups.find((stored) => stored.id === group.id)?.startLocation || DEFAULT_GROUP_START_LOCATION,
      stops: routeByGroup.get(group.id)?.stops || [],
    }));
  const notifications = await notifyChangedGroups(changedGroups);
  return res.json({
    ok: true,
    assignedFamilyCount: result.assignments.filter((assignment) => !storedGroups.some((group) => group.memberFamilyIds.includes(assignment.familyId))).length,
    movedFamilyCount: result.assignments.filter((assignment) => storedGroups.some((group) => group.memberFamilyIds.includes(assignment.familyId))).length,
    waitingFamilyCount: result.unassignedFamilyIds.length,
    starterFamilyId: result.starterFamilyId,
    createdGroupCount: result.createdGroupIds.length,
    notifications,
  });
}));

router.patch('/groups/:id', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const startTower = req.body.startTower;
  if (startTower !== undefined && !TOWERS.includes(startTower)) return res.status(400).json({ error: 'Выберите башню места сбора' });
  const current = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Группа не найдена' });
  const startLocation = startTower !== undefined ? parkingLocation(startTower)
    : req.body.startLocation === undefined ? current.start_location : String(req.body.startLocation || '').trim();
  if (!name) return res.status(400).json({ error: 'Название группы обязательно' });
  if (startLocation.length > 240) return res.status(400).json({ error: 'Место сбора слишком длинное' });
  const result = db.prepare('UPDATE groups SET name = ?, start_location = ? WHERE id = ?')
    .run(name, startLocation || DEFAULT_GROUP_START_LOCATION, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Группа не найдена' });
  const group = loadGroupDetails(req.params.id);
  const notifications = await notifyChangedGroups([group]);
  res.json({ ok: true, notifications });
}));

// Удаление группы не удаляет регистрации: её семьи переходят в явную очередь
// ожидания и не попадут обратно в автоподбор, пока администратор их не вернёт.
router.delete('/groups/:id', (req, res) => {
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  const familyIds = db.prepare('SELECT family_id FROM group_members WHERE group_id = ?').all(req.params.id).map((row) => row.family_id);
  db.transaction(() => {
    const pause = db.prepare('UPDATE families SET grouping_paused = 1, manual_group_id = NULL WHERE id = ?');
    familyIds.forEach((familyId) => pause.run(familyId));
    db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  })();
  res.json({ ok: true, waitingFamilyCount: familyIds.length });
});

router.delete('/groups/:id/members/:familyId', asyncRoute(async (req, res) => {
  const membership = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND family_id = ?')
    .get(req.params.id, req.params.familyId);
  if (!membership) return res.status(404).json({ error: 'Семья не состоит в этой группе' });
  db.transaction(() => {
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND family_id = ?').run(req.params.id, req.params.familyId);
    db.prepare('UPDATE families SET grouping_paused = 0, manual_group_id = NULL WHERE id = ?').run(req.params.familyId);
    recalculateGroupStats(req.params.id);
  })();
  const changedGroup = loadGroupDetails(req.params.id);
  const notifications = changedGroup ? await notifyChangedGroups([changedGroup]) : { sent: 0 };
  res.json({ ok: true, status: 'waiting', notifications });
}));

async function assignFamilyToGroup(req, res, { ignoreCapacity = false } = {}) {
  const familyId = String(req.body.familyId || '');
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  const family = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (!family) return res.status(404).json({ error: 'Семья не найдена' });
  if (!family.walking || family.cancelled) return res.status(400).json({ error: 'Семья не участвует в обходе' });
  if (!isFamilyEligibleForGrouping({ id: family.id, hosting: family.hosting, quest: family.quest, candyBrought: family.candy_brought }, loadWishLinks())) {
    return res.status(400).json({ error: 'Семья без пожеланий должна принести конфеты или проводить квест / раздачу конфет' });
  }
  const familyChildren = db.prepare('SELECT COUNT(*) AS count FROM children WHERE family_id = ?').get(familyId).count;
  const currentChildren = db.prepare(`SELECT COUNT(c.id) AS count FROM group_members gm
    JOIN children c ON c.family_id = gm.family_id WHERE gm.group_id = ? AND gm.family_id != ?`)
    .get(req.params.id, familyId).count;
  if (!ignoreCapacity && currentChildren + familyChildren > MAX_GROUP_SIZE) {
    const connected = new Set([familyId]);
    const wishes = loadWishLinks();
    let changed = true;
    while (changed) {
      changed = false;
      for (const { a, b } of wishes) {
        if (connected.has(a) && !connected.has(b)) { connected.add(b); changed = true; }
        if (connected.has(b) && !connected.has(a)) { connected.add(a); changed = true; }
      }
    }
    const members = db.prepare('SELECT family_id FROM group_members WHERE group_id = ? AND family_id != ?').all(req.params.id, familyId);
    if (!members.some((member) => connected.has(member.family_id))) {
      return res.status(400).json({ error: `В группе будет больше ${MAX_GROUP_SIZE} детей. Превышение разрешено только по пожеланию ходить вместе.` });
    }
  }
  const oldGroupIds = db.prepare('SELECT group_id FROM group_members WHERE family_id = ?').all(familyId).map((row) => row.group_id);
  db.transaction(() => {
    db.prepare('DELETE FROM group_members WHERE family_id = ?').run(familyId);
    db.prepare('INSERT INTO group_members (group_id, family_id) VALUES (?, ?)').run(req.params.id, familyId);
    db.prepare('UPDATE families SET grouping_paused = 0, manual_group_id = ? WHERE id = ?').run(req.params.id, familyId);
    // После ручного назначения семья не должна получить собственную квартиру
    // в маршруте новой группы. Полный набор точек обновится при пересчёте.
    db.prepare("DELETE FROM route_stops WHERE group_id = ? AND host_type = 'family' AND host_id = ?")
      .run(req.params.id, familyId);
    resequenceStoredRoute(req.params.id);
    [...new Set([...oldGroupIds, req.params.id])].forEach(recalculateGroupStats);
  })();
  const changedGroups = [...new Set([...oldGroupIds, req.params.id])].map(loadGroupDetails).filter(Boolean);
  const notifications = await notifyChangedGroups(changedGroups);
  res.json({ ok: true, notifications });
}
router.post('/groups/:id/members', asyncRoute((req, res) => assignFamilyToGroup(req, res)));

router.post('/families/:id/grouping/resume', (req, res) => {
  const result = db.prepare('UPDATE families SET grouping_paused = 0, manual_group_id = NULL WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Семья не найдена' });
  res.json({ ok: true });
});

router.put('/groups/:id/route', asyncRoute(async (req, res) => {
  const stopIds = Array.isArray(req.body.stopIds) ? req.body.stopIds.map(Number) : [];
  const existingStops = db.prepare('SELECT id, host_id, host_type FROM route_stops WHERE group_id = ? ORDER BY seq').all(req.params.id);
  const existingIds = existingStops.map((stop) => stop.id);
  if (stopIds.length !== existingIds.length || new Set(stopIds).size !== existingIds.length || existingIds.some((id) => !stopIds.includes(id))) {
    return res.status(400).json({ error: 'Порядок должен содержать все точки маршрута ровно один раз' });
  }
  const finalStops = existingStops.filter((stop) => stop.host_type === 'special'
    && db.prepare('SELECT route_final FROM special_points WHERE id=?').get(stop.host_id)?.route_final);
  if (finalStops.some((stop) => stopIds.at(-1) !== stop.id)) {
    return res.status(400).json({ error: 'Финальная спецточка должна оставаться последней остановкой.' });
  }
  db.transaction(() => {
    const update = db.prepare('UPDATE route_stops SET seq = ?, wait_min = 0 WHERE id = ? AND group_id = ?');
    stopIds.forEach((id, index) => update.run(index + 1, id, req.params.id));
  })();
  const group = loadGroupDetails(req.params.id);
  const notifications = group ? await notifyChangedGroups([group]) : { sent: 0 };
  res.json({ ok: true, notifications });
}));

// Apply a manual selection immediately, using the same validated membership operation.
router.post('/override', asyncRoute(async (req, res) => {
  const { familyId, groupId } = req.body;
  if (typeof familyId !== 'string' || !familyId) return res.status(400).json({ error: 'familyId обязателен' });
  if (groupId != null && typeof groupId !== 'string') return res.status(400).json({ error: 'Некорректная группа' });
  if (groupId) return assignFamilyToGroup({ params: { id: groupId }, body: { familyId } }, res, { ignoreCapacity: true });
  const result = db.prepare('UPDATE families SET manual_group_id = NULL, grouping_paused = 0 WHERE id = ?').run(familyId);
  if (!result.changes) return res.status(404).json({ error: 'Семья не найдена' });
  res.json({ ok: true });
}));

router.get('/extra-host-visits', (req, res) => res.json({ visits: loadExtraHostVisits(db) }));
router.post('/hosts/:familyId/visits', (req, res) => {
  const host = db.prepare('SELECT * FROM families WHERE id=?').get(req.params.familyId);
  if (!host || host.cancelled || (!host.hosting && !host.quest)) return res.status(400).json({ error: 'Квартира не принимает гостей' });
  const groupId = req.body.groupId;
  if (typeof groupId !== 'string' || !db.prepare('SELECT 1 FROM groups WHERE id=?').get(groupId)) return res.status(400).json({ error: 'Выберите существующую группу' });
  const routes = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO extra_host_visits(group_id,family_id) VALUES (?,?)').run(groupId, host.id);
    return rebuildStoredRoutes(db, { preserveStops: true });
  })();
  res.json({ ok: true, stopCount: routes.find((r) => r.groupId === groupId)?.stops.length || 0 });
});

// Rebuild routes without changing registrations, memberships, or group names.
router.post('/recompute-routes', (req, res) => {
  if (!db.prepare('SELECT 1 FROM groups LIMIT 1').get()) return res.status(400).json({ error: 'Сначала сформируйте группы' });
  const routes = rebuildStoredRoutes(db);
  res.json({ ok: true, groupCount: routes.length, stopCount: routes.reduce((sum, route) => sum + route.stops.length, 0) });
});

// Пересчитать группы и маршруты по текущему состоянию БД.
// manual_group_id уважается алгоритмом (buildGroups сам выделяет такие семьи).
router.post('/recompute', asyncRoute(async (req, res) => {
  const hasGroups = db.prepare('SELECT COUNT(*) AS count FROM groups').get().count > 0;
  // После удаления последней группы все её участники находятся в явной
  // очереди ожидания. Полное формирование должно снова взять их в работу,
  // иначе buildGroups получает пустой список и не может создать группы.
  const resumedWaitingCount = hasGroups ? 0 : db.prepare(`
    UPDATE families SET grouping_paused = 0
    WHERE grouping_paused = 1 AND walking = 1 AND cancelled = 0
  `).run().changes;
  const families = loadFamiliesForAlgo();
  const wishLinks = loadWishLinks();
  const specialPoints = loadSpecialPoints();

  const groups = buildGroups(families, wishLinks);
  assertWishGroups(groups, wishLinks);
  const extraVisits = loadExtraHostVisits(db);
  const oldGroups = new Map(db.prepare('SELECT id, name, start_location, (SELECT SUM(is_quest) FROM route_stops WHERE group_id=groups.id) AS routeQuestCount FROM groups').all().map((g) => [g.id, g]));
  const routes = buildRoutes(groups.map((g) => ({ ...g, startLocation: oldGroups.get(g.id)?.start_location, routeQuestCount: oldGroups.get(g.id)?.routeQuestCount ?? undefined })), families, specialPoints, extraVisits);
  assignGroupNames(groups, db.prepare('SELECT * FROM group_name_catalog').all(), oldGroups);

  const tx = db.transaction(() => {
    db.exec('DELETE FROM route_stops; DELETE FROM group_members; DELETE FROM groups;');

    const insertGroup = db.prepare(
      'INSERT INTO groups (id, name, start_location, avg_age, child_count, is_manual, total_min) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertMember = db.prepare('INSERT INTO group_members (group_id, family_id) VALUES (?, ?)');
    const insertStop = db.prepare(`
      INSERT INTO route_stops (group_id, host_id, host_type, seq, tower, floor, apartment_code, display_name, is_quest, arrival_min, departure_min, wait_min)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const routeByGroup = new Map(routes.map((r) => [r.groupId, r]));

    for (const g of groups) {
      const route = routeByGroup.get(g.id);
      const previous = oldGroups.get(g.id);
      insertGroup.run(g.id, g.name, previous?.start_location || DEFAULT_GROUP_START_LOCATION, g.avgAge, g.childCount, g.isManual ? 1 : 0, route ? route.totalMin : null);
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
            stop.departure,
            stop.waitMin || 0
          );
        }
      }
    }
  });
  // Restore explicit visits after group rows are replaced by full formation.
  const saveGroups = db.transaction(() => {
    tx();
    const insertExtra = db.prepare('INSERT OR IGNORE INTO extra_host_visits(group_id,family_id) VALUES (?,?)');
    for (const visit of extraVisits) {
      if (groups.some((g) => g.id === visit.groupId)) insertExtra.run(visit.groupId, visit.familyId);
    }
  });
  saveGroups();

  const notificationGroups = groups.map((group) => {
    const route = routes.find((item) => item.groupId === group.id);
    return {
      id: group.id,
      name: group.name || group.id,
      startLocation: oldGroups.get(group.id)?.start_location || DEFAULT_GROUP_START_LOCATION,
      memberFamilyIds: group.memberFamilyIds,
      stops: route?.stops || [],
    };
  });
  const notifications = await notifyChangedGroups(notificationGroups);
  res.json({ ok: true, groupCount: groups.length, resumedWaitingCount, notifications });
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
