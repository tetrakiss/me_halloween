const TOWERS = ['Венеция', 'Санкт-Петербург', 'Стокгольм', 'Вена', 'Амстердам', 'Копенгаген', 'Флоренция', 'Барселона', 'Екатеринбург', 'Великий Новгород', 'Владивосток', 'Гонконг', 'Сингапур', 'Стамбул', 'Афины'];
const TIMING = Object.freeze({ gathering: 10, quest: 15, candy: 5, insideTower: 5, betweenTowers: 12 });

function startTowerFor(group) {
  const location = String(group.startLocation ?? group.start_location ?? '');
  return TOWERS.find((tower) => location.includes(tower)) || 'Вена';
}

function parkingLocation(tower) {
  return `${tower}, парковка -2 этаж`;
}

function displayStartLocation(group) {
  const location = String(group.startLocation ?? group.start_location ?? '');
  return !location || TOWERS.some((tower) => location.includes(tower))
    ? parkingLocation(startTowerFor(group)) : location;
}

function buildSchedule(groups, eventStartAt) {
  const hasStart = Number.isFinite(eventStartAt);
  const timestamp = (minutes) => hasStart ? eventStartAt + minutes * 60000 : null;
  const visits = new Map();
  const scheduled = groups.map((group) => {
    const startTower = startTowerFor(group);
    let tower = startTower;
    let minutes = TIMING.gathering;
    const stops = group.stops.map((stop, index) => {
      const travelMin = stop.tower === tower ? TIMING.insideTower : TIMING.betweenTowers;
      const waitMin = Math.max(0, Number(stop.waitMin) || 0);
      const arrivalMin = minutes + travelMin + waitMin;
      const departureMin = arrivalMin + (stop.isQuest ? TIMING.quest : TIMING.candy);
      minutes = departureMin;
      tower = stop.tower;
      const result = { ...stop, seq: index + 1, travelMin, waitMin, arrivalMin, departureMin,
        arrivalAt: timestamp(arrivalMin), departureAt: timestamp(departureMin), conflicts: [] };
      const key = `${stop.hostType}:${stop.hostId}`;
      if (!visits.has(key)) visits.set(key, []);
      visits.get(key).push({ group, stop: result });
      return result;
    });
    return { id: group.id, name: group.name || group.id, startTower,
      startLocation: displayStartLocation(group), gatheringAt: timestamp(0), departureAt: timestamp(TIMING.gathering),
      endAt: timestamp(minutes), totalMin: minutes, waitingMin: stops.reduce((sum, stop) => sum + stop.waitMin, 0), stops };
  });
  const conflicts = [];
  for (const entries of visits.values()) {
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const a = entries[i]; const b = entries[j];
        if (a.group.id === b.group.id) continue;
        const from = Math.max(a.stop.arrivalMin, b.stop.arrivalMin);
        const to = Math.min(a.stop.departureMin, b.stop.departureMin);
        if (from >= to) continue;
        a.stop.conflicts.push({ groupId: b.group.id, groupName: b.group.name || b.group.id });
        b.stop.conflicts.push({ groupId: a.group.id, groupName: a.group.name || a.group.id });
        conflicts.push({ groupIds: [a.group.id, b.group.id], groupNames: [a.group.name || a.group.id, b.group.name || b.group.id],
          hostId: a.stop.hostId, hostType: a.stop.hostType, tower: a.stop.tower,
          apartmentCode: a.stop.apartmentCode, displayName: a.stop.displayName,
          fromAt: timestamp(from), toAt: timestamp(to) });
      }
    }
  }
  return { timing: TIMING, eventStartAt: hasStart ? eventStartAt : null, groups: scheduled, conflicts };
}

module.exports = { TOWERS, TIMING, startTowerFor, parkingLocation, displayStartLocation, buildSchedule };
