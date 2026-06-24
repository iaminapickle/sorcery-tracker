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
		name: "Sorcery Deck Manager",
		options: {},
	},
};

let QuickAdd;

const logAction = (config, message) => S.logAction(config, message);
const refreshDataview = () => S.refreshDataview();

// Deck zones. Maybeboard mirrors the main zones under deckMaybe* keys.
const ZONE_LABELS = { deckSpells: "Spellbook", deckSites: "Atlas", deckCollection: "Collection" };
const MAYBE_ZONE_LABELS = { deckMaybeSpells: "Spellbook", deckMaybeSites: "Atlas", deckMaybeCollection: "Collection" };
const ZONE_TYPES = {
	deckSpells: ["Artifact", "Aura", "Magic", "Minion"],
	deckSites: ["Site"],
	deckCollection: null,
};
const MAYBE_ZONE_TYPES = {
	deckMaybeSpells: ["Artifact", "Aura", "Magic", "Minion"],
	deckMaybeSites: ["Site"],
	deckMaybeCollection: null,
};

// Register the cache listener BEFORE the write so we never miss the event,
// then await it before triggering rerender — guarantees Dataview has processed
// the file change and dv.current() is fresh when the deck page rerenders.
function waitForCache(filePath) {
	return new Promise((resolve) => {
		const timeout = setTimeout(resolve, 500);
		const ref = app.metadataCache.on("changed", (file) => {
			if (file.path === filePath) {
				clearTimeout(timeout);
				app.metadataCache.offref(ref);
				resolve();
			}
		});
	});
}

async function chooseDeck(config) {
	// Pre-selected from renderDeck buttons; consume and clear here
	const preselect = globalThis.__sorceryDeckPreselect;
	globalThis.__sorceryDeckPreselect = null;
	if (preselect?.path) {
		const file = app.vault.getAbstractFileByPath(preselect.path);
		if (file) return file;
	}

	const decksDir = config.decksDir || "decks";
	const prefix = S.vaultPath(config, decksDir) + "/";
	const deckFiles = app.vault.getMarkdownFiles().filter((f) => {
		if (!f.path.startsWith(prefix) && !f.path.startsWith(`${decksDir}/`))
			return false;
		const fm = app.metadataCache.getFileCache(f)?.frontmatter;
		return fm?.kind === "sorcery-deck";
	});
	if (!deckFiles.length) {
		new Notice("No decks found. Create one first with the Deck Creator.", 4000);
		return null;
	}
	const labels = deckFiles.map((f) => {
		const fm = app.metadataCache.getFileCache(f)?.frontmatter;
		return String(fm?.deckName || f.basename);
	});
	return QuickAdd.quickAddApi.suggester(labels, deckFiles);
}

async function start(params) {
	S = await loadShared();
	QuickAdd = params;
	const config = await S.loadConfig();

	// Read mode from preselect (path is consumed later in chooseDeck)
	const preselect = globalThis.__sorceryDeckPreselect;

	let mode;
	if (preselect?.mode) {
		mode = preselect.mode;
	} else {
		mode = await QuickAdd.quickAddApi.suggester(
			["Add Card", "Remove Card", "Add Maybeboard", "Remove Maybeboard", "Clear Deck", "Edit Deck", "Delete Deck"],
			["add", "remove", "maybeboard-add", "maybeboard-remove", "clear", "edit", "delete"],
		);
	}
	if (!mode) return;

	if (mode === "add") return await handleAdd(config);
	if (mode === "remove") return await handleRemove(config);
	if (mode === "maybeboard-add") return await handleMaybeAdd(config);
	if (mode === "maybeboard-remove") return await handleMaybeRemove(config);
	if (mode === "clear") return await handleClear(config);
	if (mode === "edit") return await handleEdit(config);
	if (mode === "delete") return await handleDelete(config);
}

