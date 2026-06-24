let S;
async function sharedReady() {
	if (S) return;
	if (globalThis.SorceryTrackerShared) { S = globalThis.SorceryTrackerShared; return; }
	const candidates = ['scripts/sorcery-shared.js', 'Sorcery Tracker/scripts/sorcery-shared.js'];
	const p = candidates.find(c => app.vault.getAbstractFileByPath(c));
	if (!p) throw new Error('Missing sorcery-shared.js');
	const raw = await app.vault.adapter.read(p);
	(0, eval)(raw);
	S = globalThis.SorceryTrackerShared;
}

const REPORT_PATHS = [
	"data/sync-report.md",
	"Sorcery Tracker/data/sync-report.md",
];

function cleanText(value) {
	return String(value ?? "")
		.replace(/\r\n/g, "\n")
		.replace(/[ \t]+$/gm, "");
}

function normalizeBlockText(value) {
	return cleanText(value).replace(/\n+$/g, "");
}

function isMeaningfulToken(value) {
	const token = cleanText(value).trim();
	return Boolean(token) && !/^(none|null|undefined)$/i.test(token);
}

function splitList(value) {
	if (Array.isArray(value))
		return value.map((v) => cleanText(v).trim()).filter(isMeaningfulToken);
	if (value === undefined || value === null || value === "") return [];
	const token = cleanText(value).trim();
	if (!isMeaningfulToken(token)) return [];
	return token
		.split(",")
		.map((v) => v.trim())
		.filter(isMeaningfulToken);
}

function normalizeArray(value) {
	return splitList(value);
}

function yamlScalar(value) {
	if (value === undefined || value === null || value === "") return null;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	return JSON.stringify(cleanText(value));
}

function yamlArray(values, indent = "  ") {
	const out = [];
	for (const v of values || []) out.push(`${indent}- ${yamlScalar(v)}`);
	return out.join("\n");
}

function yamlBlockString(value, indent = "  ") {
	const text = normalizeBlockText(value);
	if (!text) return null;
	return `${indent}|-\n${text
		.split("\n")
		.map((line) => `${indent}  ${line}`)
		.join("\n")}`;
}

function makeFrontmatter(fields) {
	const lines = ["---"];
	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined || value === null || value === "") continue;
		if (Array.isArray(value)) {
			if (!value.length) continue;
			lines.push(`${key}:`);
			lines.push(yamlArray(value));
			continue;
		}
		if (
			typeof value === "object" &&
			value &&
			value.__blockString !== undefined
		) {
			const block = yamlBlockString(value.__blockString);
			if (block)
				lines.push(
					`${key}: |-\n${cleanText(value.__blockString)
						.split("\n")
						.map((line) => `  ${line}`)
						.join("\n")}`,
				);
			continue;
		}
		if (typeof value === "string" && value.includes("\n")) {
			lines.push(`${key}: |-`);
			lines.push(
				...cleanText(value)
					.split("\n")
					.map((line) => `  ${line}`),
			);
			continue;
		}
		const scalar = yamlScalar(value);
		if (scalar !== null) lines.push(`${key}: ${scalar}`);
	}
	lines.push("---");
	return lines.join("\n");
}

function normalizeFrontmatterMap(fm = {}) {
	const out = {};
	for (const [key, value] of Object.entries(fm || {})) {
		if (key === "cssclasses") {
			out[key] = normalizeArray(value);
			continue;
		}
		if (key === "subTypes" || key === "elements" || key === "setNames") {
			out[key] = normalizeArray(value);
			continue;
		}
		if (key === "rules") {
			out[key] = normalizeBlockText(value);
		} else if (typeof value === "string") {
			out[key] = cleanText(value);
		} else if (typeof value === "number" || typeof value === "boolean") {
			out[key] = value;
		} else if (Array.isArray(value)) {
			out[key] = value.map((v) => cleanText(v));
		} else {
			out[key] = value;
		}
	}
	return out;
}

