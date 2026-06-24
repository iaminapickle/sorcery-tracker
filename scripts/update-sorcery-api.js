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
		name: "Update Sorcery API",
		options: {},
	},
};

const API_URL = "https://api.sorcerytcg.com/api/cards";

async function start(_params) {
	S = await loadShared();
	const config = await S.loadConfig();

	const notice = new Notice("Fetching from api.sorcerytcg.com…", 0);
	try {
		const res = await fetch(API_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
		const data = await res.json();
		if (!Array.isArray(data)) throw new Error("Unexpected response shape — expected a top-level array");

		const outPath = S.vaultPath(config, `${config.dataDir}/${config.apiFile}`);
		await S.ensureFolder(S.vaultPath(config, config.dataDir));
		await app.vault.adapter.write(outPath, JSON.stringify(data, null, 2) + "\n");

		// Bust the in-memory cache so subsequent renders use the new data
		globalThis.__sorceryApiData = null;

		notice.hide();
		new Notice(`Updated ${config.apiFile} — ${data.length} cards`, 5000);
	} catch (err) {
		notice.hide();
		new Notice(`API update failed: ${err.message}`, 8000);
		throw err;
	}
}