async function handleAdd(config) {
	const deckFile = await chooseDeck(config);
	if (!deckFile) return;

	const zone = await QuickAdd.quickAddApi.suggester(
		["Spellbook", "Atlas", "Collection"],
		["deckSpells", "deckSites", "deckCollection"],
	);
	if (!zone) return;

	const typeOpts = ZONE_TYPES[zone] ? { types: ZONE_TYPES[zone] } : {};
	const variant = await S.chooseVariant(
		config,
		(labels, values) => QuickAdd.quickAddApi.suggester(labels, values),
		"", "", { ...typeOpts, columns: ["cardName", "type"] },
	);
	if (!variant) return;
	const cardName = variant.cardName;

	const countStr = await QuickAdd.quickAddApi.inputPrompt("Count:", "1", "1");
	if (countStr === null || countStr === undefined) return;
	const count = Math.max(1, Number(countStr) || 1);

	const cacheReady = waitForCache(deckFile.path);
	await app.fileManager.processFrontMatter(deckFile, (fm) => {
		if (!Array.isArray(fm[zone])) fm[zone] = [];
		const existing = fm[zone].find((e) => e?.cardName === cardName);
		if (existing) existing.count = Number(existing.count || 0) + count;
		else fm[zone].push({ cardName, count });
	});
	const deckName = String(app.metadataCache.getFileCache(deckFile)?.frontmatter?.deckName || deckFile.basename);
	new Notice(`Added ${count}× ${cardName} to ${ZONE_LABELS[zone]}`, 3000);
	await cacheReady;
	await logAction(config, `Deck "${deckName}": added ${count}× ${cardName} to ${ZONE_LABELS[zone]}`);
	refreshDataview();
}

async function handleMaybeAdd(config) {
	const deckFile = await chooseDeck(config);
	if (!deckFile) return;

	const zone = await QuickAdd.quickAddApi.suggester(
		["Spellbook", "Atlas", "Collection"],
		["deckMaybeSpells", "deckMaybeSites", "deckMaybeCollection"],
	);
	if (!zone) return;

	const typeOpts = MAYBE_ZONE_TYPES[zone] ? { types: MAYBE_ZONE_TYPES[zone] } : {};
	const variant = await S.chooseVariant(
		config,
		(labels, values) => QuickAdd.quickAddApi.suggester(labels, values),
		"", "", { ...typeOpts, columns: ["cardName", "type"] },
	);
	if (!variant) return;
	const cardName = variant.cardName;

	const countStr = await QuickAdd.quickAddApi.inputPrompt("Count:", "1", "1");
	if (countStr === null || countStr === undefined) return;
	const count = Math.max(1, Number(countStr) || 1);

	const cacheReady = waitForCache(deckFile.path);
	await app.fileManager.processFrontMatter(deckFile, (fm) => {
		if (!Array.isArray(fm[zone])) fm[zone] = [];
		const existing = fm[zone].find((e) => e?.cardName === cardName);
		if (existing) existing.count = Number(existing.count || 0) + count;
		else fm[zone].push({ cardName, count });
	});
	const deckName = String(app.metadataCache.getFileCache(deckFile)?.frontmatter?.deckName || deckFile.basename);
	new Notice(`Added ${count}× ${cardName} to Maybeboard (${MAYBE_ZONE_LABELS[zone]})`, 3000);
	await cacheReady;
	await logAction(config, `Deck "${deckName}": added ${count}× ${cardName} to Maybeboard (${MAYBE_ZONE_LABELS[zone]})`);
	refreshDataview();
}

