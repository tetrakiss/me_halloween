const express = require('express');
const { db, shortCode, newId } = require('../db');
const { isTelegramSuperAdmin } = require('../lib/admin-auth');

const router = express.Router();

function getFamilyForUser(platform, platformUserId) {
  const link = db
    .prepare('SELECT family_id FROM parent_links WHERE platform = ? AND platform_user_id = ?')
    .get(platform, platformUserId);
  if (!link) return null;
  return db.prepare('SELECT * FROM families WHERE id = ?').get(link.family_id);
}

function familyWithChildren(family) {
  if (!family) return null;
  const children = db.prepare('SELECT id, name, age FROM children WHERE family_id = ?').all(family.id);
  const wishLinks = db
    .prepare(
      `SELECT family_a, family_b FROM wish_links WHERE family_a = ? OR family_b = ?`
    )
    .all(family.id, family.id);
  return {
    id: family.id,
    familyCode: family.family_code,
    tower: family.tower,
    floor: family.floor,
    apartmentCode: family.apartment_code,
    walking: !!family.walking,
    hosting: !!family.hosting,
    quest: !!family.quest,
    questDurationMin: family.quest_duration_min,
    cancelled: !!family.cancelled,
    children,
    wishLinks: wishLinks.map((w) => (w.family_a === family.id ? w.family_b : w.family_a)),
  };
}

function validFloor(value) {
  const floor = Number(value);
  return Number.isInteger(floor) && floor >= 0 && floor <= 200;
}

function validChildren(children) {
  return Array.isArray(children) && children.length > 0 && children.every((child) => {
    const age = Number(child.age);
    return String(child.name || '').trim() && Number.isInteger(age) && age >= 1 && age <= 17;
  });
}

