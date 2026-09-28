const {
  buildRoutes,
  REGULAR_VISIT_MIN,
  DEFAULT_QUEST_VISIT_MIN,
  TRANSFER_MIN,
  MIN_GROUP_SIZE,
} = require('./grouping-routing');

function loadFamilies(db) {
  return db.prepare('SELECT * FROM families').all().map((family) => ({
    id: family.id,
    tower: family.tower,
    floor: family.floor,
    apartmentCode: family.apartment_code,
    children: db.prepare('SELECT name, age FROM children WHERE family_id = ?').all(family.id),
    walking: !!family.walking,
    hosting: !!family.hosting,
    quest: !!family.quest,
    questDurationMin: family.quest_duration_min,
    cancelled: !!family.cancelled,
  }));
}

function loadSpecialPoints(db) {
  return db.prepare('SELECT * FROM special_points').all().map((point) => ({
    id: point.id,
    tower: point.tower,
    floor: point.floor,
    name: point.name,
    active: !!point.active,
    quest: !!point.quest,
    questDurationMin: point.quest_duration_min,
  }));
}

function loadGroupDetails(db, groupId) {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group) return null;
  return {
    id: group.id,
    name: group.name || group.id,
    startLocation: group.start_location || '',
    memberFamilyIds: db.prepare('SELECT family_id FROM group_members WHERE group_id = ? ORDER BY family_id')
      .all(groupId).map((row) => row.family_id),
    stops: db.prepare('SELECT * FROM route_stops WHERE group_id = ? ORDER BY seq, id').all(groupId).map((stop) => ({
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

function recalculateGroupStats(db, groupId) {
  const stats = db.prepare(`SELECT COUNT(c.id) AS childCount, AVG(c.age) AS avgAge
    FROM group_members gm
    LEFT JOIN children c ON c.family_id = gm.family_id
    WHERE gm.group_id = ?`).get(groupId);
  db.prepare('UPDATE groups SET child_count = ?, avg_age = ? WHERE id = ?').run(
    Number(stats.childCount || 0),
    stats.avgAge === null ? null : Math.round(stats.avgAge * 10) / 10,
    groupId
  );
}

function deleteEmptyGroups(db) {
  const emptyGroupIds = db.prepare(`
    SELECT g.id FROM groups g
    LEFT JOIN group_members gm ON gm.group_id = g.id
    GROUP BY g.id HAVING COUNT(gm.family_id) = 0
  `).all().map((row) => row.id);
  const deleteNotifications = db.prepare('DELETE FROM recipient_notification_state WHERE group_id = ?');
  const deleteGroup = db.prepare('DELETE FROM groups WHERE id = ?');
  emptyGroupIds.forEach((groupId) => {
    deleteNotifications.run(groupId);
    deleteGroup.run(groupId);
  });
  return emptyGroupIds;
}

function rebuildAllRoutes(db) {
  const groups = db.prepare('SELECT id FROM groups ORDER BY id').all().map((group) => ({
    id: group.id,
    memberFamilyIds: db.prepare('SELECT family_id FROM group_members WHERE group_id = ? ORDER BY family_id')
      .all(group.id).map((row) => row.family_id),
  }));
  groups.forEach((group) => recalculateGroupStats(db, group.id));
  const routes = buildRoutes(groups, loadFamilies(db), loadSpecialPoints(db));
  const insertStop = db.prepare(`
    INSERT INTO route_stops (group_id, host_id, host_type, seq, tower, floor, apartment_code, display_name, is_quest, arrival_min, departure_min)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateTotal = db.prepare('UPDATE groups SET total_min = ? WHERE id = ?');
  db.prepare('DELETE FROM route_stops').run();
  routes.forEach((route) => {
    route.stops.forEach((stop) => insertStop.run(
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
      stop.departure
    ));
    updateTotal.run(route.totalMin, route.groupId);
  });
  return groups.map((group) => group.id);
}

function compactStoredRoutes(db, groupIds) {
  const updateStop = db.prepare('UPDATE route_stops SET seq = ?, arrival_min = ?, departure_min = ? WHERE id = ?');
  const updateTotal = db.prepare('UPDATE groups SET total_min = ? WHERE id = ?');
  groupIds.forEach((groupId) => {
    const stops = db.prepare('SELECT * FROM route_stops WHERE group_id = ? ORDER BY seq, id').all(groupId);
    let elapsed = 0;
    stops.forEach((stop, index) => {
      if (index > 0) elapsed += TRANSFER_MIN;
      const storedDuration = Number(stop.departure_min) - Number(stop.arrival_min);
      const duration = Number.isFinite(storedDuration) && storedDuration > 0
        ? storedDuration
        : stop.is_quest ? DEFAULT_QUEST_VISIT_MIN : REGULAR_VISIT_MIN;
      const arrival = elapsed;
      const departure = arrival + duration;
      updateStop.run(index + 1, arrival, departure, stop.id);
      elapsed = departure;
    });
    updateTotal.run(elapsed, groupId);
  });
}

function removeFamilyAndRepair(db, familyId, { eventStarted = false } = {}) {
  const family = db.prepare('SELECT id FROM families WHERE id = ?').get(familyId);
  if (!family) return null;
  const memberGroupIds = db.prepare('SELECT group_id FROM group_members WHERE family_id = ?').all(familyId).map((row) => row.group_id);
  const routeGroupIds = db.prepare("SELECT DISTINCT group_id FROM route_stops WHERE host_type = 'family' AND host_id = ?")
    .all(familyId).map((row) => row.group_id);
  const removedRouteStopCount = db.prepare("SELECT COUNT(*) AS count FROM route_stops WHERE host_type = 'family' AND host_id = ?")
    .get(familyId).count;

  let removedGroupIds = [];
  let changedGroupIds = [];
  db.transaction(() => {
    db.prepare("DELETE FROM route_stops WHERE host_type = 'family' AND host_id = ?").run(familyId);
    db.prepare('DELETE FROM door_status WHERE host_id = ?').run(familyId);
    db.prepare('DELETE FROM families WHERE id = ?').run(familyId);
    removedGroupIds = deleteEmptyGroups(db);
    const removed = new Set(removedGroupIds);

    if (eventStarted) {
      changedGroupIds = [...new Set([...memberGroupIds, ...routeGroupIds])].filter((groupId) => !removed.has(groupId));
      memberGroupIds.filter((groupId) => !removed.has(groupId)).forEach((groupId) => recalculateGroupStats(db, groupId));
      compactStoredRoutes(db, changedGroupIds);
    } else {
      changedGroupIds = rebuildAllRoutes(db);
    }
  })();

  const groupsNeedingAttention = db.prepare(`
    SELECT id, COALESCE(name, id) AS name, child_count AS childCount
    FROM groups
    WHERE child_count > 0 AND child_count < ?
    ORDER BY name COLLATE NOCASE
  `).all(MIN_GROUP_SIZE);

  return {
    mode: eventStarted ? 'compact' : 'rebuild',
    removedRouteStopCount,
    removedGroupIds,
    groupsNeedingAttention,
    changedGroups: changedGroupIds.map((groupId) => loadGroupDetails(db, groupId)).filter(Boolean),
  };
}

module.exports = { removeFamilyAndRepair };