async function handleMaybeRemove(config) {
	const deckFile = await chooseDeck(config);
	if (!deckFile) return;

	const zone = await QuickAdd.quickAddApi.suggester(
		["Spellbook", "Atlas", "Collection"],
		["deckMaybeSpells", "deckMaybeSites", "deckMaybeCollection"],
	);
	if (!zone) return;

	const fm = app.metadataCache.getFileCache(deckFile)?.frontmatter || {};
	const entries = Array.isArray(fm[zone]) ? fm[zone] : [];
	const names = entries.map((e) => String(e?.cardName || "")).filter(Boolean);
	if (!names.length) {
		new Notice(`No cards in Maybeboard (${MAYBE_ZONE_LABELS[zone]}) to remove.`, 3000);
		return;
	}

	const chosen = await S.withStyledSuggestions(() =>
		QuickAdd.quickAddApi.suggester(names, names),
	);
	if (!chosen) return;

	const countStr = await QuickAdd.quickAddApi.inputPrompt("Quantity to remove:", "1", "1");
	if (countStr === null || countStr === undefined) return;
	const qty = Math.max(1, Number(countStr) || 1);

	const cacheReady = waitForCache(deckFile.path);
	await app.fileManager.processFrontMatter(deckFile, (fm) => {
		if (!Array.isArray(fm[zone])) return;
		const idx = fm[zone].findIndex((e) => e?.cardName === chosen);
		if (idx < 0) return;
		const next = Number(fm[zone][idx].count || 0) - qty;
		if (next <= 0) fm[zone] = fm[zone].filter((e) => e?.cardName !== chosen);
		else fm[zone][idx] = { ...fm[zone][idx], count: next };
	});
	const deckName = String(app.metadataCache.getFileCache(deckFile)?.frontmatter?.deckName || deckFile.basename);
	new Notice(`Removed ${qty}× ${chosen} from Maybeboard (${MAYBE_ZONE_LABELS[zone]})`, 3000);
	await cacheReady;
	await logAction(config, `Deck "${deckName}": removed ${qty}× ${chosen} from Maybeboard (${MAYBE_ZONE_LABELS[zone]})`);
	refreshDataview();
}

async function handleRemove(config) {
	const deckFile = await chooseDeck(config);
	if (!deckFile) return;

	const zone = await QuickAdd.quickAddApi.suggester(
		["Spellbook", "Atlas", "Collection"],
		["deckSpells", "deckSites", "deckCollection"],
	);
	if (!zone) return;

	const fm = app.metadataCache.getFileCache(deckFile)?.frontmatter || {};
	const entries = Array.isArray(fm[zone]) ? fm[zone] : [];
	const names = entries.map((e) => String(e?.cardName || "")).filter(Boolean);
	if (!names.length) {
		new Notice(`No cards in ${ZONE_LABELS[zone]} to remove.`, 3000);
		return;
	}

	const chosen = await S.withStyledSuggestions(() =>
		QuickAdd.quickAddApi.suggester(names, names),
	);
	if (!chosen) return;

	const countStr = await QuickAdd.quickAddApi.inputPrompt("Quantity to remove:", "1", "1");
	if (countStr === null || countStr === undefined) return;
	const qty = Math.max(1, Number(countStr) || 1);

	const cacheReady = waitForCache(deckFile.path);
	await app.fileManager.processFrontMatter(deckFile, (fm) => {
		if (!Array.isArray(fm[zone])) return;
		const idx = fm[zone].findIndex((e) => e?.cardName === chosen);
		if (idx < 0) return;
		const next = Number(fm[zone][idx].count || 0) - qty;
		if (next <= 0) fm[zone] = fm[zone].filter((e) => e?.cardName !== chosen);
		else fm[zone][idx] = { ...fm[zone][idx], count: next };
	});
	const deckName = String(app.metadataCache.getFileCache(deckFile)?.frontmatter?.deckName || deckFile.basename);
	new Notice(`Removed ${qty}× ${chosen} from ${ZONE_LABELS[zone]}`, 3000);
	await cacheReady;
	await logAction(config, `Deck "${deckName}": removed ${qty}× ${chosen} from ${ZONE_LABELS[zone]}`);
	refreshDataview();
}