function isEmptyComparable(value) {
	if (value === undefined || value === null || value === "") return true;
	if (Array.isArray(value)) return normalizeArray(value).length === 0;
	if (typeof value === "string") return !isMeaningfulToken(value);
	return false;
}

function valuesEqual(expected, actual) {
	if (isEmptyComparable(expected)) {
		return isEmptyComparable(actual);
	}
	if (Array.isArray(expected) || Array.isArray(actual)) {
		const e = normalizeArray(expected).slice().sort();
		const a = normalizeArray(actual).slice().sort();
		return JSON.stringify(e) === JSON.stringify(a);
	}
	if (typeof expected === "number" || typeof actual === "number") {
		return Number(expected) === Number(actual);
	}
	return cleanText(expected) === cleanText(actual);
}

function diffFrontmatter(expected, actual, fields) {
	const diffs = [];
	const act = normalizeFrontmatterMap(actual || {});
	for (const field of fields) {
		const e = expected[field];
		const a = act[field];
		if (!valuesEqual(e, a)) diffs.push({ field, have: a, expect: e });
	}
	return diffs;
}

async function loadConfig() {
	await sharedReady();
	return await S.loadConfig();
}

async function loadApiCards(config) {
	await sharedReady();
	const source = await S.readJsonByCandidates([
		`${config.dataDir}/${config.apiFile}`,
		`data/${config.apiFile}`,
		S.vaultPath(config, `${config.dataDir}/${config.apiFile}`),
	]);
	if (!source) throw new Error(`Missing source file: ${config.apiFile}`);
	return source.data;
}

function setNamesForCard(card, config) {
	const order = config.setOrder || [];
	const names = [
		...new Set((card.sets || []).map((s) => s?.name).filter(Boolean)),
	];
	names.sort((a, b) => {
		const ai = order.indexOf(a);
		const bi = order.indexOf(b);
		if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
		return a.localeCompare(b);
	});
	return names;
}

function expectedSummary(card, config) {
	return {
		kind: "sorcery-card-summary",
		cssclasses: ["sorcery-flat-meta"],
		cardName: card.name,
		setNames: setNamesForCard(card, config),
	};
}

function expectedSetPage(setName) {
	return {
		kind: "sorcery-dashboard",
		setName,
		cssclasses: ["sorcery-dashboard", "centered-note"],
	};
}

function frontmatterFromNote(file) {
	return app.metadataCache.getFileCache(file)?.frontmatter || {};
}

// Flat card-note path (cards/[Name].md).
function expectedSummaryPath(config, cardName) {
	return S.vaultPath(config, `${config.cardsDir}/${cardName}.md`);
}

function expectedSetPagePath(config, setName) {
	return S.vaultPath(config, `sets/${setName}.md`);
}

function renderDiffReport(result) {
	const lines = [];
	lines.push("# Sorcery API Sync Report");
	lines.push("");
	lines.push(`- Mismatches: ${result.mismatches.length}`);
	lines.push(`- Missing notes: ${result.missing.length}`);
	lines.push("");
	if (result.mismatches.length) {
		lines.push("## Mismatches");
		for (const item of result.mismatches) {
			lines.push(`### ${item.type}: ${item.label}`);
			lines.push(`- Path: ${item.path}`);
			lines.push("");
			lines.push("| Field | Card | API |");
			lines.push("| --- | --- | --- |");
			for (const diff of item.diffs) {
				lines.push(
					`| ${diff.field} | ${formatValue(diff.have)} | ${formatValue(diff.expect)} |`,
				);
			}
			lines.push("");
		}
	}
	if (result.missing.length) {
		lines.push("## Missing");
		for (const item of result.missing) {
			lines.push(`- ${item.type}: ${item.label} → ${item.path}`);
		}
		lines.push("");
	}
	return lines.join("\n");
}

function formatValue(value) {
	if (value === undefined) return "`<missing>`";
	if (value === null) return "`null`";
	if (Array.isArray(value)) return "`" + JSON.stringify(value) + "`";
	const s = cleanText(value);
	if (!s) return "`<empty>`";
	return "`" + s.replace(/\|/g, "\\|").replace(/\n/g, "\\n") + "`";
}

