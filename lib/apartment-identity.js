function apartmentNumberKey(value) {
  return String(value ?? '').normalize('NFKC').replace(/[^0-9]/g, '');
}

function normalizeTower(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru');
}

function findApartmentConflict(db, {
  tower,
  floor,
  apartmentCode,
  excludeFamilyId = null,
}) {
  const numberKey = apartmentNumberKey(apartmentCode);
  if (!numberKey) return null;

  const params = [Number(floor)];
  let query = `SELECT id, tower, floor, apartment_code
               FROM families
               WHERE floor = ? AND cancelled = 0`;
  if (excludeFamilyId) {
    query += ' AND id <> ?';
    params.push(excludeFamilyId);
  }

  const towerKey = normalizeTower(tower);
  return db.prepare(query).all(...params).find((family) => (
    normalizeTower(family.tower) === towerKey
    && apartmentNumberKey(family.apartment_code) === numberKey
  )) || null;
}

module.exports = { apartmentNumberKey, findApartmentConflict };
