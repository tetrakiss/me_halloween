/**
 * Чистые функции группировки/маршрутизации — без привязки к БД.
 * db.js вызывает их, передавая массивы, и сохраняет результат обратно.
 */

const REGULAR_VISIT_MIN = 7;
const DEFAULT_QUEST_VISIT_MIN = 20;
const TRANSFER_MIN = 5;
const TOTAL_BUDGET_MIN = 100;
const QUEST_SLOT_BUFFER_MIN = 5;
const MIN_GROUP_SIZE = 5;
const MAX_GROUP_SIZE = 8;

function parseApartmentCode(code) {
  const m = /^(\d+?)(\d{2})([A-Za-zА-Яа-яЁё]?)$/.exec(String(code).trim());
  if (!m) return null;
  return { floor: Number(m[1]), unit: Number(m[2]), suffix: m[3] || null };
}

function findFamily(families, tower, apartmentCode) {
  return families.find((f) => f.tower === tower && f.apartmentCode === apartmentCode);
}

class UnionFind {
  constructor(ids) {
    this.parent = new Map(ids.map((id) => [id, id]));
  }
  find(x) {
    if (this.parent.get(x) !== x) this.parent.set(x, this.find(this.parent.get(x)));
    return this.parent.get(x);
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function buildGroups(families, wishLinks) {
  const allWalkers = families.filter((f) => !f.cancelled && f.walking);

  const manual = allWalkers.filter((f) => f.manualGroupId);
  const manualGroups = new Map();
  for (const f of manual) {
    if (!manualGroups.has(f.manualGroupId)) {
      manualGroups.set(f.manualGroupId, { familyIds: [], childCount: 0, ages: [] });
    }
    const g = manualGroups.get(f.manualGroupId);
    g.familyIds.push(f.id);
    g.childCount += f.children.length;
    f.children.forEach((ch) => g.ages.push(ch.age));
  }

  const walkers = allWalkers.filter((f) => !f.manualGroupId);
  const uf = new UnionFind(walkers.map((f) => f.id));
  for (const { a, b } of wishLinks) {
    if (uf.parent.has(a) && uf.parent.has(b)) uf.union(a, b);
  }

  const clusters = new Map();
  for (const f of walkers) {
    const root = uf.find(f.id);
    if (!clusters.has(root)) clusters.set(root, { familyIds: [], childCount: 0, ages: [] });
    const c = clusters.get(root);
    c.familyIds.push(f.id);
    c.childCount += f.children.length;
    f.children.forEach((ch) => c.ages.push(ch.age));
  }

  let clusterList = [...clusters.values()].map((c) => ({
    ...c,
    avgAge: c.ages.length ? c.ages.reduce((s, a) => s + a, 0) / c.ages.length : 0,
  }));

  const split = [];
  for (const c of clusterList) {
    if (c.childCount <= MAX_GROUP_SIZE) {
      split.push(c);
      continue;
    }
    let bucket = { familyIds: [], childCount: 0, ages: [] };
    for (const fid of c.familyIds) {
      const fam = walkers.find((f) => f.id === fid);
      if (bucket.childCount + fam.children.length > MAX_GROUP_SIZE && bucket.familyIds.length) {
        split.push({ ...bucket, avgAge: bucket.ages.reduce((s, a) => s + a, 0) / bucket.ages.length });
        bucket = { familyIds: [], childCount: 0, ages: [] };
      }
      bucket.familyIds.push(fid);
      bucket.childCount += fam.children.length;
      fam.children.forEach((ch) => bucket.ages.push(ch.age));
    }
    if (bucket.familyIds.length) {
      split.push({ ...bucket, avgAge: bucket.ages.reduce((s, a) => s + a, 0) / bucket.ages.length });
    }
  }
  clusterList = split;

  clusterList.sort((a, b) => a.avgAge - b.avgAge);
  const merged = [];
  let pending = null;
  for (const c of clusterList) {
    if (!pending) {
      pending = { ...c };
      continue;
    }
    if (pending.childCount < MIN_GROUP_SIZE && pending.childCount + c.childCount <= MAX_GROUP_SIZE) {
      pending.familyIds = pending.familyIds.concat(c.familyIds);
      pending.childCount += c.childCount;
      pending.ages = pending.ages.concat(c.ages);
      pending.avgAge = pending.ages.reduce((s, a) => s + a, 0) / pending.ages.length;
    } else {
      merged.push(pending);
      pending = { ...c };
    }
  }
  if (pending) merged.push(pending);

  const autoGroups = merged.map((c, i) => ({
    id: `group_${i + 1}`,
    memberFamilyIds: c.familyIds,
    childCount: c.childCount,
    avgAge: c.ages.length ? Math.round(c.avgAge * 10) / 10 : null,
    isManual: false,
  }));

  const manualGroupsOut = [...manualGroups.entries()].map(([groupId, g]) => ({
    id: groupId,
    memberFamilyIds: g.familyIds,
    childCount: g.childCount,
    avgAge: g.ages.length ? Math.round((g.ages.reduce((s, a) => s + a, 0) / g.ages.length) * 10) / 10 : null,
    isManual: true,
  }));

  return [...manualGroupsOut, ...autoGroups];
}

function buildRoutes(groups, families, specialPoints = []) {
  const hostsByTower = new Map();

  for (const f of families) {
    if (f.cancelled || !f.hosting) continue;
    if (!hostsByTower.has(f.tower)) hostsByTower.set(f.tower, []);
    hostsByTower.get(f.tower).push({
      id: f.id,
      tower: f.tower,
      floor: f.floor,
      apartmentCode: f.apartmentCode,
      displayName: null,
      isSpecial: false,
      quest: f.quest,
      questDurationMin: f.questDurationMin,
    });
  }

  for (const sp of specialPoints) {
    if (sp.active === false) continue;
    if (!hostsByTower.has(sp.tower)) hostsByTower.set(sp.tower, []);
    hostsByTower.get(sp.tower).push({
      id: sp.id,
      tower: sp.tower,
      floor: sp.floor,
      apartmentCode: null,
      displayName: sp.name,
      isSpecial: true,
      quest: !!sp.quest,
      questDurationMin: sp.questDurationMin,
    });
  }

  for (const list of hostsByTower.values()) list.sort((a, b) => a.floor - b.floor);

  const towerLoad = new Map([...hostsByTower.keys()].map((t) => [t, 0]));

  const draftRoutes = groups.map((g) => {
    const memberFamilies = g.memberFamilyIds.map((id) => families.find((f) => f.id === id)).filter(Boolean);
    const towerCounts = {};
    memberFamilies.forEach((f) => (towerCounts[f.tower] = (towerCounts[f.tower] || 0) + 1));
    const sortedTowers = Object.entries(towerCounts).sort((a, b) => b[1] - a[1]);
    const homeTower = sortedTowers[0]?.[0] ?? [...towerLoad.keys()][0];

    // Свои же квартиры участники группы не посещают, но спецточки (рестораны/
    // магазины) не привязаны к семьям, поэтому фильтр "не заходим сами к себе"
    // на них не действует.
    const stops = (hostsByTower.get(homeTower) || []).filter(
      (h) => h.isSpecial || !g.memberFamilyIds.includes(h.id)
    );
    towerLoad.set(homeTower, (towerLoad.get(homeTower) || 0) + stops.length);

    let t = 0;
    const timedStops = stops.map((h, idx) => {
      if (idx > 0) t += TRANSFER_MIN;
      const arrival = t;
      const dur = h.quest ? h.questDurationMin || DEFAULT_QUEST_VISIT_MIN : REGULAR_VISIT_MIN;
      t += dur;
      return {
        hostId: h.id,
        hostType: h.isSpecial ? 'special' : 'family',
        tower: h.tower,
        floor: h.floor,
        apartmentCode: h.apartmentCode,
        displayName: h.displayName,
        isQuest: !!h.quest,
        draftArrival: arrival,
        draftDeparture: t,
        durationMin: dur,
      };
    });

    return { groupId: g.id, homeTower, stops: timedStops };
  });

  const questSlots = new Map();
  for (const route of draftRoutes) {
    for (const stop of route.stops) {
      if (!stop.isQuest) continue;
      if (!questSlots.has(stop.hostId)) questSlots.set(stop.hostId, []);
    }
  }
  for (const [hostId, slots] of questSlots) {
    const requests = [];
    for (const route of draftRoutes) {
      const stop = route.stops.find((s) => s.hostId === hostId);
      if (stop) requests.push({ groupId: route.groupId, wanted: stop.draftArrival, dur: stop.durationMin });
    }
    requests.sort((a, b) => a.wanted - b.wanted);
    let nextFree = 0;
    for (const r of requests) {
      const start = Math.max(r.wanted, nextFree);
      const end = start + r.dur;
      slots.push({ start, end, groupId: r.groupId });
      nextFree = end + QUEST_SLOT_BUFFER_MIN;
    }
  }

  const finalRoutes = draftRoutes.map((route) => {
    let shift = 0;
    const finalStops = route.stops.map((stop, idx) => {
      let arrival = stop.draftArrival + shift;
      let departure = stop.draftDeparture + shift;
      if (stop.isQuest) {
        const mySlot = questSlots.get(stop.hostId).find((s) => s.groupId === route.groupId);
        if (mySlot.start > arrival) {
          shift += mySlot.start - arrival;
          arrival = mySlot.start;
          departure = mySlot.end;
        }
      }
      return { ...stop, seq: idx + 1, arrival, departure };
    });

    let total = finalStops.length ? finalStops[finalStops.length - 1].departure : 0;
    let trimmed = finalStops;
    while (total > TOTAL_BUDGET_MIN && trimmed.length) {
      const idx = [...trimmed].reverse().findIndex((s) => !s.isQuest);
      if (idx === -1) break;
      const realIdx = trimmed.length - 1 - idx;
      trimmed = trimmed.slice(0, realIdx).concat(trimmed.slice(realIdx + 1));
      total = trimmed.length ? trimmed[trimmed.length - 1].departure : 0;
    }
    trimmed = trimmed.map((s, i) => ({ ...s, seq: i + 1 }));

    return { groupId: route.groupId, homeTower: route.homeTower, totalMin: total, stops: trimmed };
  });

  return finalRoutes;
}

module.exports = {
  buildGroups,
  buildRoutes,
  parseApartmentCode,
  findFamily,
  REGULAR_VISIT_MIN,
  DEFAULT_QUEST_VISIT_MIN,
};
