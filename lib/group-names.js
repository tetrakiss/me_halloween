function assignGroupNames(groups, catalog, previousGroups = new Map()) {
  const used = new Set();
  for (const group of groups) {
    const previous = previousGroups.get(group.id);
    const name = previous?.name || group.name;
    if (name && name !== group.id && !used.has(name)) {
      group.name = name;
      used.add(name);
    } else group.name = null;
  }
  for (const group of groups) {
    if (group.name) continue;
    const age = Number(group.avgAge || 0);
    const choices = [...catalog].sort((a, b) => {
      const distance = (item) => Math.max(item.age_min - age, age - item.age_max, 0);
      return distance(a) - distance(b) || a.id - b.id;
    });
    const available = choices.find((item) => !used.has(item.name));
    let name = available?.name || choices[0]?.name || 'Хэллоуинская команда';
    const base = name;
    let suffix = 2;
    while (used.has(name)) name = `${base} ${suffix++}`;
    group.name = name;
    used.add(name);
  }
  return groups;
}

module.exports = { assignGroupNames };
