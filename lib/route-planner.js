const { TIMING, startTowerFor } = require('./route-schedule');
const MAX_TOWER_STOPS = 3;
const TARGET_STOPS = 10;
const HOST_KEY = Symbol('hostKey');
const keyOf = (host) => host[HOST_KEY] || (host[HOST_KEY] = `${host.hostType}:${host.hostId}`);
const compare = (a, b) => a.tower.localeCompare(b.tower) || a.floor - b.floor
  || String(a.apartmentCode || '').localeCompare(String(b.apartmentCode || '')) || keyOf(a).localeCompare(keyOf(b));

function constraintError(message) {
  const error = new Error(message);
  error.code = 'ROUTE_CONSTRAINT'; error.status = 409;
  return error;
}
function towerCounts(stops) {
  const counts = new Map();
  for (const stop of stops) counts.set(stop.tower, (counts.get(stop.tower) || 0) + 1);
  return counts;
}
function eligible(group, host) {
  return host.hostType === 'special' || host.isQuest || !group.memberFamilyIds.includes(host.hostId);
}
function asBlocks(stops) {
  const towers = new Map();
  for (const stop of [...stops].sort(compare)) {
    if (!towers.has(stop.tower)) towers.set(stop.tower, []);
    towers.get(stop.tower).push(stop);
  }
  return [...towers.values()];
}
function flatten(blocks) { return blocks.flat(); }

// Each tower contributes at most three stops. Dynamic programming keeps the
// desired visit count and quest/candy mix while selecting the least loaded hosts.
function selectStops(route, hosts, loads, childrenLoads, questRatio) {
  const candidates = hosts.filter((host) => eligible(route.group, host));
  const required = new Set(route.pinned);
  const fixed = route.fixed;
  if (fixed) fixed.forEach((key) => required.add(key));
  const available = new Map(candidates.map((host) => [keyOf(host), host]));
  for (const key of required) {
    if (!available.has(key)) throw constraintError(`Группа «${route.group.name || route.group.id}»: закреплённая точка недоступна или является собственной квартирой без квеста.`);
  }
  const towers = new Map();
  for (const host of candidates) {
    if (!towers.has(host.tower)) towers.set(host.tower, []);
    towers.get(host.tower).push(host);
  }
  for (const [tower, list] of towers) {
    if (list.filter((host) => required.has(keyOf(host))).length > MAX_TOWER_STOPS) {
      throw constraintError(`Группа «${route.group.name || route.group.id}»: в башне «${tower}» закреплено больше 3 остановок. Уберите лишнее ручное назначение.`);
    }
  }
  if (fixed) return [...required].map((key) => available.get(key)).sort(compare);
  const capacity = [...towers.values()].reduce((sum, list) => sum + Math.min(MAX_TOWER_STOPS, list.length), 0);
  const target = Math.min(TARGET_STOPS + route.pinned.size, capacity);
  route.shortened = target < TARGET_STOPS + route.pinned.size;
  const questTarget = route.group.routeQuestCount ?? Math.round(target * questRatio);
  const cost = (host) => {
    const key = keyOf(host); const visits = loads.get(key) || 0; const children = childrenLoads.get(key) || 0;
    return (2 * visits + 1) * 1e6 + 2 * children * route.weight + route.weight ** 2;
  };
  let dp = new Map([['0:0', { count: 0, quests: 0, cost: 0, stops: [] }]]);
  for (const list of towers.values()) {
    const must = list.filter((host) => required.has(keyOf(host)));
    const optional = list.filter((host) => !required.has(keyOf(host)));
    const order = (a, b) => cost(a) - cost(b) || compare(a, b);
    const quests = optional.filter((host) => host.isQuest).sort(order);
    const candy = optional.filter((host) => !host.isQuest).sort(order);
    const choices = [];
    for (let q = 0; q <= Math.min(3 - must.length, quests.length); q += 1) {
      for (let c = 0; c <= Math.min(3 - must.length - q, candy.length); c += 1) {
        const stops = [...must, ...quests.slice(0, q), ...candy.slice(0, c)];
        choices.push({ stops, quests: stops.filter((s) => s.isQuest).length, cost: stops.reduce((sum, s) => sum + cost(s), 0) });
      }
    }
    const next = new Map();
    for (const state of dp.values()) for (const choice of choices) {
      const count = state.count + choice.stops.length; const q = state.quests + choice.quests;
      if (count > target) continue;
      const key = `${count}:${q}`; const value = state.cost + choice.cost;
      if (!next.has(key) || value < next.get(key).cost) next.set(key, { count, quests: q, cost: value, stops: [...state.stops, ...choice.stops] });
    }
    dp = next;
  }
  const possibilities = [...dp.values()].filter((state) => state.count === target);
  possibilities.sort((a, b) => Math.abs(a.quests - questTarget) - Math.abs(b.quests - questTarget) || a.cost - b.cost);
  if (!possibilities.length) throw constraintError(`Не удалось подобрать маршрут группы «${route.group.name || route.group.id}» с лимитом 3 остановки на башню.`);
  return possibilities[0].stops;
}

