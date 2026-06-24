let S, Sync;

async function loadShared() {
	if (globalThis.SorceryTrackerShared) return globalThis.SorceryTrackerShared;
	const candidates = ['scripts/sorcery-shared.js', 'Sorcery Tracker/scripts/sorcery-shared.js'];
	const p = candidates.find(c => app.vault.getAbstractFileByPath(c));
	if (!p) throw new Error('Missing sorcery-shared.js');
	const raw = await app.vault.adapter.read(p);
	(0, eval)(raw);
	return globalThis.SorceryTrackerShared;
}

async function loadSync() {
	if (globalThis.SorceryTrackerSync) return globalThis.SorceryTrackerSync;
	const candidates = ['scripts/sorcery-sync.js', 'Sorcery Tracker/scripts/sorcery-sync.js'];
	const p = candidates.find(c => app.vault.getAbstractFileByPath(c));
	if (!p) throw new Error('Missing sorcery-sync.js');
	const raw = await app.vault.adapter.read(p);
	(0, eval)(raw);
	return globalThis.SorceryTrackerSync;
}

async function loadScriptExports(candidates) {
	for (const path of candidates) {
		try {
			const raw = await app.vault.adapter.read(path);
			const fakeModule = { exports: {} };
			new Function('module', 'exports', raw)(fakeModule, fakeModule.exports);
			return fakeModule.exports;
		} catch (_) {}
	}
	return null;
}

module.exports = {
	entry: start,
	settings: {
		name: "Sync New Set",
		options: {},
	},
};

const API_URL = "https://api.sorcerytcg.com/api/cards";

