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
		name: "Sort Cards and Artists",
		options: {},
	},
};

async function start(params) {
	S = await loadShared();
	void params;
	const config = await S.loadConfig();

	const manualSortPath = S.vaultPath(
		config,
		".obsidian/plugins/manual-sorting/data.json",
	);
	const raw = await app.vault.adapter.read(manualSortPath);
	const data = JSON.parse(raw);
	const collator = new Intl.Collator(undefined, {
		numeric: true,
		sensitivity: "base",
	});

	const sortFolder = async (folder) => {
		const relFolder = S.vaultPath(config, folder);
		const listed = await app.vault.adapter.list(relFolder);
		const entries = [
			...listed.folders.map((p) => p.split("/").pop()),
			...listed.files.map((p) => p.split("/").pop()),
		]
			.filter((name) => !name.startsWith("."))
			.map((name) => ({ name, path: `${folder}/${name}`, isIndex: name === "index.md" }))
			.sort((a, b) => collator.compare(a.name, b.name));
		const index = entries.find((e) => e.isIndex);
		const others = entries.filter((e) => !e.isIndex);
		return index
			? [index.path, ...others.map((e) => e.path)]
			: others.map((e) => e.path);
	};

	data.customOrder = data.customOrder || {};
	for (const folder of ["cards", "artists"]) {
		const children = await sortFolder(folder);
		data.customOrder[folder] = {
			...(data.customOrder[folder] || {}),
			children,
			sortOrder: "custom",
		};
	}

	await app.vault.adapter.write(
		manualSortPath,
		JSON.stringify(data, null, 2) + "\n",
	);
	new Notice("Sorted cards and artists A–Z", 4000);
	return { updated: ["cards", "artists"], manualSortPath };
}
