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
		name: "Import Deck",
		options: {},
	},
};

let QuickAdd;

function parseCsv(content) {
	const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
	if (lines.length < 2) return null;
	// Row 0 is the deck identity (title, avatar); row 1 is the "card name,..." column
	// header; card rows follow.
	const titleCols = S.splitCsvLine(lines[0]);
	const deckName = titleCols[0]?.trim() || "";
	const avatar   = titleCols[1]?.trim() || "";
	const spells = [], sites = [], collection = [];
	const startIdx = /^card name\b/i.test(lines[1] || "") ? 2 : 1;
	for (let i = startIdx; i < lines.length; i++) {
		const cols = S.splitCsvLine(lines[i]);
		const cardName = cols[0]?.trim();
		const count    = parseInt(cols[1], 10);
		const notes    = cols[2]?.trim();
		if (!cardName || !Number.isInteger(count) || count <= 0) continue;
		const entry = { cardName, count };
		if (notes === "Spellbook")       spells.push(entry);
		else if (notes === "Atlas")      sites.push(entry);
		else if (notes === "Collection") collection.push(entry);
	}
	return { deckName, avatar, spells, sites, collection };
}

function toYamlList(entries) {
	if (!entries.length) return '[]';
	return '\n' + entries.map(e => `  - cardName: ${JSON.stringify(e.cardName)}\n    count: ${e.count}`).join('\n');
}

function buildDeckContent(deckName, avatar, spells, sites, collection) {
	const fm = [
		"---",
		"kind: sorcery-deck",
		"cssclasses:",
		"  - sorcery-flat-meta",
		`deckName: ${JSON.stringify(deckName)}`,
		`avatar: ${JSON.stringify(avatar)}`,
		`deckSpells: ${toYamlList(spells)}`,
		`deckSites: ${toYamlList(sites)}`,
		`deckCollection: ${toYamlList(collection)}`,
		"---",
		"",
	];
	const body = [
		"```dataviewjs",
		"async function loadSorceryShared() {",
		"  if (globalThis.SorceryTrackerShared) return globalThis.SorceryTrackerShared;",
		"  for (const p of ['scripts/sorcery-shared.js', 'Sorcery Tracker/scripts/sorcery-shared.js']) {",
		"    try { const raw = await app.vault.adapter.read(p); (0, eval)(raw); return globalThis.SorceryTrackerShared; } catch {}",
		"  }",
		"  throw new Error('Missing sorcery-shared.js');",
		"}",
		"",
		"const S = await loadSorceryShared();",
		"await S.renderDeck(dv);",
		"```",
		"",
	];
	return [...fm, ...body].join("\n");
}

const logAction = (config, message) => S.logAction(config, message);
const refreshDataview = (hint) => S.refreshDataview(hint);
const buildRefreshHint = (config, opts) => S.buildRefreshHint(config, opts);

async function start(params) {
	S = await loadShared();
	QuickAdd = params;
	const config = await S.loadConfig();

	const csvFiles = app.vault.getFiles().filter(f => f.extension === "csv" && f.name.startsWith("deck-"));
	const allCsvFiles = app.vault.getFiles().filter(f => f.extension === "csv");
	const candidates = csvFiles.length ? csvFiles : allCsvFiles;

	if (!candidates.length) {
		new Notice("No CSV files found in vault. Place your deck export CSV in the vault first.", 6000);
		return;
	}

	const csvFile = await QuickAdd.quickAddApi.suggester(
		candidates.map(f => f.name),
		candidates,
		"Choose deck CSV to import",
	);
	if (!csvFile) return;

	const content = await app.vault.adapter.read(csvFile.path);
	const parsed = parseCsv(content);
	if (!parsed) {
		new Notice("CSV appears empty or invalid.", 4000);
		return;
	}

	const { deckName, avatar, spells, sites, collection } = parsed;
	if (!deckName) {
		new Notice("CSV does not contain a deck name. Re-export the deck to get an updated CSV.", 6000);
		return;
	}

	const resolvedName = S.nextAvailableNoteName(config, config.decksDir || "decks", deckName);
	const safeName = resolvedName.replace(/[\\/:*?"<>|]+/g, " - ").trim();
	const decksDir = config.decksDir || "decks";
	const filePath = S.vaultPath(config, `${decksDir}/${safeName}.md`);

	await S.ensureFolder(S.vaultPath(config, decksDir));
	const file = await app.vault.create(filePath, buildDeckContent(resolvedName, avatar, spells, sites, collection));
	await app.workspace.getLeaf(false).openFile(file);
	refreshDataview(await buildRefreshHint(config, { decks: [resolvedName] }));

	const summary = `${spells.length} spells, ${sites.length} sites, ${collection.length} collection` +
		(avatar ? `, avatar: ${avatar}` : "");
	new Notice(`Imported deck "${resolvedName}" — ${summary}`, 6000);
	await logAction(config, `Imported deck "${resolvedName}" from "${csvFile.name}" (${summary})`);
}
