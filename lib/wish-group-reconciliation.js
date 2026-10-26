const { loadExtraHostVisits } = require('./extra-host-visits');
const { fillExistingGroups, buildRoutes } = require('./grouping-routing');
const { assignGroupNames } = require('./group-names');

function reconcileFamilyWish(db, familyId, wishedFamilyId) {
  if (!wishedFamilyId) return null;
  return db.transaction(() => {
    const stored = db.prepare('SELECT * FROM groups ORDER BY id').all();
    if (!stored.length) return null;
    const families = db.prepare('SELECT * FROM families').all().map((f) => ({
      id: f.id, tower: f.tower, floor: f.floor, apartmentCode: f.apartment_code,
      children: db.prepare('SELECT name,age FROM children WHERE family_id=?').all(f.id),
      walking: !!f.walking, cancelled: !!f.cancelled, groupingPaused: !!f.grouping_paused,
      candyBrought: !!f.candy_brought, hosting: !!f.hosting, quest: !!f.quest,
      questDurationMin: f.quest_duration_min, manualGroupId: f.manual_group_id,
    }));
    const wishes = db.prepare('SELECT family_a AS a,family_b AS b FROM wish_links').all();
    const chain = new Set([familyId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const { a, b } of wishes) {
        if (chain.has(a) && !chain.has(b)) { chain.add(b); changed = true; }
        if (chain.has(b) && !chain.has(a)) { chain.add(a); changed = true; }
      }
    }
    const groups = stored.map((g) => ({ ...g, memberFamilyIds: db.prepare('SELECT family_id FROM group_members WHERE group_id=? ORDER BY family_id').all(g.id).map((m) => m.family_id) }));
    const preferredGroupId = groups.find((g) => g.memberFamilyIds.includes(wishedFamilyId))?.id;
    const result = fillExistingGroups(groups, families, wishes, () => 0, { onlyFamilyIds: [...chain], preferredGroupId });
    if (!result.assignments.length) return null;
    assignGroupNames(result.groups, db.prepare('SELECT * FROM group_name_catalog').all(), new Map(stored.map((g) => [g.id, g])));
    const createGroup = db.prepare('INSERT INTO groups(id,name,avg_age,child_count,is_manual) VALUES (?,?,?,?,0)');
    for (const id of result.createdGroupIds) {
      const g = result.groups.find((g) => g.id === id);
      createGroup.run(id, g.name, g.avgAge, g.childCount);
    }
    const removeMember = db.prepare('DELETE FROM group_members WHERE family_id=?');
    const addMember = db.prepare('INSERT INTO group_members(group_id,family_id) VALUES (?,?)');
    const activate = db.prepare('UPDATE families SET grouping_paused=0,manual_group_id=NULL WHERE id=?');
    for (const assignment of result.assignments) {
      removeMember.run(assignment.familyId);
      addMember.run(assignment.groupId, assignment.familyId);
      activate.run(assignment.familyId);
    }
    const remainingGroups = result.groups.filter((g) => g.memberFamilyIds.length);
    for (const g of result.groups.filter((g) => !g.memberFamilyIds.length)) db.prepare('DELETE FROM groups WHERE id=?').run(g.id);
    const specialPoints = db.prepare('SELECT * FROM special_points').all().map((sp) => ({
      id: sp.id, name: sp.name, tower: sp.tower, floor: sp.floor, active: !!sp.active,
      quest: !!sp.quest, questDurationMin: sp.quest_duration_min,
    }));
    const routes = buildRoutes(remainingGroups, families, specialPoints, loadExtraHostVisits(db));
    db.prepare('DELETE FROM route_stops').run();
    const insertStop = db.prepare(`INSERT INTO route_stops
      (group_id,host_id,host_type,seq,tower,floor,apartment_code,display_name,is_quest,arrival_min,departure_min)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const stats = db.prepare('UPDATE groups SET avg_age=?,child_count=?,total_min=? WHERE id=?');
    for (const route of routes) {
      const group = remainingGroups.find((g) => g.id === route.groupId);
      stats.run(group.avgAge, group.childCount, route.totalMin, group.id);
      for (const stop of route.stops) insertStop.run(group.id, stop.hostId, stop.hostType, stop.seq,
        stop.tower, stop.floor, stop.apartmentCode, stop.displayName, stop.isQuest ? 1 : 0, stop.arrival, stop.departure);
    }
    const movedIds = new Set(result.assignments.map((assignment) => assignment.familyId));
    return {
      movedFamilyCount: result.assignments.length,
      createdGroupCount: result.createdGroupIds.length,
      changedGroups: remainingGroups.map((g) => ({
        ...g, memberFamilyIds: g.memberFamilyIds.filter((id) => movedIds.has(id)), startLocation: db.prepare('SELECT start_location FROM groups WHERE id=?').get(g.id).start_location,
        stops: routes.find((r) => r.groupId === g.id)?.stops || [],
      })),
    };
  })();
}

module.exports = { reconcileFamilyWish };
