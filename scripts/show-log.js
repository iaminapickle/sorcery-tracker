let S;
async function loadShared() {
	if (globalThis.SorceryTrackerShared) return globalThis.SorceryTrackerShared;
	const candidates = ['scripts/sorcery-shared.js', 'Sorcery Tracker/scripts/sorcery-shared.js'];
	const p = candidates.find(c => app.vault.getAbstractFileByPath(c));
	if (!p) throw new Error('Missing sorcery-shared.js');
	const raw = await app.vault.adapter.read(p);
	(0, eval)(raw);
	return globalThis.SorceryTrackerShared;
}

module.exports = {
	entry: start,
	settings: {
		name: "Show Recent Log",
		options: {},
	},
};

let QuickAdd;

async function start(params) {
	S = await loadShared();
	QuickAdd = params;
	const config = await S.loadConfig();
	const logPath = `${S.vaultPath(config, config.dataDir)}/logs.md`;

	let content = "";
	try {
		content = await app.vault.adapter.read(logPath);
	} catch {
		new Notice("No log file found.", 3000);
		return;
	}

	const entries = content
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.startsWith("- "))
		.map((l) => l.slice(2))
		.slice(0, 10);

	if (!entries.length) {
		new Notice("Log is empty.", 3000);
		return;
	}

	await S.withStyledSuggestions(() =>
		QuickAdd.quickAddApi.suggester(entries, entries),
	);
}