function progressBar(done, total, width = 20) {
	const filled = Math.round((done / total) * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
}

async function start(params) {
	S = await loadShared();
	const config = await S.loadConfig();
	const notice = new Notice("Syncing new set…", 0);
	const errors = [];
	const log = [];

	// ── 1. Refresh API ────────────────────────────────────────────────────────
	notice.setMessage("(1/5) Fetching Sorcery API…");
	try {
		const res = await fetch(API_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
		const data = await res.json();
		if (!Array.isArray(data)) throw new Error("Expected array from API");
		const outPath = S.vaultPath(config, `${config.dataDir}/${config.apiFile}`);
		await S.ensureFolder(S.vaultPath(config, config.dataDir));
		await app.vault.adapter.write(outPath, JSON.stringify(data, null, 2) + "\n");
		globalThis.__sorceryApiData = null;
		log.push(`API: ${data.length} cards`);
	} catch (err) {
		errors.push(`API fetch: ${err.message}`);
	}

	// ── 2. Refresh set manifests ──────────────────────────────────────────────
	notice.setMessage("(2/5) Refreshing set manifests…");
	try {
		const sourceCandidates = [
			`${config.dataDir}/${config.apiFile}`,
			`data/${config.apiFile}`,
			S.vaultPath(config, `${config.dataDir}/${config.apiFile}`),
		];
		const source = await S.readJsonByCandidates(sourceCandidates);
		if (!source) throw new Error(`Missing ${config.apiFile}`);
		const manifests = S.buildSetManifests(source.data);
		const manifestSetNames = [...new Set(Object.keys(manifests))];
		const configuredSetOrder = Array.isArray(config.setOrder) ? config.setOrder : S.DEFAULT_CONFIG.setOrder;
		const setOrder = [
			...configuredSetOrder.filter(n => manifestSetNames.includes(n)),
			...manifestSetNames.filter(n => !configuredSetOrder.includes(n)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
		];
		const costs = [...new Set(source.data.map(c => c?.guardian?.cost).filter(c => c !== undefined && c !== null && c !== ""))]
			.map(c => Number(c)).filter(c => Number.isFinite(c)).sort((a, b) => a - b);
		const configuredCostOrder = Array.isArray(config.costOrder) ? config.costOrder : S.DEFAULT_CONFIG.costOrder;
		const costOrder = [
			...configuredCostOrder.filter(c => costs.includes(c)),
			...costs.filter(c => !configuredCostOrder.includes(c)),
		];
		await app.vault.adapter.write(
			S.vaultPath(config, `${config.dataDir}/${config.manifestFile}`),
			JSON.stringify(manifests, null, 2) + "\n",
		);
		await app.vault.adapter.write(
			S.vaultPath(config, `${config.dataDir}/config.json`),
			JSON.stringify({ ...config, setOrder, costOrder }, null, 2) + "\n",
		);
		S.invalidateConfigCache?.();
		log.push(`Manifests: ${Object.keys(manifests).length} sets`);
	} catch (err) {
		errors.push(`Set manifests: ${err.message}`);
	}

	// ── 3. Scrape Curiosa (FAQs + Codex) ─────────────────────────────────────
	notice.setMessage("(3/5) Scraping Curiosa…");
	try {
		const curiosa = await loadScriptExports(['scripts/scrape-curiosa.js', 'Sorcery Tracker/scripts/scrape-curiosa.js']);
		if (!curiosa?.entry) throw new Error("scrape-curiosa.js not found");
		const result = await curiosa.entry(params);
		if (result) log.push(`Curiosa: scraped`);
		else log.push("Curiosa: done");
	} catch (err) {
		errors.push(`Curiosa scrape: ${err.message}`);
	}

	// ── 4. Generate missing notes ─────────────────────────────────────────────
	notice.setMessage("(4/5) Generating missing pages…");
	try {
		Sync = await loadSync();
		const result = await Sync.generateMissingSorceryNotes((done, total, cardName) => {
			const pct = Math.round((done / total) * 100);
			notice.setMessage(`(4/5) Generating pages…\n${progressBar(done, total)} ${pct}%\n${done} / ${total}  ${cardName}`);
		});
		const { generated: g } = result;
		log.push(`Pages: ${g.summaries} summaries, ${g.variants} variants, ${g.setPages} sets, ${g.artistPages} artists`);
	} catch (err) {
		errors.push(`Generate pages: ${err.message}`);
	}

	// ── 5. Sort cards and artists ─────────────────────────────────────────────
	notice.setMessage("(5/5) Sorting cards and artists…");
	try {
		const manualSortPath = S.vaultPath(config, ".obsidian/plugins/manual-sorting/data.json");
		const raw = await app.vault.adapter.read(manualSortPath);
		const data = JSON.parse(raw);
		const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
		const sortFolder = async (folder) => {
			const rel = S.vaultPath(config, folder);
			const listed = await app.vault.adapter.list(rel);
			const entries = [...listed.folders.map(p => p.split("/").pop()), ...listed.files.map(p => p.split("/").pop())]
				.filter(name => !name.startsWith("."))
				.map(name => ({ name, path: `${folder}/${name}`, isIndex: name === "index.md" }))
				.sort((a, b) => collator.compare(a.name, b.name));
			const index = entries.find(e => e.isIndex);
			const others = entries.filter(e => !e.isIndex);
			return index ? [index.path, ...others.map(e => e.path)] : others.map(e => e.path);
		};
		data.customOrder = data.customOrder || {};
		for (const folder of ["cards", "artists"]) {
			const children = await sortFolder(folder);
			data.customOrder[folder] = { ...(data.customOrder[folder] || {}), children, sortOrder: "custom" };
		}
		await app.vault.adapter.write(manualSortPath, JSON.stringify(data, null, 2) + "\n");
		log.push("Sorted cards & artists");
	} catch (err) {
		errors.push(`Sort: ${err.message}`);
	}

	// ── Done ──────────────────────────────────────────────────────────────────
	notice.hide();
	if (errors.length) {
		new Notice(`Sync completed with errors:\n${errors.join("\n")}`, 12000);
	} else {
		new Notice(`Sync complete\n${log.join(" · ")}`, 7000);
	}
}
