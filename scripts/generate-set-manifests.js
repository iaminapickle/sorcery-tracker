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
		name: "Sorcery Set Manifest Generator",
		options: {},
	},
};

async function start(_params) {
	S = await loadShared();
	const config = await S.loadConfig();
	const sourceCandidates = [
		`${config.dataDir}/${config.apiFile}`,
		`data/${config.apiFile}`,
		S.vaultPath(config, `${config.dataDir}/${config.apiFile}`),
	];
	try {
		await S.ensureFolder(S.vaultPath(config, config.dataDir));
		const source = await S.readJsonByCandidates(sourceCandidates);
		if (!source) throw new Error(`Missing source file: ${config.apiFile}`);
		const manifests = S.buildSetManifests(source.data);
		const manifestSetNames = [...new Set(Object.keys(manifests))];
		const configuredSetOrder = Array.isArray(config.setOrder)
			? config.setOrder
			: S.DEFAULT_CONFIG.setOrder;
		const setOrder = [
			...configuredSetOrder.filter((name) => manifestSetNames.includes(name)),
			...manifestSetNames
				.filter((name) => !configuredSetOrder.includes(name))
				.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
		];
		const costs = [
			...new Set(
				source.data
					.map((card) => card?.guardian?.cost)
					.filter((cost) => cost !== undefined && cost !== null && cost !== ""),
			),
		]
			.map((cost) => Number(cost))
			.filter((cost) => Number.isFinite(cost))
			.sort((a, b) => a - b);
		const configuredCostOrder = Array.isArray(config.costOrder)
			? config.costOrder
			: S.DEFAULT_CONFIG.costOrder;
		const costOrder = [
			...configuredCostOrder.filter((cost) => costs.includes(cost)),
			...costs.filter((cost) => !configuredCostOrder.includes(cost)),
		];
		const outPath = S.vaultPath(
			config,
			`${config.dataDir}/${config.manifestFile}`,
		);
		await app.vault.adapter.write(
			outPath,
			JSON.stringify(manifests, null, 2) + "\n",
		);
		const configPath = S.vaultPath(config, `${config.dataDir}/config.json`);
		await app.vault.adapter.write(
			configPath,
			JSON.stringify({ ...config, setOrder, costOrder }, null, 2) + "\n",
		);
		S.invalidateConfigCache?.();
		new Notice(
			`Generated set manifests for ${Object.keys(manifests).length} sets`,
			4000,
		);
		return manifests;
	} catch (err) {
		new Notice(`Set manifest generation failed: ${err.message}`, 8000);
		throw err;
	}
}