function balance(routes, hosts) {
  const loads = new Map(hosts.map((h) => [keyOf(h), 0]));
  const kids = new Map(hosts.map((h) => [keyOf(h), 0]));
  for (const r of routes) for (const h of r.stops) {
    loads.set(keyOf(h), loads.get(keyOf(h)) + 1); kids.set(keyOf(h), kids.get(keyOf(h)) + r.weight);
  }
  const movable = (r, h) => !r.fixed && !r.pinned.has(keyOf(h));
  const canReplace = (r, old, h) => eligible(r.group, h) && !r.stops.some((s) => keyOf(s) === keyOf(h))
    && (h.tower === old.tower || r.stops.filter((s) => s.tower === h.tower).length < MAX_TOWER_STOPS);
  // Strictly improving integer costs keep both passes finite and deterministic.
  for (let pass = 0; pass < 2000; pass += 1) {
    let best = null;
    for (const r of routes) for (let i = 0; i < r.stops.length; i += 1) {
      const old = r.stops[i]; if (!movable(r, old)) continue;
      for (const h of hosts) {
        if (h.isQuest !== old.isQuest || !canReplace(r, old, h)) continue;
        const a = keyOf(old); const b = keyOf(h); const diff = loads.get(a) - loads.get(b);
        if (diff < 1) continue;
        const gain = 2 * (diff - 1) * 1e6 + 2 * r.weight * (kids.get(a) - kids.get(b) - r.weight);
        if (gain > 0 && (!best || gain > best.gain)) best = { r, i, h, a, b, gain };
      }
    }
    if (!best) break;
    const { r, i, h, a, b } = best;
    r.stops[i] = h; loads.set(a, loads.get(a) - 1); loads.set(b, loads.get(b) + 1);
    kids.set(a, kids.get(a) - r.weight); kids.set(b, kids.get(b) + r.weight);
  }
  for (let pass = 0; pass < 1000; pass += 1) {
    let best = null;
    for (let a = 0; a < routes.length; a += 1) for (let b = a + 1; b < routes.length; b += 1) {
      const r = routes[a]; const s = routes[b]; if (r.weight === s.weight) continue;
      for (let i = 0; i < r.stops.length; i += 1) for (let j = 0; j < s.stops.length; j += 1) {
        const x = r.stops[i]; const y = s.stops[j];
        if (x.isQuest !== y.isQuest || !movable(r, x) || !movable(s, y) || !canReplace(r, x, y) || !canReplace(s, y, x)) continue;
        const ka = keyOf(x); const kb = keyOf(y); const delta = s.weight - r.weight;
        const gain = -2 * delta * (kids.get(ka) - kids.get(kb)) - 2 * delta ** 2;
        if (gain > 0 && (!best || gain > best.gain)) best = { r, s, i, j, ka, kb, delta, gain };
      }
    }
    if (!best) break;
    const { r, s, i, j, ka, kb, delta } = best;
    [r.stops[i], s.stops[j]] = [s.stops[j], r.stops[i]];
    kids.set(ka, kids.get(ka) + delta); kids.set(kb, kids.get(kb) - delta);
  }
}

function timeRoute(route, blocks) {
  let minutes = TIMING.gathering; let tower = startTowerFor(route.group);
  return flatten(blocks).map((host, index) => {
    minutes += host.tower === tower ? TIMING.insideTower : TIMING.betweenTowers;
    const arrival = minutes; minutes += host.isQuest ? TIMING.quest : TIMING.candy; tower = host.tower;
    return { ...host, seq: index + 1, arrival, departure: minutes, waitMin: 0 };
  });
}
function conflicts(a, b) {
  const byHost = b.byHost || (b.byHost = new Map(b.map((stop) => [keyOf(stop), stop]))); let count = 0;
  for (const stop of a) {
    const other = byHost.get(keyOf(stop)); if (!other) continue;
    const overlap = Math.min(stop.departure, other.departure) - Math.max(stop.arrival, other.arrival);
    if (overlap > 0) count += 1 + overlap / 100;
  }
  return count;
}
function orderRoutes(routes) {
  let seed = 0x6d2b79f5;
  const random = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  let blocks = routes.map((r) => asBlocks(r.stops));
  let timed = routes.map((r, i) => timeRoute(r, blocks[i]));
  let score = 0;
  for (let i = 0; i < routes.length; i += 1) for (let j = i + 1; j < routes.length; j += 1) score += conflicts(timed[i], timed[j]);
  let bestScore = score; let best = blocks.map((bb) => bb.map((b) => [...b]));
  const iterations = Math.min(180000, Math.max(6000, routes.length * 6500));
  for (let step = 0; step < iterations && bestScore > 1e-8; step += 1) {
    const index = Math.floor(random() * routes.length); const current = blocks[index]; if (!current.length) continue;
    const next = current.map((b) => [...b]);
    if (random() < 0.72 && next.length > 1) {
      const from = Math.floor(random() * next.length); let to = Math.floor(random() * (next.length - 1)); if (to >= from) to += 1;
      const [block] = next.splice(from, 1); next.splice(to, 0, block);
    } else {
      const multi = next.filter((b) => b.length > 1); if (!multi.length) continue;
      const block = multi[Math.floor(random() * multi.length)]; const from = Math.floor(random() * block.length);
      const to = (from + 1 + Math.floor(random() * (block.length - 1))) % block.length;
      [block[from], block[to]] = [block[to], block[from]];
    }
    const newTimes = timeRoute(routes[index], next); let delta = 0;
    for (let j = 0; j < routes.length; j += 1) if (j !== index) delta += conflicts(newTimes, timed[j]) - conflicts(timed[index], timed[j]);
    const temperature = Math.max(0.08, 1.3 * (1 - step / iterations));
    if (delta <= 0 || random() < Math.exp(-delta / temperature)) {
      blocks[index] = next; timed[index] = newTimes; score += delta;
      if (score < bestScore - 1e-8) { bestScore = score; best = blocks.map((bb) => bb.map((b) => [...b])); }
    }
  }
  return routes.map((r, i) => timeRoute(r, best[i]));
}

