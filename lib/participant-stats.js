const { apartmentNumberKey } = require('./apartment-identity');

function getParticipantStats(db) {
  const families = db.prepare(`
    SELECT id, tower, floor, apartment_code
    FROM families
    WHERE cancelled = 0
  `).all();
  const apartments = new Set(families.map((family) => [
    String(family.tower || '').trim().toLocaleLowerCase('ru-RU'),
    Number(family.floor),
    apartmentNumberKey(family.apartment_code),
  ].join('|')));
  const children = db.prepare(`
    SELECT COUNT(c.id) AS count
    FROM children c
    JOIN families f ON f.id = c.family_id
    WHERE f.cancelled = 0
  `).get();

  return {
    apartmentCount: apartments.size,
    childCount: Number(children?.count || 0),
  };
}

module.exports = { getParticipantStats };
