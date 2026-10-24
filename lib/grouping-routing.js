/**
 * Чистые функции группировки/маршрутизации — без привязки к БД.
 * db.js вызывает их, передавая массивы, и сохраняет результат обратно.
 */

const REGULAR_VISIT_MIN = 7;
const DEFAULT_QUEST_VISIT_MIN = 20;
const TRANSFER_MIN = 5;
const QUEST_SLOT_BUFFER_MIN = 5;
const MIN_GROUP_SIZE = 5;
const MAX_GROUP_SIZE = 6;
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

  // Prefer groups of five or six; wish components remain indivisible.
  return overSize * overSize * 1_000_000_000_000_000
    + underSize * underSize * 10_000_000_000_000
    + ageOverflow * ageOverflow * 100_000_000_000
    + ageSpan * ageSpan * 100_000_000
    + otherTowerChildren * 1_000_000;
}

function partitionComponents(components, familyById) {
  if (!components.length) return [];
  const ordered = [...components].sort((a, b) => (
    a.avgAge - b.avgAge
    || a.dominantTower.localeCompare(b.dominantTower)
    || b.childCount - a.childCount
    || a.familyIds[0].localeCompare(b.familyIds[0])
  ));
  const dp = Array(ordered.length + 1).fill(Infinity);
  const previous = Array(ordered.length + 1).fill(-1);
  dp[0] = 0;
  for (let end = 1; end <= ordered.length; end += 1) {
    for (let start = 0; start < end; start += 1) {
      const segment = ordered.slice(start, end);
      const count = segment.reduce((sum, component) => sum + component.childCount, 0);
      // Only an indivisible family / wish component may exceed the limit.
      if (count > MAX_GROUP_SIZE && segment.length > 1) continue;
      const cost = dp[start] + groupSegmentCost(segment, familyById) + 100_000;
      if (cost < dp[end]) { dp[end] = cost; previous[end] = start; }
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

function isFamilyEligibleForGrouping(family) {
  return !!(family.hosting || family.quest || family.candyBrought);
}

function buildGroups(families, wishLinks) {
  const allWalkers = families.filter((f) => !f.cancelled && f.walking && !f.groupingPaused && isFamilyEligibleForGrouping(f));
  const familyById = new Map(allWalkers.map((family) => [family.id, family]));

  const uf = new UnionFind(allWalkers.map((family) => family.id));
  for (const { a, b } of wishLinks) {
    if (uf.parent.has(a) && uf.parent.has(b)) uf.union(a, b);
  }
  const clusters = new Map();
  for (const family of allWalkers) {
    const root = uf.find(family.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(family.id);
  }
  // Manual assignments remain preferences, but cannot bypass the size limit.
  const buckets = new Map();
  for (const ids of clusters.values()) {
    const manualId = ids.map((id) => familyById.get(id).manualGroupId).find(Boolean) || null;
    if (!buckets.has(manualId)) buckets.set(manualId, []);
    buckets.get(manualId).push(summarizeFamilies(ids, familyById));
  }
  const usedIds = new Set([...buckets.keys()].filter(Boolean));
  let nextId = 1;
  const autoId = () => {
    while (usedIds.has(`group_${nextId}`)) nextId += 1;
    const id = `group_${nextId++}`;
    usedIds.add(id);
    return id;
  };
  const groups = [];
  for (const [manualId, components] of buckets) {
    partitionComponents(components, familyById).forEach((partition, index) => {
      const summary = summarizeFamilies(partition.flatMap((component) => component.familyIds), familyById);
      groups.push({
        id: manualId && index === 0 ? manualId : autoId(),
        memberFamilyIds: summary.familyIds,
        childCount: summary.childCount,
        avgAge: summary.ages.length ? Math.round(summary.avgAge * 10) / 10 : null,
        isManual: !!manualId,
      });
    });
  }
  return groups;
}

/**
 * Добавляет семьи без группы в текущий набор групп. Если после заполнения
 * нет места, создаёт новые группы без переполнения существующих. Связанные пожеланиями семьи остаются
 * неделимой компонентой, а случайная семья задаёт начало очередного запуска.
 */
function fillExistingGroups(groups, families, wishLinks, random = Math.random) {
  const familyById = new Map(families.map((family) => [family.id, family]));
  const updatedGroups = groups.map((group) => ({
    ...group,
    memberFamilyIds: [...group.memberFamilyIds],
  }));
  const assignedFamilyIds = new Set(updatedGroups.flatMap((group) => group.memberFamilyIds));
  const waitingFamilies = families.filter((family) => (
    family.walking && !family.cancelled && !assignedFamilyIds.has(family.id) && isFamilyEligibleForGrouping(family)
  ));

  if (!waitingFamilies.length || !updatedGroups.length) {
    return {
      groups: updatedGroups,
      assignments: [],
      unassignedFamilyIds: waitingFamilies.map((family) => family.id),
      starterFamilyId: null,
      createdGroupIds: [],
    };
  }

  const waitingById = new Map(waitingFamilies.map((family) => [family.id, family]));
  const uf = new UnionFind(waitingFamilies.map((family) => family.id));
  for (const { a, b } of wishLinks) {
    if (uf.parent.has(a) && uf.parent.has(b)) uf.union(a, b);
  }
  const clusterIds = new Map();
  for (const family of waitingFamilies) {
    const root = uf.find(family.id);
    if (!clusterIds.has(root)) clusterIds.set(root, []);
    clusterIds.get(root).push(family.id);
  }
  const components = [...clusterIds.values()].map((ids) => summarizeFamilies(ids, waitingById));
  const starterIndex = Math.min(
    waitingFamilies.length - 1,
    Math.max(0, Math.floor(Number(random()) * waitingFamilies.length))
  );
  const starterFamilyId = waitingFamilies[starterIndex].id;
  const starterRoot = uf.find(starterFamilyId);
  const starterComponent = components.find((component) => component.familyIds.includes(starterRoot)
    || component.familyIds.includes(starterFamilyId));
  const remainingComponents = components
    .filter((component) => component !== starterComponent)
    .sort((a, b) => (
      Math.abs(a.avgAge - starterComponent.avgAge) - Math.abs(b.avgAge - starterComponent.avgAge)
      || (a.dominantTower === starterComponent.dominantTower ? -1 : 0)
      || (b.dominantTower === starterComponent.dominantTower ? 1 : 0)
      || a.avgAge - b.avgAge
      || a.familyIds[0].localeCompare(b.familyIds[0])
    ));
  const orderedComponents = [starterComponent, ...remainingComponents];
  const wishNeighbors = new Map(waitingFamilies.map((family) => [family.id, new Set()]));
  for (const { a, b } of wishLinks) {
    if (wishNeighbors.has(a)) wishNeighbors.get(a).add(b);
    if (wishNeighbors.has(b)) wishNeighbors.get(b).add(a);
  }

  const assignments = [];
  const pendingComponents = [];
  const addComponent = (group, component) => {
    for (const familyId of component.familyIds) {
      group.memberFamilyIds.push(familyId);
      assignments.push({ familyId, groupId: group.id });
    }
  };
  const compatibilityScore = (group, component, balanceFirst = false) => {
    const current = summarizeFamilies(group.memberFamilyIds, familyById);
    const combined = summarizeFamilies([...group.memberFamilyIds, ...component.familyIds], familyById);
    const ageOverflow = Math.max(0, combined.maxAge - combined.minAge - 8);
    const averageAgeDistance = current.childCount ? Math.abs(current.avgAge - component.avgAge) : 0;
    const towerMismatch = current.towerCounts.has(component.dominantTower) ? 0 : 1;
    const balancePenalty = balanceFirst ? combined.childCount * 100_000_000_000 : 0;
    const remainingCapacity = Math.abs(MAX_GROUP_SIZE - combined.childCount);
    return balancePenalty
      + ageOverflow * 10_000_000_000
      + averageAgeDistance * 1_000_000
      + towerMismatch * 10_000
      + remainingCapacity;
  };

  for (const component of orderedComponents) {
    const desiredGroupIds = new Set();
    for (const familyId of component.familyIds) {
      for (const wishedFamilyId of wishNeighbors.get(familyId) || []) {
        const desired = updatedGroups.find((group) => group.memberFamilyIds.includes(wishedFamilyId));
        if (desired) desiredGroupIds.add(desired.id);
      }
    }
    let candidates = updatedGroups.filter((group) => {
      const current = summarizeFamilies(group.memberFamilyIds, familyById);
      const hasCapacity = current.childCount + component.childCount <= MAX_GROUP_SIZE;
      const respectsWish = !desiredGroupIds.size || desiredGroupIds.has(group.id);
      return hasCapacity && respectsWish;
    });
    // Пожелание ходить вместе выше ограничения размера: если нужная группа
    // уже полна, всё равно присоединяем семью именно к ней.
    if (!candidates.length && desiredGroupIds.size) {
      candidates = updatedGroups.filter((group) => desiredGroupIds.has(group.id));
    }
    if (!candidates.length) {
      pendingComponents.push(component);
      continue;
    }
    candidates.sort((a, b) => compatibilityScore(a, component) - compatibilityScore(b, component)
      || a.id.localeCompare(b.id));
    addComponent(candidates[0], component);
  }

  const createdGroupIds = [];
  const usedGroupIds = new Set(updatedGroups.map((group) => group.id));
  let nextGroupNumber = 1;
  const nextGroupId = () => {
    while (usedGroupIds.has(`group_${nextGroupNumber}`)) nextGroupNumber += 1;
    const id = `group_${nextGroupNumber}`;
    usedGroupIds.add(id);
    nextGroupNumber += 1;
    return id;
  };
  const pendingChildCount = () => pendingComponents.reduce((sum, component) => sum + component.childCount, 0);

  // Every remaining component gets a new group when existing groups are full.
  while (pendingChildCount() > 0) {
    const first = pendingComponents.shift();
    const group = { id: nextGroupId(), name: null, memberFamilyIds: [], isManual: false };
    updatedGroups.push(group);
    createdGroupIds.push(group.id);
    addComponent(group, first);

    while (pendingComponents.length) {
      const current = summarizeFamilies(group.memberFamilyIds, familyById);
      const fitting = pendingComponents
        .map((component, index) => ({ component, index }))
        .filter(({ component }) => current.childCount + component.childCount <= MAX_GROUP_SIZE)
        .sort((a, b) => compatibilityScore(group, a.component) - compatibilityScore(group, b.component));
      if (!fitting.length) break;
      const picked = fitting[0];
      pendingComponents.splice(picked.index, 1);
      addComponent(group, picked.component);
    }
  }

  const unassignedFamilyIds = pendingComponents.flatMap((component) => component.familyIds);

  for (const group of updatedGroups) {
    const summary = summarizeFamilies(group.memberFamilyIds, familyById);
    group.childCount = summary.childCount;
    group.avgAge = summary.childCount ? Math.round(summary.avgAge * 10) / 10 : null;
  }
  return { groups: updatedGroups, assignments, unassignedFamilyIds, starterFamilyId, createdGroupIds };
}

function spreadSameStopsAcrossStages(routes) {
  const usedByStage = [];
  const keyOf = (stop) => `${stop.hostType}:${stop.hostId}`;
  for (const route of routes) {
    const original = [...route.stops];
    const findOrder = (stage, remaining, ordered) => {
      if (!remaining.length) return ordered;
      const candidates = remaining
        .filter((stop) => !usedByStage[stage]?.has(keyOf(stop)))
        .sort((a, b) => (
          Math.abs(original.indexOf(a) - stage) - Math.abs(original.indexOf(b) - stage)
          || original.indexOf(a) - original.indexOf(b)
        ));
      for (const candidate of candidates) {
        const result = findOrder(
          stage + 1,
          remaining.filter((stop) => stop !== candidate),
          [...ordered, candidate]
        );
        if (result) return result;
      }
      return null;
    };

    let ordered = findOrder(0, original, []);
    if (!ordered) {
      // При математически невозможном полном разведении выбираем циклический
      // сдвиг с минимальным количеством совпадений.
      ordered = Array.from({ length: Math.max(1, original.length) }, (_, shift) => (
        original.map((_, index) => original[(index + shift) % original.length])
      )).sort((a, b) => {
        const collisions = (items) => items.reduce((sum, stop, index) => (
          sum + (usedByStage[index]?.has(keyOf(stop)) ? 1 : 0)
        ), 0);
        return collisions(a) - collisions(b);
      })[0] || [];
    }
    route.stops = ordered;
    let elapsed = 0;
    ordered.forEach((stop, index) => {
      if (index > 0) elapsed += TRANSFER_MIN;
      stop.draftArrival = elapsed;
      elapsed += stop.durationMin;
      stop.draftDeparture = elapsed;
    });
    ordered.forEach((stop, index) => {
      if (!usedByStage[index]) usedByStage[index] = new Set();
      usedByStage[index].add(keyOf(stop));
    });
  }
}

function buildRoutes(groups, families, specialPoints = []) {
  const hostsByTower = new Map();

  for (const f of families) {
    if (f.cancelled || (!f.hosting && !f.quest)) continue;
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

  const allHosts = [...hostsByTower.values()].flat();
  const totalQuestHosts = allHosts.filter((host) => host.quest).length;
  const totalCandyHosts = allHosts.length - totalQuestHosts;
  const towerLoad = new Map([...hostsByTower.keys()].map((tower) => [tower, 0]));
  const hostLoad = new Map();

  const draftRoutes = groups.map((g) => {
    const memberFamilies = g.memberFamilyIds.map((id) => families.find((f) => f.id === id)).filter(Boolean);
    const memberTowerCounts = new Map();
    memberFamilies.forEach((family) => memberTowerCounts.set(family.tower, (memberTowerCounts.get(family.tower) || 0) + family.children.length));
    const selectedIds = new Set();
    const stops = [];
    let lastTower = null;

    const externalHostCount = allHosts.filter((host) => (
      host.isSpecial || !g.memberFamilyIds.includes(host.id)
    )).length;
    const desiredStopCount = Math.min(TARGET_ROUTE_STOPS, MAX_ROUTE_STOPS, allHosts.length);
    // Пока внешних адресов хватает, группа не заходит к себе. Если без
    // квартир участников маршрут оказался бы коротким (или пустым), берём
    // их как резервные точки — это важно и для события из одной семьи.
    const includeMemberHosts = externalHostCount < desiredStopCount;
    const eligibleByTower = new Map([...hostsByTower.entries()].map(([tower, hosts]) => [
      tower,
      hosts.filter((host) => includeMemberHosts || host.isSpecial || !g.memberFamilyIds.includes(host.id)),
    ]));
    const eligibleCount = [...eligibleByTower.values()].reduce((sum, hosts) => sum + hosts.length, 0);
    const targetStopCount = Math.min(TARGET_ROUTE_STOPS, MAX_ROUTE_STOPS, eligibleCount);
    const eligibleHosts = [...eligibleByTower.values()].flat();
    const eligibleQuestCount = eligibleHosts.filter((host) => host.quest).length;
    const eligibleCandyCount = eligibleHosts.length - eligibleQuestCount;
    let questTarget = allHosts.length ? Math.round(targetStopCount * totalQuestHosts / allHosts.length) : 0;
    questTarget = Math.min(questTarget, eligibleQuestCount, targetStopCount);
    if (targetStopCount >= 2 && eligibleQuestCount > 0 && eligibleCandyCount > 0) {
      questTarget = Math.max(1, Math.min(questTarget, targetStopCount - 1));
    }
    let candyTarget = Math.min(targetStopCount - questTarget, eligibleCandyCount);
    questTarget = Math.min(targetStopCount - candyTarget, eligibleQuestCount);
    let unfilledTarget = targetStopCount - questTarget - candyTarget;
    if (unfilledTarget > 0) {
      const extraCandy = Math.min(unfilledTarget, eligibleCandyCount - candyTarget);
      candyTarget += extraCandy;
      unfilledTarget -= extraCandy;
      questTarget += Math.min(unfilledTarget, eligibleQuestCount - questTarget);
    }
    let selectedQuestCount = 0;
    let selectedCandyCount = 0;

    // Маршрут набирается блоками по 2–3 адреса. При наличии выбора следующий
    // блок берётся из другой башни; счётчики распределяют нагрузку между
    // башнями и принимающими квартирами разных групп.
    while (stops.length < targetStopCount) {
      const remaining = targetStopCount - stops.length;
      const desiredBlockSize = remaining === 4 ? 2 : Math.min(3, remaining);
      const questNeeded = Math.max(0, questTarget - selectedQuestCount);
      const candyNeeded = Math.max(0, candyTarget - selectedCandyCount);
      const preferQuest = questNeeded > 0 && (
        candyNeeded === 0
        || questNeeded / Math.max(1, questTarget) >= candyNeeded / Math.max(1, candyTarget)
      );
      const candidates = [...eligibleByTower.entries()]
        .map(([tower, hosts]) => ({ tower, hosts: hosts.filter((host) => !selectedIds.has(host.id)) }))
        .filter((candidate) => candidate.hosts.length > 0);
      if (!candidates.length) break;
      const hasAlternativeTower = candidates.some((candidate) => candidate.tower !== lastTower);
      candidates.sort((a, b) => {
        const score = (candidate) => (
          (hasAlternativeTower && candidate.tower === lastTower ? 1_000_000 : 0)
          + (candidate.hosts.length < Math.min(2, remaining) ? 100_000 : 0)
          + (preferQuest && !candidate.hosts.some((host) => host.quest) ? 50_000 : 0)
          + (!preferQuest && candyNeeded > 0 && !candidate.hosts.some((host) => !host.quest) ? 50_000 : 0)
          + (towerLoad.get(candidate.tower) || 0) * 1_000
          - (memberTowerCounts.get(candidate.tower) || 0) * 100
          - Math.min(candidate.hosts.length, desiredBlockSize) * 10
        );
        return score(a) - score(b) || a.tower.localeCompare(b.tower);
      });

      const chosen = candidates[0];
      const blockSize = Math.min(desiredBlockSize, chosen.hosts.length, remaining);
      const available = [...chosen.hosts];
      const block = [];
      const hostOrder = (a, b) => (hostLoad.get(a.id) || 0) - (hostLoad.get(b.id) || 0)
        || a.floor - b.floor
        || String(a.apartmentCode || '').localeCompare(String(b.apartmentCode || ''));
      while (block.length < blockSize && available.length) {
        const qNeeded = Math.max(0, questTarget - selectedQuestCount - block.filter((host) => host.quest).length);
        const cNeeded = Math.max(0, candyTarget - selectedCandyCount - block.filter((host) => !host.quest).length);
        const wantQuest = qNeeded > 0 && (
          cNeeded === 0
          || qNeeded / Math.max(1, questTarget) >= cNeeded / Math.max(1, candyTarget)
        );
        const preferred = available.filter((host) => !!host.quest === wantQuest).sort(hostOrder);
        const picked = (preferred[0] || available.sort(hostOrder)[0]);
        block.push(picked);
        available.splice(available.findIndex((host) => host.id === picked.id), 1);
      }
      block.sort((a, b) => a.floor - b.floor || String(a.apartmentCode || '').localeCompare(String(b.apartmentCode || '')));
      for (const host of block) {
        selectedIds.add(host.id);
        hostLoad.set(host.id, (hostLoad.get(host.id) || 0) + 1);
        if (host.quest) selectedQuestCount += 1;
        else selectedCandyCount += 1;
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

  // Одна принимающая квартира не должна оказаться одним и тем же этапом у
  // разных групп. Меняем только порядок уже выбранных остановок.
  spreadSameStopsAcrossStages(draftRoutes);

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

    const stops = finalStops.slice(0, MAX_ROUTE_STOPS).map((stop, index) => ({ ...stop, seq: index + 1 }));
    const total = stops.length ? stops[stops.length - 1].departure : 0;
    return { groupId: route.groupId, homeTower: route.homeTower, totalMin: total, stops };
  });

  return finalRoutes;
}

module.exports = {
  isFamilyEligibleForGrouping,
  buildGroups,
  fillExistingGroups,
  buildRoutes,
  parseApartmentCode,
  findFamily,
  REGULAR_VISIT_MIN,
  DEFAULT_QUEST_VISIT_MIN,
  TRANSFER_MIN,
  MIN_GROUP_SIZE,
  MAX_GROUP_SIZE,
  TARGET_ROUTE_STOPS,
  MAX_ROUTE_STOPS,
};
