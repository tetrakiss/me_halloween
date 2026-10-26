// Each endpoint of a link owns its own request. Editing one family must never
// erase the other family's wish (or the rest of a transitive wish chain).
function setFamilyWish(db, familyId, wishedFamilyId) {
  return db.transaction(() => {
    db.prepare('UPDATE wish_links SET requested_by_a = 0 WHERE family_a = ?').run(familyId);
    db.prepare('UPDATE wish_links SET requested_by_b = 0 WHERE family_b = ?').run(familyId);
    if (wishedFamilyId) {
      const [a, b] = [familyId, wishedFamilyId].sort();
      const ownColumn = familyId === a ? 'requested_by_a' : 'requested_by_b';
      db.prepare(`INSERT INTO wish_links(family_a, family_b, requested_by_a, requested_by_b)
        VALUES (?, ?, ?, ?) ON CONFLICT(family_a, family_b) DO UPDATE SET ${ownColumn} = 1`)
        .run(a, b, familyId === a ? 1 : 0, familyId === b ? 1 : 0);
    }
    db.prepare('DELETE FROM wish_links WHERE requested_by_a = 0 AND requested_by_b = 0').run();
  })();
}

function assertWishGroups(groups, wishLinks) {
  const assignments = new Map(groups.flatMap((group) => group.memberFamilyIds.map((id) => [id, group.id])));
  const neighbors = new Map();
  for (const { a, b } of wishLinks) {
    if (!neighbors.has(a)) neighbors.set(a, []);
    if (!neighbors.has(b)) neighbors.set(b, []);
    neighbors.get(a).push(b);
    neighbors.get(b).push(a);
  }
  const visited = new Set();
  for (const id of neighbors.keys()) {
    if (visited.has(id)) continue;
    const queue = [id];
    const groupIds = new Set();
    for (let index = 0; index < queue.length; index += 1) {
      const member = queue[index];
      if (visited.has(member)) continue;
      visited.add(member);
      if (assignments.has(member)) groupIds.add(assignments.get(member));
      queue.push(...(neighbors.get(member) || []));
    }
    if (groupIds.size > 1) {
      throw new Error('Не удалось сохранить пожелание ходить вместе. Текущие группы не изменены.');
    }
  }
}

module.exports = { setFamilyWish, assertWishGroups };
