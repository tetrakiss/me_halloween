const { db } = require('../db');
const { buildSchedule } = require('./route-schedule');
const { getEventSettings, formatServerLocal } = require('./event-settings');

// Only route data is selected here: no family codes, accounts or child names.
function readStoredSchedule() {
  return db.transaction(() => {
    const settings = getEventSettings();
    const stops = db.prepare(`SELECT host_id AS hostId, host_type AS hostType,
      tower, floor, apartment_code AS apartmentCode, display_name AS displayName,
      is_quest AS isQuest FROM route_stops WHERE group_id = ? ORDER BY seq`);
    const groups = db.prepare('SELECT id, name, start_location FROM groups ORDER BY id').all()
      .map((group) => ({ ...group, stops: stops.all(group.id).map((stop) => ({ ...stop, isQuest: !!stop.isQuest })) }));
    const result = buildSchedule(groups, settings.eventStartAt);
    const local = (at) => at === null ? null : formatServerLocal(at).replace('T', ' ');
    return { ...result, eventStartLocal: local(result.eventStartAt),
      generatedAt: formatServerLocal().replace('T', ' '),
      groups: result.groups.map((group) => ({ ...group, gatheringLocal: local(group.gatheringAt),
        departureLocal: local(group.departureAt), endLocal: local(group.endAt),
        stops: group.stops.map(({ hostId, ...stop }) => ({ ...stop,
          arrivalLocal: local(stop.arrivalAt), departureLocal: local(stop.departureAt) })) })),
      conflicts: result.conflicts.map(({ hostId, ...conflict }) => ({ ...conflict,
        fromLocal: local(conflict.fromAt), toLocal: local(conflict.toAt) })) };
  })();
}

module.exports = { readStoredSchedule };
