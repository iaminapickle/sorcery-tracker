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
		name: "Export Collection",
		options: {},
	},
};

let QuickAdd;

function csvQuote(value) {
	const s = String(value ?? "");
	return s.includes(",") || s.includes('"') || s.includes("\n")
		? `"${s.replace(/"/g, '""')}"`
		: s;
}

function toCsvLine(cols) {
	return cols.map(csvQuote).join(",");
}

function slugify(name) {
	return String(name || "").replace(/\s+/g, "-").replace(/[\\/:*?"<>|]+/g, "");
}

async function writeCsvToVault(config, filename, header, rows) {
	const outPath = S.vaultPath(config, filename);
	const lines = [header, ...rows].join("\n") + "\n";
	await app.vault.adapter.write(outPath, lines);
	return outPath;
}

// One row per printing: API structure + ownership read from each summary note's
// fm.ownership[slug]. (Mirrors S.loadVariantRows, but without a Dataview `dv`.)
async function buildVariantRows(config) {
	const api = await S.loadApiData(config);
	const prefix = `${S.vaultPath(config, config.cardsDir)}/`;
	const ownByCard = new Map();
	for (const file of app.vault.getMarkdownFiles()) {
		if (!file.path.startsWith(prefix)) continue;
		const fm = app.metadataCache.getFileCache(file)?.frontmatter || {};
		if (fm.kind !== "sorcery-card-summary") continue;
		ownByCard.set(
			String(fm.cardName || file.basename),
			fm.ownership && typeof fm.ownership === "object" ? fm.ownership : {},
		);
	}
	const rows = [];
	for (const card of api?.data || []) {
		const ownership = ownByCard.get(card.name) || {};
		for (const set of card.sets || []) {
			for (const v of set.variants || []) {
				const own = ownership[v.slug] || {};
				rows.push({
					cardName: card.name,
					setName: set.name,
					finish: v.finish,
					product: v.product,
					binderPlacements: Array.isArray(own.binderPlacements) ? own.binderPlacements : [],
				});
			}
		}
	}
	return rows;
}

function buildCardLookup(rows) {
	const map = new Map();
	for (const r of rows) {
		const key = String(r.cardName || "").trim().toLowerCase();
		if (!map.has(key)) {
			map.set(key, {
				setName: String(r.setName || "").trim(),
				product: S.displayProduct(r.product),
			});
		}
	}
	return map;
}

async function exportStorage(config) {
	const binderFolder = S.vaultPath(config, config.bindersDir || "storage");
	const storages = app.vault.getMarkdownFiles()
		.filter(f => f.path.startsWith(binderFolder + "/"))
		.map(f => {
			const fm = app.metadataCache.getFileCache(f)?.frontmatter || {};
			if (fm.kind !== "sorcery-storage") return null;
			return { file: f, name: String(fm.binderName || f.basename), type: String(fm.storageType || "binder") };
		})
		.filter(Boolean)
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

	if (!storages.length) {
		new Notice("No storage found.", 4000);
		return;
	}

	const preselect = globalThis.__sorceryExportPreselect;
	globalThis.__sorceryExportPreselect = null;

	let chosen;
	if (preselect?.name) chosen = storages.find(s => s.name === preselect.name);
	if (!chosen) {
		chosen = await QuickAdd.quickAddApi.suggester(
			storages.map(s => `[${s.type}] ${s.name}`),
			storages,
			"Choose storage to export",
		);
	}
	if (!chosen) return;

	const variants = await buildVariantRows(config);
	const CSV_HEADER = "card name,set,finish,product,quantity,notes";
	const rows = [toCsvLine([chosen.name, "", "", "", "", "Storage"])];

	for (const v of variants) {
		for (const p of v.binderPlacements) {
			if (String(p?.binder || "") !== chosen.name) continue;
			const count = Number(p?.count || 0);
			if (count <= 0) continue;
			const finish = p?.foil ? "Foil" : "Standard";
			rows.push(toCsvLine([
				v.cardName || "",
				v.setName || "",
				finish,
				S.displayProduct(v.product),
				count,
				"",
			]));
		}
	}

	rows.sort();
	const filename = `${chosen.type}-${slugify(chosen.name)}-export.csv`;
	await writeCsvToVault(config, filename, CSV_HEADER, rows);
	new Notice(`Exported ${rows.length} rows to ${filename}`, 5000);
	await logAction(config, `Exported storage "${chosen.name}" to ${filename} (${rows.length} rows)`);
}

async function exportDeck(config) {
	const decksDir = S.vaultPath(config, config.decksDir || "decks");
	const decks = app.vault.getMarkdownFiles()
		.filter(f => f.path.startsWith(decksDir + "/"))
		.map(f => {
			const fm = app.metadataCache.getFileCache(f)?.frontmatter || {};
			if (fm.kind !== "sorcery-deck") return null;
			return { file: f, name: String(fm.deckName || f.basename), fm };
		})
		.filter(Boolean)
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

	if (!decks.length) {
		new Notice("No decks found.", 4000);
		return;
	}

	const preselect = globalThis.__sorceryExportPreselect;
	globalThis.__sorceryExportPreselect = null;

	let chosen;
	if (preselect?.path) {
		const file = app.vault.getAbstractFileByPath(preselect.path);
		chosen = decks.find(d => d.file.path === file?.path);
	}
	if (!chosen) {
		chosen = await QuickAdd.quickAddApi.suggester(
			decks.map(d => d.name),
			decks,
			"Choose deck to export",
		);
	}
	if (!chosen) return;

	const variants = await buildVariantRows(config);
	const cardLookup = buildCardLookup(variants);
	const CSV_HEADER = "card name,set,finish,product,quantity,notes";
	const rows = [];

	rows.push(toCsvLine([chosen.name, "", "", "", "", "Deck"]));
	const avatar = String(chosen.fm.avatar || "");
	if (avatar) rows.push(toCsvLine([avatar, "", "", "", "", "Avatar"]));

	const ZONE_LABELS = { deckSpells: "Spellbook", deckSites: "Atlas", deckCollection: "Collection" };

	for (const zone of ["deckSpells", "deckSites", "deckCollection"]) {
		const entries = Array.isArray(chosen.fm[zone]) ? chosen.fm[zone] : [];
		for (const entry of entries) {
			const cardName = String(entry?.cardName || "").trim();
			const count = Number(entry?.count || 0);
			if (!cardName || count <= 0) continue;
			const info = cardLookup.get(cardName.toLowerCase()) || { setName: "", product: "" };
			rows.push(toCsvLine([
				cardName,
				info.setName,
				"Standard",
				info.product,
				count,
				ZONE_LABELS[zone],
			]));
		}
	}

	const filename = `deck-${slugify(chosen.name)}-export.csv`;
	await writeCsvToVault(config, filename, CSV_HEADER, rows);
	new Notice(`Exported ${rows.length} rows to ${filename}`, 5000);
	await logAction(config, `Exported deck "${chosen.name}" to ${filename} (${rows.length} rows)`);
}

async function exportAllStorage(config) {
	const variants = await buildVariantRows(config);
	const CSV_HEADER = "card name,set,finish,product,quantity,notes";

	const totals = new Map();

	for (const v of variants) {
		for (const p of v.binderPlacements) {
			const count = Number(p?.count || 0);
			if (count <= 0) continue;
			const finish = p?.foil ? "Foil" : "Standard";
			const product = S.displayProduct(v.product);
			const key = [v.cardName || "", v.setName || "", finish, product].join("|");
			totals.set(key, (totals.get(key) ?? 0) + count);
		}
	}

	const rows = [...totals.entries()]
		.sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
		.map(([key, count]) => {
			const [cardName, setName, finish, product] = key.split("|");
			return toCsvLine([cardName, setName, finish, product, count, ""]);
		});

	const filename = "collection-export.csv";
	await writeCsvToVault(config, filename, CSV_HEADER, rows);
	new Notice(`Exported ${rows.length} rows to ${filename}`, 5000);
	await logAction(config, `Exported all storage to ${filename} (${rows.length} rows)`);
}

const logAction = (config, message) => S.logAction(config, message);

async function start(params) {
	S = await loadShared();
	QuickAdd = params;
	const config = await S.loadConfig();

	const preselect = globalThis.__sorceryExportPreselect;
	if (preselect?.type === "deck")    return await exportDeck(config);
	if (preselect?.type === "storage") return await exportStorage(config);

	const mode = await QuickAdd.quickAddApi.suggester(
		["Storage — export one binder or box", "Deck — export one deck", "All Storage — export full collection"],
		["storage", "deck", "all"],
		"Export mode",
	);
	if (!mode) return;

	if (mode === "storage") return await exportStorage(config);
	if (mode === "deck")    return await exportDeck(config);
	if (mode === "all")     return await exportAllStorage(config);
}
