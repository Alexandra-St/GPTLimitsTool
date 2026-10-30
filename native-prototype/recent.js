(() => {
  'use strict';
  // Input is already normalized metadata, not an assumed ChatGPT response schema.
  function recentConversations(records, now = Date.now(), hours = 6) {
    if (!Array.isArray(records) || !Number.isFinite(now) || !Number.isFinite(hours) || hours < 0) return [];
    const cutoff = now - hours * 3600000;
    const unique = new Map();
    for (const record of records) {
      if (!record || typeof record.id !== 'string' || !record.id || typeof record.title !== 'string') continue;
      const updatedAt = record.updatedAt;
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < cutoff || updatedAt > now) continue;
      const clean = { id: record.id, title: record.title, updatedAt };
      if (!unique.has(clean.id) || unique.get(clean.id).updatedAt < updatedAt) unique.set(clean.id, clean);
    }
    return [...unique.values()].sort((a,b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }
  globalThis.GptRecentConversations = { recentConversations };
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.GptRecentConversations;
})();