// If ordering alone cannot resolve contention, reserve the earliest free slot
// at every host. Waiting is explicit and subsequently shown by the schedule.
function reserveSlots(routes, ordered) {
  const result = routes.map(() => []); const positions = routes.map(() => 0);
  const times = routes.map(() => TIMING.gathering); const towers = routes.map((r) => startTowerFor(r.group));
  const calendars = new Map();
  for (;;) {
    let next = -1; let wanted = Infinity;
    for (let i = 0; i < routes.length; i += 1) {
      const stop = ordered[i][positions[i]]; if (!stop) continue;
      const arrival = times[i] + (towers[i] === stop.tower ? TIMING.insideTower : TIMING.betweenTowers);
      if (arrival < wanted) { wanted = arrival; next = i; }
    }
    if (next < 0) break;
    const stop = ordered[next][positions[next]]; const duration = stop.isQuest ? TIMING.quest : TIMING.candy;
    const key = keyOf(stop); const slots = calendars.get(key) || []; let arrival = wanted;
    for (const slot of slots) {
      if (arrival + duration <= slot.start) break;
      if (arrival < slot.end) arrival = slot.end;
    }
    const departure = arrival + duration;
    slots.push({ start: arrival, end: departure }); slots.sort((a, b) => a.start - b.start); calendars.set(key, slots);
    result[next].push({ ...stop, arrival, departure, waitMin: arrival - wanted });
    times[next] = departure; towers[next] = stop.tower; positions[next] += 1;
  }
  return result;
}

function buildRoutes(groups, families, specialPoints = [], extraVisits = [], fixedStops = null) {
  const hosts = families.filter((f) => !f.cancelled && (f.hosting || f.quest)).map((f) => ({ hostId: f.id, hostType: 'family',
    tower: f.tower, floor: f.floor, apartmentCode: f.apartmentCode, displayName: null, isQuest: !!f.quest }));
  for (const s of specialPoints.filter((sp) => sp.active !== false && sp.active !== 0)) hosts.push({ hostId: s.id, hostType: 'special',
    tower: s.tower, floor: s.floor, apartmentCode: null, displayName: s.name, isQuest: !!s.quest });
  hosts.sort(compare);
  const byKey = new Map(hosts.map((host) => [keyOf(host), host])); const byFamily = new Map(families.map((f) => [f.id, f]));
  const routes = groups.map((g) => ({ group: g, weight: g.memberFamilyIds.reduce((sum, id) => sum + (byFamily.get(id)?.children?.length || 0), 0),
    pinned: new Set(extraVisits.filter((v) => v.groupId === g.id && byKey.has(`family:${v.familyId}`)).map((v) => `family:${v.familyId}`)),
    fixed: fixedStops?.has(g.id) ? fixedStops.get(g.id).filter((key) => byKey.has(key)) : null, stops: [] }));
  const loads = new Map(); const childLoads = new Map(); const ratio = hosts.length ? hosts.filter((h) => h.isQuest).length / hosts.length : 0;
  for (const r of [...routes].sort((a, b) => b.weight - a.weight || a.group.id.localeCompare(b.group.id))) {
    r.stops = selectStops(r, hosts, loads, childLoads, ratio);
    for (const h of r.stops) { const key = keyOf(h); loads.set(key, (loads.get(key) || 0) + 1); childLoads.set(key, (childLoads.get(key) || 0) + r.weight); }
  }
  balance(routes, hosts);
  const scheduled = reserveSlots(routes, orderRoutes(routes));
  return routes.map((r, i) => ({ groupId: r.group.id, homeTower: scheduled[i][0]?.tower || startTowerFor(r.group),
    totalMin: scheduled[i].at(-1)?.departure || TIMING.gathering, stops: scheduled[i],
    waitingMin: scheduled[i].reduce((sum, s) => sum + s.waitMin, 0), shortened: !!r.shortened }));
}

module.exports = { buildRoutes, MAX_TOWER_STOPS };
