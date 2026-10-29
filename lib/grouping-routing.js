/**
 * Чистые функции группировки/маршрутизации — без привязки к БД.
 * db.js вызывает их, передавая массивы, и сохраняет результат обратно.
 */

const { TIMING } = require('./route-schedule');
const { buildRoutes } = require('./route-planner');
const REGULAR_VISIT_MIN = TIMING.candy;
const DEFAULT_QUEST_VISIT_MIN = TIMING.quest;
const TRANSFER_MIN = 5;
const MIN_GROUP_SIZE = 5;
const MAX_GROUP_SIZE = 6;
const TARGET_ROUTE_STOPS = 8;
const MAX_ROUTE_STOPS = 8;

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

function isFamilyEligibleForGrouping(family, wishLinks = []) {
  return !!(family.hosting || family.quest || family.candyBrought || family.wishFamilyIds?.length
    || wishLinks.some(({ a, b }) => a === family.id || b === family.id));
}

function buildGroups(families, wishLinks) {
  const allWalkers = families.filter((f) => !f.cancelled && f.walking && !f.groupingPaused && isFamilyEligibleForGrouping(f, wishLinks));
  const familyById = new Map(allWalkers.map((family) => [family.id, family]));

  // Resolve complete wish chains before eligibility filtering. A paused or not-yet
  // eligible intermediary must not split the eligible families on either side.
  const uf = new UnionFind(families.map((family) => family.id));
  for (const { a, b } of wishLinks) {
    if (uf.parent.has(a) && uf.parent.has(b)) uf.union(a, b);
  }
  const clusters = new Map();
  for (const family of allWalkers) {
    const root = uf.find(family.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(family.id);
  }
  const components = [...clusters.values()].map((ids) => summarizeFamilies(ids, familyById));
  const linkedRoots = new Set(wishLinks.filter(({ a, b }) => uf.parent.has(a) && uf.parent.has(b))
    .map(({ a }) => uf.find(a)));
  const chains = components.filter((component) => linkedRoots.has(uf.find(component.familyIds[0])));
  const independent = components.filter((component) => !linkedRoots.has(uf.find(component.familyIds[0])));
  const manualPreference = (component) => component.familyIds.map((id) => familyById.get(id).manualGroupId).filter(Boolean).sort()[0] || null;
  const usedIds = new Set(allWalkers.map((family) => family.manualGroupId).filter(Boolean));
  const claimedManualIds = new Set();
  let nextId = 1;
  const autoId = () => {
    while (usedIds.has(`group_${nextId}`)) nextId += 1;
    const id = `group_${nextId++}`;
    usedIds.add(id);
    return id;
  };
  const groups = [];
  const createPartitions = (items) => {
    const buckets = new Map();
    for (const component of items) {
      const manualId = manualPreference(component);
      if (!buckets.has(manualId)) buckets.set(manualId, []);
      buckets.get(manualId).push(component);
    }
    for (const [manualId, bucket] of buckets) {
      for (const partition of partitionComponents(bucket, familyById)) {
        const useManualId = manualId && !claimedManualIds.has(manualId);
        if (useManualId) claimedManualIds.add(manualId);
        groups.push({
          id: useManualId ? manualId : autoId(),
          memberFamilyIds: partition.flatMap((component) => component.familyIds),
          isManual: !!manualId,
          manualPreference: manualId,
        });
      }
    }
  };
  // Phase one: establish indivisible wish chains before considering unrelated families.
  createPartitions(chains);
  const remaining = [];
  independent.sort((a, b) => b.childCount - a.childCount || a.avgAge - b.avgAge
    || a.familyIds[0].localeCompare(b.familyIds[0]));
  for (const component of independent) {
    const candidates = groups.filter((group) => summarizeFamilies(group.memberFamilyIds, familyById).childCount
      + component.childCount <= MAX_GROUP_SIZE);
    const score = (group) => {
      const current = summarizeFamilies(group.memberFamilyIds, familyById);
      const combined = summarizeFamilies([...group.memberFamilyIds, ...component.familyIds], familyById);
      return (manualPreference(component) && group.manualPreference !== manualPreference(component) ? 1e12 : 0)
        + Math.max(0, combined.maxAge - combined.minAge - 8) * 1e10
        + Math.abs(current.avgAge - component.avgAge) * 1e6
        + (current.towerCounts.has(component.dominantTower) ? 0 : 1e4)
        + MAX_GROUP_SIZE - combined.childCount;
    };
    candidates.sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id));
    if (candidates.length) candidates[0].memberFamilyIds.push(...component.familyIds);
    else remaining.push(component);
  }
  // Phase two: only after all chain groups are filled, group the remaining families.
  createPartitions(remaining);
  for (const group of groups) {
    const summary = summarizeFamilies(group.memberFamilyIds, familyById);
    group.childCount = summary.childCount;
    group.avgAge = summary.childCount ? Math.round(summary.avgAge * 10) / 10 : null;
    delete group.manualPreference;
  }
  return groups;
}

/**
 * Добавляет семьи без группы в текущий набор групп. Если после заполнения
 * нет места, создаёт новые группы без переполнения существующих. Связанные пожеланиями семьи остаются
 * неделимой компонентой, а случайная семья задаёт начало очередного запуска.
 */
