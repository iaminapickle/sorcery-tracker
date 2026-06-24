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
		name: "Import Storage",
		options: {},
	},
};

let QuickAdd;

const logAction = (config, message) => S.logAction(config, message);
const refreshDataview = () => S.refreshDataview();

async function start(params) {
	S = await loadShared();
	QuickAdd = params;
	const config = await S.loadConfig();

	const allCsv = app.vault.getFiles().filter(f => f.extension === "csv");
	const storageCsv = allCsv.filter(f => /^(binder|box|storage)-.*-export\.csv$/.test(f.name));
	const candidates = storageCsv.length ? storageCsv : allCsv;

	if (!candidates.length) {
		new Notice("No CSV files found in vault. Place your storage export CSV in the vault first.", 6000);
		return;
	}

	const csvFile = await QuickAdd.quickAddApi.suggester(
		candidates.map(f => f.name),
		candidates,
		"Choose storage CSV to import",
	);
	if (!csvFile) return;

	const content = await app.vault.adapter.read(csvFile.path);
	const parsed = S.parseStorageCsv(content);
	if (!parsed?.rows.length) {
		new Notice("CSV appears empty or has no valid rows.", 4000);
		return;
	}

	const { rows, storageName } = parsed;
	if (!storageName) {
		new Notice("CSV does not contain a storage name. Re-export the storage to get an updated CSV.", 6000);
		return;
	}
	const trimmedBox = S.nextAvailableNoteName(config, config.bindersDir, storageName);

	await S.ensureStorageBox(config, trimmedBox);

	const index = await S.buildVariantIndex(config);
	const fileUpdates = new Map();
	const notFound = [];

	for (const row of rows) {
		const match = S.findVariant(index, row);
		if (!match || !match.summaryFile) {
			notFound.push(`${row.cardName} (${row.setName}, ${row.finish}, ${row.product})`);
			continue;
		}
		const path = match.summaryFile.path;
		if (!fileUpdates.has(path)) fileUpdates.set(path, { file: match.summaryFile, updates: [] });
		fileUpdates.get(path).updates.push({
			slug: match.slug,
			foil: row.finish.toLowerCase() === "foil",
			quantity: row.quantity,
		});
	}

	let added = 0;
	for (const { file, updates } of fileUpdates.values()) {
		await app.fileManager.processFrontMatter(file, fm => {
			for (const { slug, foil, quantity } of updates)
				S.addPlacementToOwnership(fm, slug, trimmedBox, quantity, foil);
		});
		added += updates.length;
	}

	refreshDataview();

	const summary = `Imported ${added} card type${added !== 1 ? "s" : ""} into "${trimmedBox}"` +
		(notFound.length ? ` · ${notFound.length} not found` : "");
	new Notice(summary, 6000);

	if (notFound.length) {
		const reportPath = `${S.vaultPath(config, config.dataDir)}/import-not-found.md`;
		await app.vault.adapter.write(reportPath,
			`# Import not found — ${trimmedBox}\n\n` + notFound.map(n => `- ${n}`).join("\n") + "\n");
		new Notice(`${notFound.length} card${notFound.length !== 1 ? "s" : ""} not found — see data/import-not-found.md`, 6000);
	}

	await logAction(config, `Imported ${added} card types from "${csvFile.name}" into box "${trimmedBox}"` +
		(notFound.length ? ` (${notFound.length} not found)` : ""));
}
