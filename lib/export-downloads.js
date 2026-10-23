const crypto = require('crypto');

const TTL_MS = 5 * 60 * 1000;
const downloads = new Map();

function createExportDownload(buffer, filename, now = Date.now()) {
  for (const [token, entry] of downloads) {
    if (entry.expiresAt <= now) downloads.delete(token);
  }
  // Bound in-memory snapshots even if an administrator repeatedly exports.
  if (downloads.size >= 20) downloads.delete(downloads.keys().next().value);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = now + TTL_MS;
  downloads.set(token, { buffer, filename, expiresAt });
  return { url: `/admin-api/export-downloads/${token}`, filename, expiresAt };
}

function getExportDownload(token, now = Date.now()) {
  const entry = downloads.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    downloads.delete(token);
    return null;
  }
  return entry;
}

function sendExcel(res, buffer, filename) {
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': buffer.length,
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': 'https://web.telegram.org',
  });
  return res.send(buffer);
}

module.exports = { createExportDownload, getExportDownload, sendExcel };