function saveParentProfile(platform, platformUserId, familyId, user, chatId) {
  db.prepare(`INSERT INTO parent_links
      (platform, platform_user_id, family_id, chat_id, first_name, last_name, username, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      platform,
      platformUserId,
      familyId,
      chatId || null,
      user?.first_name || user?.name || null,
      user?.last_name || null,
      user?.username || null,
      Date.now()
    );
}

function routeForFamily(family) {
  const membership = db
    .prepare('SELECT group_id FROM group_members WHERE family_id = ?')
    .get(family.id);
  if (!membership) return null;

  const stops = db
    .prepare('SELECT * FROM route_stops WHERE group_id = ? ORDER BY seq')
    .all(membership.group_id);

  return stops.map((s) => {
    const lastStatus = db
      .prepare(
        `SELECT status FROM door_status WHERE host_id = ? ORDER BY reported_at DESC LIMIT 1`
      )
      .get(s.host_id);
    return {
      seq: s.seq,
      tower: s.tower,
      floor: s.floor,
      apartmentCode: s.apartment_code,
      displayName: s.display_name,
      isSpecial: s.host_type === 'special',
      isQuest: !!s.is_quest,
      hostId: s.host_id,
      lastKnownStatus: lastStatus ? lastStatus.status : null,
    };
  });
}

// ---- Регистрация новой семьи ----
router.post('/register', (req, res) => {
  const { platform, platformUserId } = req;
  const {
    tower,
    floor,
    apartmentCode,
    children,
    walking = true,
    hosting = false,
    quest = false,
    questDurationMin,
    wishFamilyId,
  } = req.body;

  if (!tower || !validFloor(floor) || !String(apartmentCode || '').trim() || !validChildren(children)) {
    return res.status(400).json({ error: 'tower, floor, apartmentCode и хотя бы один ребёнок обязательны' });
  }

  const existing = getFamilyForUser(platform, platformUserId);
  if (existing) {
    return res.status(409).json({ error: 'Этот аккаунт уже привязан к семье', familyId: existing.id });
  }

  const familyId = newId('fam');
  const familyCode = shortCode();

  const insertFamily = db.prepare(`
    INSERT INTO families (id, family_code, tower, floor, apartment_code, walking, hosting, quest, quest_duration_min, cancelled, created_at)
    VALUES (@id, @familyCode, @tower, @floor, @apartmentCode, @walking, @hosting, @quest, @questDurationMin, 0, @createdAt)
  `);
  const insertChild = db.prepare('INSERT INTO children (family_id, name, age) VALUES (?, ?, ?)');
  const insertWish = db.prepare(
    'INSERT OR IGNORE INTO wish_links (family_a, family_b) VALUES (?, ?)'
  );

  const tx = db.transaction(() => {
    insertFamily.run({
      id: familyId,
      familyCode,
      tower,
      floor,
      apartmentCode,
      walking: walking ? 1 : 0,
      hosting: hosting ? 1 : 0,
      quest: quest ? 1 : 0,
      questDurationMin: quest ? questDurationMin || 20 : null,
      createdAt: Date.now(),
    });
    for (const ch of children) {
      if (!ch.name || !ch.age) continue;
      insertChild.run(familyId, ch.name, Number(ch.age));
    }
    saveParentProfile(platform, platformUserId, familyId, req.platformUser, req.platformChatId);
    if (wishFamilyId) {
      insertWish.run(familyId, wishFamilyId);
    }
  });
  tx();

  res.json({ family: familyWithChildren(db.prepare('SELECT * FROM families WHERE id = ?').get(familyId)) });
});

// ---- Присоединение второго родителя по коду семьи ----
router.post('/join', (req, res) => {
  const { platform, platformUserId } = req;
  const { familyCode } = req.body;
  if (!familyCode) return res.status(400).json({ error: 'familyCode обязателен' });

  const family = db.prepare('SELECT * FROM families WHERE family_code = ?').get(familyCode.toUpperCase());
  if (!family) return res.status(404).json({ error: 'Код не найден' });

  const already = db
    .prepare('SELECT 1 FROM parent_links WHERE platform = ? AND platform_user_id = ?')
    .get(platform, platformUserId);
  if (already) {
    return res.status(409).json({ error: 'Этот аккаунт уже привязан к какой-то семье' });
  }

  saveParentProfile(platform, platformUserId, family.id, req.platformUser, req.platformChatId);

  res.json({ family: familyWithChildren(family) });
});

// ---- Автоподсказки номеров квартир (для поля "хотим ходить вместе") ----
router.get('/apartments-suggest', (req, res) => {
  const { tower, query = '' } = req.query;
  if (!tower) return res.status(400).json({ error: 'tower обязателен' });

  const rows = db
    .prepare(
      `SELECT DISTINCT apartment_code FROM families
       WHERE tower = ? AND cancelled = 0 AND apartment_code LIKE ?
       ORDER BY apartment_code LIMIT 8`
    )
    .all(tower, `${query}%`);

  res.json({ apartmentCodes: rows.map((r) => r.apartment_code) });
});

// ---- Поиск семьи для "хотим ходить вместе" ----
router.get('/search', (req, res) => {
  const { tower, apartmentCode } = req.query;
  if (!tower || !apartmentCode) return res.status(400).json({ error: 'tower и apartmentCode обязательны' });

  const family = db
    .prepare('SELECT * FROM families WHERE tower = ? AND apartment_code = ? AND cancelled = 0')
    .get(tower, apartmentCode);

  if (!family) return res.json({ found: false });

  const children = db.prepare('SELECT name, age FROM children WHERE family_id = ?').all(family.id);
  res.json({
    found: true,
    familyId: family.id,
    childrenNames: children.map((c) => c.name),
  });
});

// ---- Текущая семья + маршрут для открывшего мини-апп ----
router.get('/me', (req, res) => {
  const { platform, platformUserId } = req;
  const family = getFamilyForUser(platform, platformUserId);
  if (!family) {
    return res.json({
      family: null,
      isAdmin: isTelegramSuperAdmin(platform, req.platformUser),
    });
  }

  const groupInfo = db
    .prepare(
      `SELECT g.id, g.name, g.total_min FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.family_id = ?`
    )
    .get(family.id);

  res.json({
    family: familyWithChildren(family),
    group: groupInfo ? { id: groupInfo.id, name: groupInfo.name || groupInfo.id } : null,
    route: groupInfo ? routeForFamily(family) : null,
    isAdmin: isTelegramSuperAdmin(platform, req.platformUser),
  });
});

// ---- Редактирование своей анкеты ----
router.patch('/me', (req, res) => {
  const { platform, platformUserId } = req;
  const family = getFamilyForUser(platform, platformUserId);
  if (!family) return res.status(404).json({ error: 'Семья не найдена для этого аккаунта' });

  const {
    tower,
    floor,
    apartmentCode,
    walking,
    hosting,
    quest,
    questDurationMin,
    cancelled,
    children,
  } = req.body;

  if (floor !== undefined && !validFloor(floor)) {
    return res.status(400).json({ error: 'Укажите корректный этаж' });
  }
  if (children !== undefined && !validChildren(children)) {
    return res.status(400).json({ error: 'Укажите имя и возраст каждого ребёнка' });
  }
  if (tower !== undefined && !String(tower).trim()) return res.status(400).json({ error: 'Башня обязательна' });
  if (apartmentCode !== undefined && !String(apartmentCode).trim()) {
    return res.status(400).json({ error: 'Номер квартиры обязателен' });
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE families SET
        tower = COALESCE(@tower, tower),
        floor = COALESCE(@floor, floor),
        apartment_code = COALESCE(@apartmentCode, apartment_code),
        walking = COALESCE(@walking, walking),
        hosting = COALESCE(@hosting, hosting),
        quest = COALESCE(@quest, quest),
        quest_duration_min = @questDurationMin,
        cancelled = COALESCE(@cancelled, cancelled)
       WHERE id = @id`
    ).run({
      id: family.id,
      tower: tower === undefined ? null : String(tower).trim(),
      floor: floor === undefined ? null : Number(floor),
      apartmentCode: apartmentCode === undefined ? null : String(apartmentCode).trim(),
      walking: walking === undefined ? null : walking ? 1 : 0,
      hosting: hosting === undefined ? null : hosting ? 1 : 0,
      quest: quest === undefined ? null : quest ? 1 : 0,
      questDurationMin:
        quest === false ? null : questDurationMin === undefined ? family.quest_duration_min : Number(questDurationMin) || 20,
      cancelled: cancelled === undefined ? null : cancelled ? 1 : 0,
    });

    if (Array.isArray(children)) {
      db.prepare('DELETE FROM children WHERE family_id = ?').run(family.id);
      const insertChild = db.prepare('INSERT INTO children (family_id, name, age) VALUES (?, ?, ?)');
      for (const ch of children) {
        if (!ch.name || !ch.age) continue;
        insertChild.run(family.id, ch.name, Number(ch.age));
      }
    }

    // Адрес дублируется в уже сформированных маршрутах. Обновляем снимок,
    // чтобы новый этаж/квартира сразу появились у всех групп без пересчёта.
    const currentAddress = db.prepare('SELECT tower, floor, apartment_code FROM families WHERE id = ?').get(family.id);
    db.prepare(`UPDATE route_stops SET tower = ?, floor = ?, apartment_code = ?
                WHERE host_type = 'family' AND host_id = ?`)
      .run(currentAddress.tower, currentAddress.floor, currentAddress.apartment_code, family.id);
  });
  tx();

  const updated = db.prepare('SELECT * FROM families WHERE id = ?').get(family.id);
  res.json({ family: familyWithChildren(updated) });
});

// ---- Отметка "не открыли дверь" (или "закрыто" для спецточки) ----
router.post('/door-status', (req, res) => {
  const { platform, platformUserId } = req;
  const family = getFamilyForUser(platform, platformUserId);
  if (!family) return res.status(404).json({ error: 'Семья не найдена для этого аккаунта' });

  const { hostId, status } = req.body;
  if (!hostId || !['no_answer', 'opened'].includes(status)) {
    return res.status(400).json({ error: 'hostId и корректный status обязательны' });
  }

  const membership = db
    .prepare('SELECT group_id FROM group_members WHERE family_id = ?')
    .get(family.id);
  if (!membership) return res.status(400).json({ error: 'Группа ещё не сформирована' });

  db.prepare(
    'INSERT INTO door_status (host_id, group_id, status, reported_at) VALUES (?, ?, ?, ?)'
  ).run(hostId, membership.group_id, status, Date.now());

  res.json({ ok: true });
});

module.exports = router;
