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
		name: "Sorcery Deck Creator",
		options: {},
	},
};

let QuickAdd;

const logAction = (config, message) => S.logAction(config, message);

async function start(params) {
	S = await loadShared();
	QuickAdd = params;
	const config = await S.loadConfig();
	const decksDir = config.decksDir || "decks";

	const deckName = await QuickAdd.quickAddApi.inputPrompt("Deck name:");
	if (!deckName) return;

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

	let avatar = "";
	if (avatarNames.length) {
		const NONE = "(None)";
		const choice = await QuickAdd.quickAddApi.suggester(
			[NONE, ...avatarNames],
			[NONE, ...avatarNames],
		);
		if (choice === null || choice === undefined) return;
		if (choice !== NONE) avatar = choice;
	} else {
		const typed = await QuickAdd.quickAddApi.inputPrompt("Avatar card name (leave blank for none):");
		if (typed === null || typed === undefined) return;
		avatar = typed;
	}

	const safeName =
		String(deckName)
			.replace(/[\\/:*?"<>|]+/g, " - ")
			.trim() || deckName;
	const filePath = S.vaultPath(config, `${decksDir}/${safeName}.md`);

	const existing = app.vault.getAbstractFileByPath(filePath);
	if (existing) {
		await app.workspace.getLeaf(false).openFile(existing);
		new Notice(`Already exists: ${deckName}`, 4000);
		return existing;
	}

	await S.ensureFolder(S.vaultPath(config, decksDir));

	const fm = [
		"---",
		"kind: sorcery-deck",
		"cssclasses:",
		"  - sorcery-flat-meta",
		`deckName: ${JSON.stringify(deckName)}`,
	];

	fm.push(`avatar: ${JSON.stringify(avatar || "")}`);
	fm.push("deckSpells: []");
	fm.push("deckSites: []");
	fm.push("deckCollection: []");
	fm.push("---", "");

	const content = [
		...fm,
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
	].join("\n");

	const file = await app.vault.create(filePath, content);
	await app.workspace.getLeaf(false).openFile(file);
	S.refreshDataview();
	await logAction(config, `Deck "${deckName}": created${avatar ? ` (avatar: ${avatar})` : ""}`);
	new Notice(`Created deck: ${deckName}`, 4000);
	return file;
}
