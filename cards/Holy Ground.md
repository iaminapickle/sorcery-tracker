---
kind: sorcery-card-summary
cssclasses:
  - sorcery-flat-meta
cardName: "Holy Ground"
setNames:
  - "Alpha"
  - "Beta"
---
```dataviewjs
async function loadSorceryShared() {
  if (globalThis.SorceryTrackerShared) return globalThis.SorceryTrackerShared;
  for (const p of ['scripts/sorcery-shared.js', 'Sorcery Tracker/scripts/sorcery-shared.js']) {
    try { const raw = await app.vault.adapter.read(p); (0, eval)(raw); return globalThis.SorceryTrackerShared; } catch {}
  }
  throw new Error('Missing sorcery-shared.js');
}

const S = await loadSorceryShared();
await S.renderSummary(dv);
```