function fillExistingGroups(groups, families, wishLinks, random = Math.random, options = {}) {
  const familyById = new Map(families.map((family) => [family.id, family]));
  const updatedGroups = groups.map((group) => ({
    ...group,
    memberFamilyIds: [...group.memberFamilyIds],
  }));
  const assignedFamilyIds = new Set(updatedGroups.flatMap((group) => group.memberFamilyIds));
  const waitingFamilies = families.filter((family) => (
    family.walking && !family.cancelled
      && (options.onlyFamilyIds ? options.onlyFamilyIds.includes(family.id) : !assignedFamilyIds.has(family.id))
      && isFamilyEligibleForGrouping(family, wishLinks)
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

  const activeIds = new Set([...assignedFamilyIds, ...waitingFamilies.map((family) => family.id)]);
  const uf = new UnionFind([...activeIds]);
  const linkedIds = new Set();
  for (const { a, b } of wishLinks) {
    linkedIds.add(a);
    linkedIds.add(b);
    if (activeIds.has(a) && activeIds.has(b)) uf.union(a, b);
  }
  const originalAssignment = new Map(groups.flatMap((group) => group.memberFamilyIds.map((id) => [id, group.id])));
  const clusters = new Map();
  for (const id of activeIds) {
    const root = uf.find(id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(id);
  }
  const waitingIds = new Set(waitingFamilies.map((family) => family.id));
  const starterIndex = Math.min(waitingFamilies.length - 1, Math.max(0, Math.floor(Number(random()) * waitingFamilies.length)));
  const starterFamilyId = waitingFamilies[starterIndex].id;
  const components = [...clusters.values()].filter((ids) => ids.some((id) => waitingIds.has(id)))
    .map((ids) => summarizeFamilies(ids, familyById));
  const desiredGroups = (component) => updatedGroups.filter((group) => group.memberFamilyIds.some((id) => component.familyIds.includes(id)));
  const starter = components.find((component) => component.familyIds.includes(starterFamilyId));
  components.sort((a, b) => Number(desiredGroups(b).length > 0) - Number(desiredGroups(a).length > 0)
    || Number(b === starter) - Number(a === starter)
    || Math.abs(a.avgAge - starter.avgAge) - Math.abs(b.avgAge - starter.avgAge)
    || a.familyIds[0].localeCompare(b.familyIds[0]));
  const pendingComponents = [];
  const createdGroupIds = [];
  const usedIds = new Set(updatedGroups.map((group) => group.id));
  let nextNumber = 1;
  const createGroup = () => {
    while (usedIds.has(`group_${nextNumber}`)) nextNumber += 1;
    const id = `group_${nextNumber++}`;
    usedIds.add(id);
    const group = { id, name: null, memberFamilyIds: [], isManual: false };
    updatedGroups.push(group);
    createdGroupIds.push(id);
    return group;
  };
  const compatibilityScore = (group, component) => {
    const current = summarizeFamilies(group.memberFamilyIds, familyById);
    const combined = summarizeFamilies([...group.memberFamilyIds, ...component.familyIds], familyById);
    return Math.max(0, combined.maxAge - combined.minAge - 8) * 10_000_000_000
      + (current.childCount ? Math.abs(current.avgAge - component.avgAge) : 0) * 1_000_000
      + (current.towerCounts.has(component.dominantTower) ? 0 : 10_000)
      + Math.abs(MAX_GROUP_SIZE - combined.childCount);
  };
  const addComponent = (target, component) => {
    const ids = new Set(component.familyIds);
    for (const group of updatedGroups) group.memberFamilyIds = group.memberFamilyIds.filter((id) => !ids.has(id));
    target.memberFamilyIds.push(...component.familyIds);
  };
  const placeWithoutOverflow = (component) => {
    const candidates = updatedGroups.filter((group) => summarizeFamilies(group.memberFamilyIds, familyById).childCount + component.childCount <= MAX_GROUP_SIZE);
    candidates.sort((a, b) => compatibilityScore(a, component) - compatibilityScore(b, component) || a.id.localeCompare(b.id));
    addComponent(candidates[0] || createGroup(), component);
  };
  for (const component of components) {
    const desired = desiredGroups(component);
    if (!desired.length) { pendingComponents.push(component); continue; }
    // Keep the largest existing part of the wish chain in place, joining all its friends.
    desired.sort((a, b) => Number(b.id === options.preferredGroupId) - Number(a.id === options.preferredGroupId)
      || b.memberFamilyIds.filter((id) => component.familyIds.includes(id)).length
      - a.memberFamilyIds.filter((id) => component.familyIds.includes(id)).length || a.id.localeCompare(b.id));
    const target = desired[0];
    addComponent(target, component);
    while (summarizeFamilies(target.memberFamilyIds, familyById).childCount > MAX_GROUP_SIZE) {
      const movable = target.memberFamilyIds.filter((id) => !linkedIds.has(id) && !component.familyIds.includes(id))
        .map((id) => summarizeFamilies([id], familyById)).filter((item) => item.childCount > 0)
        .sort((a, b) => b.childCount - a.childCount || a.familyIds[0].localeCompare(b.familyIds[0]));
      if (!movable.length) break;
      const displaced = movable[0];
      target.memberFamilyIds = target.memberFamilyIds.filter((id) => !displaced.familyIds.includes(id));
      pendingComponents.push(displaced);
    }
  }
  for (const component of pendingComponents) placeWithoutOverflow(component);
  const assignments = updatedGroups.flatMap((group) => group.memberFamilyIds
    .filter((id) => originalAssignment.get(id) !== group.id).map((familyId) => ({ familyId, groupId: group.id })));
  const unassignedFamilyIds = [];

  for (const group of updatedGroups) {
    const summary = summarizeFamilies(group.memberFamilyIds, familyById);
    group.childCount = summary.childCount;
    group.avgAge = summary.childCount ? Math.round(summary.avgAge * 10) / 10 : null;
  }
  return { groups: updatedGroups, assignments, unassignedFamilyIds, starterFamilyId, createdGroupIds };
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
