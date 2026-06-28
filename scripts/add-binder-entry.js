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
		name: "Sorcery Binder Entry Creator",
		options: {},
	},
};

let QuickAdd;

const logAction = (config, message) => S.logAction(config, message);

async function start(params) {
	S = await loadShared();
	QuickAdd = params;
	const config = await S.loadConfig();
	let binderName = await QuickAdd.quickAddApi.inputPrompt("Storage name:");
	if (!binderName) return;

	const storageTypeChoice = await QuickAdd.quickAddApi.suggester(
		["Binder", "Box"],
		["binder", "box"],
	);
	if (!storageTypeChoice) return;
	const isBox = storageTypeChoice === "box";

	const slots = isBox
		? null
		: Math.max(
				1,
				Number(
					(await QuickAdd.quickAddApi.inputPrompt("Slots per page:", "9")) ||
						"9",
				),
			);
	const pages = isBox
		? null
		: Math.max(
				1,
				Number((await QuickAdd.quickAddApi.inputPrompt("Pages:", "1")) || "1"),
			);
	// Resolve name collisions: if a storage with this name already exists, use
	// the next available name (e.g. "Alpha" → "Alpha1") instead of bailing.
	const requested = String(binderName);
	const finalName = S.nextAvailableStorageName(config, requested);
	if (finalName !== requested)
		new Notice(`"${requested}" already exists — creating "${finalName}" instead.`, 5000);
	binderName = finalName;
	const safeName =
		finalName.replace(/[\\/:*?"<>|]+/g, " - ").trim() || finalName;
	const filePath = S.vaultPath(config, `${config.bindersDir}/${safeName}.md`);

	const totalSlots = isBox ? null : slots * pages;
	const frontmatter = [
		"---",
		"kind: sorcery-storage",
		"cssclasses:",
		"  - sorcery-flat-meta",
		`binderName: ${JSON.stringify(binderName)}`,
		`storageType: ${storageTypeChoice}`,
	];
	if (!isBox) {
		frontmatter.push(`slotsPerPage: ${slots}`);
		frontmatter.push(`pages: ${pages}`);
		frontmatter.push(`totalSlots: ${totalSlots}`);
	}
	frontmatter.push("---", "");
	const content = [
		...frontmatter,
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
		"await S.renderBinder(dv);",
		"```",
		"",
	].join("\n");

	const file = await app.vault.create(filePath, content);
	await app.workspace.getLeaf(false).openFile(file);
	S.refreshDataview();
	const details = isBox ? "box" : `binder (${slots} slots × ${pages} pages = ${totalSlots} total)`;
	await logAction(config, `Storage "${binderName}": created as ${details}`);
	new Notice(`Created ${storageTypeChoice}: ${binderName}`, 4000);
	return file;
}
