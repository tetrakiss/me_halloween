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
const TARGET_ROUTE_STOPS = 8;
const MAX_ROUTE_STOPS = 10;

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

function summarizeFamilies(familyIds, familyById) {
  const ages = [];
  const towerCounts = new Map();
  for (const familyId of familyIds) {
    const family = familyById.get(familyId);
    if (!family) continue;
    for (const child of family.children) ages.push(Number(child.age));
    towerCounts.set(family.tower, (towerCounts.get(family.tower) || 0) + family.children.length);
  }
  const childCount = ages.length;
  const avgAge = childCount ? ages.reduce((sum, age) => sum + age, 0) / childCount : 0;
  const dominantTower = [...towerCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
  return {
    familyIds,
    ages,
    childCount,
    avgAge,
    minAge: childCount ? Math.min(...ages) : 0,
    maxAge: childCount ? Math.max(...ages) : 0,
    towerCounts,
    dominantTower,
  };
}

function groupSegmentCost(components, familyById) {
  const summary = summarizeFamilies(components.flatMap((component) => component.familyIds), familyById);
  const underSize = Math.max(0, MIN_GROUP_SIZE - summary.childCount);
  const overSize = Math.max(0, summary.childCount - MAX_GROUP_SIZE);
  const ageSpan = summary.maxAge - summary.minAge;
  const ageOverflow = Math.max(0, ageSpan - 8); // весь диапазон помещается в возраст ±4 года
  const dominantTowerCount = Math.max(0, ...summary.towerCounts.values());
  const otherTowerChildren = summary.childCount - dominantTowerCount;

  // Размер 5–8 — почти жёсткое ограничение. Переполнение дороже неполной
  // последней группы, потому что связку «хотим вместе» делить нельзя.
  return overSize * overSize * 1_000_000_000
    + underSize * underSize * 10_000_000
    + ageOverflow * ageOverflow * 1_000_000
    + ageSpan * ageSpan * 1_000
    + otherTowerChildren * 100
    + Math.abs(summary.childCount - 6.5) * 10;
}

function partitionComponents(components, familyById) {
  if (!components.length) return [];
  const ordered = [...components].sort((a, b) => (
    a.avgAge - b.avgAge
    || a.dominantTower.localeCompare(b.dominantTower)
    || b.childCount - a.childCount
    || a.familyIds[0].localeCompare(b.familyIds[0])
  ));
  const dp = Array(ordered.length + 1).fill(Number.POSITIVE_INFINITY);
  const previous = Array(ordered.length + 1).fill(-1);
  dp[0] = 0;

  for (let end = 1; end <= ordered.length; end += 1) {
    for (let start = end - 1; start >= 0; start -= 1) {
      const cost = dp[start] + groupSegmentCost(ordered.slice(start, end), familyById);
      if (cost < dp[end]) {
        dp[end] = cost;
        previous[end] = start;
      }
    }
  }

  const partitions = [];
  for (let end = ordered.length; end > 0;) {
    const start = previous[end];
    partitions.unshift(ordered.slice(start, end));
    end = start;
  }
  return partitions;
}

function buildGroups(families, wishLinks) {
  const allWalkers = families.filter((f) => !f.cancelled && f.walking);
  const familyById = new Map(allWalkers.map((family) => [family.id, family]));

  const manual = allWalkers.filter((f) => f.manualGroupId);
  const manualGroups = new Map();
  for (const f of manual) {
    if (!manualGroups.has(f.manualGroupId)) manualGroups.set(f.manualGroupId, []);
    manualGroups.get(f.manualGroupId).push(f.id);
  }

  const walkers = allWalkers.filter((f) => !f.manualGroupId);
  const uf = new UnionFind(walkers.map((f) => f.id));
  for (const { a, b } of wishLinks) {
    if (uf.parent.has(a) && uf.parent.has(b)) uf.union(a, b);
  }

  const clusters = new Map();
  for (const f of walkers) {
    const root = uf.find(f.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(f.id);
  }

  // Связанные пожеланиями семьи становятся неделимыми компонентами. Затем
  // динамическое разбиение сначала минимизирует разницу возрастов, а при
  // равных вариантах предпочитает одну башню и ровный размер группы.
  const components = [...clusters.values()].map((familyIds) => summarizeFamilies(familyIds, familyById));
  const partitions = partitionComponents(components, familyById);
  const autoGroups = partitions.map((partition, i) => {
    const summary = summarizeFamilies(partition.flatMap((component) => component.familyIds), familyById);
    return {
      id: `group_${i + 1}`,
      memberFamilyIds: summary.familyIds,
      childCount: summary.childCount,
      avgAge: summary.ages.length ? Math.round(summary.avgAge * 10) / 10 : null,
      isManual: false,
    };
  });

  const manualGroupsOut = [...manualGroups.entries()].map(([groupId, familyIds]) => {
    const summary = summarizeFamilies(familyIds, familyById);
    return {
      id: groupId,
      memberFamilyIds: familyIds,
      childCount: summary.childCount,
      avgAge: summary.ages.length ? Math.round(summary.avgAge * 10) / 10 : null,
      isManual: true,
    };
  });

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

  const towerLoad = new Map([...hostsByTower.keys()].map((tower) => [tower, 0]));
  const hostLoad = new Map();

  const draftRoutes = groups.map((g) => {
    const memberFamilies = g.memberFamilyIds.map((id) => families.find((f) => f.id === id)).filter(Boolean);
    const memberTowerCounts = new Map();
    memberFamilies.forEach((family) => memberTowerCounts.set(family.tower, (memberTowerCounts.get(family.tower) || 0) + family.children.length));
    const selectedIds = new Set();
    const stops = [];
    let lastTower = null;

    const eligibleByTower = new Map([...hostsByTower.entries()].map(([tower, hosts]) => [
      tower,
      hosts.filter((host) => host.isSpecial || !g.memberFamilyIds.includes(host.id)),
    ]));
    const eligibleCount = [...eligibleByTower.values()].reduce((sum, hosts) => sum + hosts.length, 0);
    const targetStopCount = Math.min(TARGET_ROUTE_STOPS, MAX_ROUTE_STOPS, eligibleCount);

    // Маршрут набирается блоками по 2–3 адреса. При наличии выбора следующий
    // блок берётся из другой башни; счётчики распределяют нагрузку между
    // башнями и принимающими квартирами разных групп.
    while (stops.length < targetStopCount) {
      const remaining = targetStopCount - stops.length;
      const desiredBlockSize = remaining === 4 ? 2 : Math.min(3, remaining);
      const candidates = [...eligibleByTower.entries()]
        .map(([tower, hosts]) => ({ tower, hosts: hosts.filter((host) => !selectedIds.has(host.id)) }))
        .filter((candidate) => candidate.hosts.length > 0);
      if (!candidates.length) break;
      const hasAlternativeTower = candidates.some((candidate) => candidate.tower !== lastTower);
      candidates.sort((a, b) => {
        const score = (candidate) => (
          (hasAlternativeTower && candidate.tower === lastTower ? 1_000_000 : 0)
          + (candidate.hosts.length < Math.min(2, remaining) ? 100_000 : 0)
          + (towerLoad.get(candidate.tower) || 0) * 1_000
          - (memberTowerCounts.get(candidate.tower) || 0) * 100
          - Math.min(candidate.hosts.length, desiredBlockSize) * 10
        );
        return score(a) - score(b) || a.tower.localeCompare(b.tower);
      });

      const chosen = candidates[0];
      const blockSize = Math.min(desiredBlockSize, chosen.hosts.length, remaining);
      const block = [...chosen.hosts]
        .sort((a, b) => (hostLoad.get(a.id) || 0) - (hostLoad.get(b.id) || 0) || a.floor - b.floor || String(a.apartmentCode || '').localeCompare(String(b.apartmentCode || '')))
        .slice(0, blockSize)
        .sort((a, b) => a.floor - b.floor || String(a.apartmentCode || '').localeCompare(String(b.apartmentCode || '')));
      for (const host of block) {
        selectedIds.add(host.id);
        hostLoad.set(host.id, (hostLoad.get(host.id) || 0) + 1);
        stops.push(host);
      }
      towerLoad.set(chosen.tower, (towerLoad.get(chosen.tower) || 0) + block.length);
      lastTower = chosen.tower;
    }

    const homeTower = stops[0]?.tower || [...memberTowerCounts.keys()][0] || [...towerLoad.keys()][0];

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
  MIN_GROUP_SIZE,
  MAX_GROUP_SIZE,
  TARGET_ROUTE_STOPS,
  MAX_ROUTE_STOPS,
};