async function writeReport(report) {
	const content = renderDiffReport(report);
	const target = S.vaultPath(report.config, REPORT_PATHS[0]);
	await S.ensureFolder(S.vaultPath(report.config, report.config.dataDir));
	await app.vault.adapter.write(target, content + "\n");
	return target;
}

async function validateApiSync() {
	await sharedReady();
	const config = await loadConfig();
	const cards = await loadApiCards(config);
	const report = {
		config,
		mismatches: [],
		missing: [],
		expected: {
			summaries: 0,
			variants: 0,
			sets: 0,
		},
	};

	const sets = new Set();
	const artists = new Set();
	for (const card of cards) {
		report.expected.summaries += 1;
		const summaryPath = expectedSummaryPath(config, card.name);
		const summaryFile = app.vault.getAbstractFileByPath(summaryPath);
		if (!summaryFile) {
			report.missing.push({
				type: "summary",
				label: card.name,
				path: summaryPath,
			});
		} else {
			const diffs = diffFrontmatter(
				expectedSummary(card, config),
				frontmatterFromNote(summaryFile),
				["kind", "cssclasses", "cardName", "setNames"],
			);
			if (diffs.length)
				report.mismatches.push({
					type: "summary",
					label: card.name,
					path: summaryPath,
					diffs,
				});
		}

		// Variant data is no longer materialized as per-printing notes — it's derived
		// from the API at render time, with ownership on the summary note. We only
		// collect set/artist names here for their note validation below.
		for (const set of card.sets || []) {
			sets.add(set.name);
			for (const variant of set.variants || []) {
				if (variant.artist) artists.add(variant.artist);
				report.expected.variants += 1;
			}
		}
	}

	report.expected.sets = sets.size;
	for (const setName of sets) {
		const setPath = expectedSetPagePath(config, setName);
		const setFile = app.vault.getAbstractFileByPath(setPath);
		const expected = expectedSetPage(setName);
		if (!setFile) {
			report.missing.push({
				type: "set page",
				label: setName,
				path: setPath,
			});
		} else {
			const diffs = diffFrontmatter(expected, frontmatterFromNote(setFile), [
				"kind",
				"setName",
				"cssclasses",
			]);
			if (diffs.length)
				report.mismatches.push({
					type: "set page",
					label: setName,
					path: setPath,
					diffs,
				});
		}
	}

	for (const artist of artists) {
		const artistPath = expectedArtistPath(config, artist);
		if (!app.vault.getAbstractFileByPath(artistPath)) {
			report.missing.push({
				type: "artist",
				label: artist,
				path: artistPath,
			});
		}
	}

	report.ok = report.mismatches.length === 0;
	report.reportPath = await writeReport(report);
	return report;
}

function dataviewJsBlock(callExpression) {
	return [
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
		callExpression,
		"```",
	].join("\n");
}

function generatedSummaryBody() {
	return dataviewJsBlock("await S.renderSummary(dv);");
}

function generatedSetBody() {
	return dataviewJsBlock("await S.renderSetPage(dv);");
}

function generatedArtistBody() {
	return dataviewJsBlock("await S.renderArtist(dv);");
}

function frontmatterText(fields) {
	return makeFrontmatter(fields);
}

function buildSummaryNote(card, config) {
	const expected = expectedSummary(card, config);
	return `${frontmatterText(expected)}\n${generatedSummaryBody()}\n`;
}

function buildSetPageNote(setName) {
	const fields = {
		kind: "sorcery-dashboard",
		setName,
		setMode: "base",
		playRowsAlign: "none",
		baseSlotsPerRow: 4,
		baseSpecialSlots: 0,
		playSlotsPerRow: 4,
		playSpecialSlots: 0,
		cssclasses: ["sorcery-dashboard", "centered-note"],
	};
	return `${frontmatterText(fields)}\n${generatedSetBody()}\n`;
}

