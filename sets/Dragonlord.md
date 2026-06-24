---
kind: sorcery-dashboard
setName: Dragonlord
setMode: base
playRowsAlign: none
cssclasses:
  - sorcery-dashboard
  - centered-note
baseSlotsPerRow: 4
baseSpecialSlots: 0
baseRowsPerPage: 3
playSlotsPerRow: 4
playSpecialSlots: 0
playRowsPerPage: 3
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
await S.renderSetPage(dv);
```
