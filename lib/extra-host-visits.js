const { buildRoutes } = require('./grouping-routing');

function loadExtraHostVisits(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='extra_host_visits'").get()) return [];
  return db.prepare('SELECT group_id AS groupId,family_id AS familyId FROM extra_host_visits').all();
}

function rebuildStoredRoutes(db, { preserveStops = false } = {}) {
  return db.transaction(() => {
    const groups = db.prepare('SELECT id FROM groups ORDER BY id').all().map((g) => ({
      ...g, memberFamilyIds: db.prepare('SELECT family_id FROM group_members WHERE group_id=? ORDER BY family_id').all(g.id).map((m) => m.family_id),
    }));
    const families = db.prepare('SELECT * FROM families').all().map((f) => ({
      id: f.id, tower: f.tower, floor: f.floor, apartmentCode: f.apartment_code,
      children: db.prepare('SELECT age FROM children WHERE family_id=?').all(f.id),
      cancelled: !!f.cancelled, hosting: !!f.hosting, quest: !!f.quest, questDurationMin: f.quest_duration_min,
    }));
    const special = db.prepare('SELECT * FROM special_points').all().map((sp) => ({
      id: sp.id, tower: sp.tower, floor: sp.floor, name: sp.name, active: !!sp.active, quest: !!sp.quest, questDurationMin: sp.quest_duration_min,
    }));
    const fixed = preserveStops ? new Map(groups.map((g) => [g.id, db.prepare('SELECT host_type,host_id FROM route_stops WHERE group_id=? ORDER BY seq').all(g.id).map((s) => `${s.host_type}:${s.host_id}`)])) : null;
    const routes = buildRoutes(groups, families, special, loadExtraHostVisits(db), fixed);
    db.prepare('DELETE FROM route_stops').run();
    const insert = db.prepare(`INSERT INTO route_stops
      (group_id,host_id,host_type,seq,tower,floor,apartment_code,display_name,is_quest,arrival_min,departure_min)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const update = db.prepare('UPDATE groups SET total_min=? WHERE id=?');
    for (const route of routes) {
      update.run(route.totalMin, route.groupId);
      for (const stop of route.stops) insert.run(route.groupId,stop.hostId,stop.hostType,stop.seq,stop.tower,stop.floor,stop.apartmentCode,stop.displayName,stop.isQuest?1:0,stop.arrival,stop.departure);
    }
    return routes;
  })();
}
module.exports = { loadExtraHostVisits, rebuildStoredRoutes };