function safeVaultSegment(value) {
	return (
		String(value ?? "")
			.replace(/[\\/:*?"<>|]+/g, " - ")
			.trim() || "Unknown"
	);
}

function expectedArtistPath(config, artistName) {
	const safe = safeVaultSegment(artistName);
	return S.vaultPath(config, `artists/${safe}.md`);
}

function buildArtistNote(artistName) {
	const fields = {
		kind: "sorcery-artist",
		cssclasses: ["sorcery-flat-meta"],
		artistName,
	};
	return `${frontmatterText(fields)}\n${generatedArtistBody()}\n`;
}

async function ensureGeneratedNote(
	path,
	content,
	allowRewriteExisting = false,
) {
	const file = app.vault.getAbstractFileByPath(path);
	if (!file) {
		await app.vault.create(path, content);
		return true;
	}
	if (!allowRewriteExisting) return false;
	const raw = await app.vault.adapter.read(path);
	if (raw.includes("```dataviewjs")) return false;
	await app.vault.modify(file, content);
	return true;
}

async function generateMissingSorceryNotes(onProgress) {
	await sharedReady();
	const config = await loadConfig();
	const validation = await validateApiSync();

	const cards = await loadApiCards(config);
	const totalVariants = cards.reduce(
		(n, c) => n + (c.sets || []).reduce((m, s) => m + (s.variants || []).length, 0),
		0,
	);
	let doneVariants = 0;
	let summaries = 0;
	let variants = 0;
	let setPages = 0;
	let artistPages = 0;
	const sets = new Set();
	const artists = new Set();

	await S.ensureFolder(S.vaultPath(config, config.cardsDir));
	for (const card of cards) {
		const summaryPath = expectedSummaryPath(config, card.name); // flat: cards/[Name].md
		// Create the flat note only when no card note exists yet.
		const exists = app.vault.getAbstractFileByPath(summaryPath);
		if (
			!exists &&
			(await ensureGeneratedNote(summaryPath, buildSummaryNote(card, config), true))
		)
			summaries += 1;

		// Variant notes are no longer generated — variant data is derived from the API
		// at render time, and ownership lives on the summary note. We only collect
		// set/artist names so their pages get created below.
		for (const set of card.sets || []) {
			sets.add(set.name);
			for (const variant of set.variants || []) {
				if (variant.artist) artists.add(variant.artist);
				doneVariants += 1;
				if (onProgress) onProgress(doneVariants, totalVariants, card.name);
			}
		}
	}

	await S.ensureFolder(S.vaultPath(config, "sets"));
	for (const setName of sets) {
		const pagePath = expectedSetPagePath(config, setName);
		if (await ensureGeneratedNote(pagePath, buildSetPageNote(setName), true))
			setPages += 1;
	}

	await S.ensureFolder(S.vaultPath(config, "artists"));
	for (const artist of artists) {
		const artistPath = expectedArtistPath(config, artist);
		if (await ensureGeneratedNote(artistPath, buildArtistNote(artist), true)) {
			artistPages += 1;
		}
	}

	const manifestPath = S.vaultPath(
		config,
		`${config.dataDir}/${config.manifestFile}`,
	);
	await S.ensureFolder(S.vaultPath(config, config.dataDir));
	const manifests = S.buildSetManifests(cards);
	await app.vault.adapter.write(
		manifestPath,
		JSON.stringify(manifests, null, 2) + "\n",
	);

	return {
		ok: true,
		validation,
		generated: {
			summaries,
			variants,
			setPages,
			artistPages,
			manifestsWritten: true,
		},
	};
}

const _syncExports = {
	loadConfig,
	loadApiCards,
	validateApiSync,
	generateMissingSorceryNotes,
	buildSummaryNote,
	buildSetPageNote,
	frontmatterText,
	expectedSummaryPath,
	expectedSetPagePath,
};
if (typeof globalThis !== "undefined") globalThis.SorceryTrackerSync = _syncExports;
if (typeof module !== "undefined" && module.exports) module.exports = _syncExports;
