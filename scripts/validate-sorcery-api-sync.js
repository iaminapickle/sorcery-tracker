let S;
async function loadSync() {
	if (globalThis.SorceryTrackerSync) return globalThis.SorceryTrackerSync;
	const candidates = ['scripts/sorcery-sync.js', 'Sorcery Tracker/scripts/sorcery-sync.js'];
	const p = candidates.find(c => app.vault.getAbstractFileByPath(c));
	if (!p) throw new Error('Missing sorcery-sync.js');
	const raw = await app.vault.adapter.read(p);
	(0, eval)(raw);
	return globalThis.SorceryTrackerSync;
}

module.exports = {
	entry: start,
	settings: {
		name: "Validate Sorcery API Sync",
		options: {},
	},
};

async function start(params) {
	S = await loadSync();
	const report = await S.validateApiSync();
	if (report.ok) {
		new Notice(`API sync clean: ${report.missing.length} missing, 0 mismatches`, 4000);
	} else {
		new Notice(`API sync has ${report.mismatches.length} mismatch(es); report written to ${report.reportPath}`, 8000);
	}
	return report;
}