async function handleClear(config) {
	const deckFile = await chooseDeck(config);
	if (!deckFile) return;
	const fm = app.metadataCache.getFileCache(deckFile)?.frontmatter || {};
	const deckName = String(fm.deckName || deckFile.basename);

	const confirm = await QuickAdd.quickAddApi.inputPrompt(
		`Type "clear" to wipe all cards from "${deckName}":`,
		"",
		"",
	);
	if (confirm === null || confirm === undefined) return;
	if (confirm.trim().toLowerCase() !== "clear") {
		new Notice(`Cancelled — type "clear" to confirm.`, 3000);
		return;
	}

	const cacheReady = waitForCache(deckFile.path);
	await app.fileManager.processFrontMatter(deckFile, (fm) => {
		fm.deckSpells = [];
		fm.deckSites = [];
		fm.deckCollection = [];
		fm.deckMaybeSpells = [];
		fm.deckMaybeSites = [];
		fm.deckMaybeCollection = [];
	});
	new Notice(`Cleared all cards from "${deckName}"`, 4000);
	await cacheReady;
	await logAction(config, `Deck "${deckName}": cleared all cards`);
	refreshDataview();
}

async function handleEdit(config) {
	const deckFile = await chooseDeck(config);
	if (!deckFile) return;
	const fm = app.metadataCache.getFileCache(deckFile)?.frontmatter || {};

	const newName = await QuickAdd.quickAddApi.inputPrompt(
		"Deck name:",
		"",
		String(fm.deckName || deckFile.basename),
	);
	if (newName === null || newName === undefined) return;

	const apiSource = await S.readJsonByCandidates([
		`${config.dataDir}/${config.apiFile}`,
		`data/${config.apiFile}`,
	]);
	const apiCards = apiSource?.data || [];
	const avatarNames = [
		...new Set(
			apiCards
				.filter((c) => c.guardian?.type === "Avatar")
				.map((c) => c.name),
		),
	].sort();
	const currentAvatar = String(fm.avatar || "");

	let avatar = currentAvatar;
	if (avatarNames.length) {
		const NONE = "(None)";
		const choices = [NONE, ...avatarNames];
		const choice = await QuickAdd.quickAddApi.suggester(choices, choices);
		if (choice === null || choice === undefined) return;
		avatar = choice === NONE ? "" : choice;
	} else {
		const typed = await QuickAdd.quickAddApi.inputPrompt(
			"Avatar card name (leave blank for none):",
			"",
			currentAvatar,
		);
		if (typed === null || typed === undefined) return;
		avatar = typed;
	}

	const oldName = String(fm.deckName || deckFile.basename);
	const finalName = newName.trim() || oldName;
	const cacheReady = waitForCache(deckFile.path);
	await app.fileManager.processFrontMatter(deckFile, (fm) => {
		if (newName.trim()) fm.deckName = newName.trim();
		fm.avatar = avatar;
	});
	new Notice(`Updated deck "${finalName}"`, 4000);
	await cacheReady;
	const editParts = [];
	if (finalName !== oldName) editParts.push(`renamed to "${finalName}"`);
	if (avatar !== currentAvatar) editParts.push(`avatar → ${avatar || "none"}`);
	if (editParts.length) await logAction(config, `Deck "${oldName}": ${editParts.join(", ")}`);
	refreshDataview();
}

async function handleDelete(config) {
	const deckFile = await chooseDeck(config);
	if (!deckFile) return;
	const fm = app.metadataCache.getFileCache(deckFile)?.frontmatter || {};
	const deckName = String(fm.deckName || deckFile.basename);

	const confirm = await QuickAdd.quickAddApi.inputPrompt(
		`Type "delete" to permanently delete "${deckName}":`,
		"",
		"",
	);
	if (confirm === null || confirm === undefined) return;
	if (confirm.trim().toLowerCase() !== "delete") {
		new Notice(`Cancelled — type "delete" to confirm.`, 3000);
		return;
	}

	await app.fileManager.processFrontMatter(deckFile, (fm) => {
		fm.deckSpells = [];
		fm.deckSites = [];
		fm.deckCollection = [];
	});
	await logAction(config, `Deck "${deckName}": deleted`);
	await app.vault.delete(deckFile);
	new Notice(`Deleted deck "${deckName}"`, 4000);
	refreshDataview();
}
