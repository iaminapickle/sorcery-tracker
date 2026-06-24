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
		name: "Sorcery Storage Manager",
		options: {},
	},
};

let QuickAdd;

async function start(params) {
	S = await loadShared();
	QuickAdd = params;
	const config = await S.loadConfig();

	const preselect = globalThis.__sorceryStoragePreselect;
	let mode;
	if (preselect?.mode) {
		mode = preselect.mode;
	} else {
		mode = await QuickAdd.quickAddApi.suggester(
			["Add", "Remove", "Move", "Clear", "Edit", "Delete"],
			["add", "remove", "move", "clear", "edit", "delete"],
			"Operation",
		);
	}
	if (!mode) return;
	if (mode === "add") return await handleAdd(config);
	if (mode === "remove") return await handleRemove(config);
	if (mode === "move") return await handleMove(config);
	if (mode === "clear") return await handleClear(config);
	if (mode === "moveall") return await handleMoveAll(config);
	if (mode === "edit") return await handleEdit(config);
	if (mode === "delete") return await handleDelete(config);
}

function binderFolder(config) {
	return S.vaultPath(config, config.bindersDir);
}

function binderCandidates(config, query = "") {
	const q = String(query || "")
		.trim()
		.toLowerCase();
	return app.vault
		.getMarkdownFiles()
		.filter((file) => file.path.startsWith(`${binderFolder(config)}/`))
		.map((file) => {
			const fm = app.metadataCache.getFileCache(file)?.frontmatter || {};
			if (fm.kind !== "sorcery-storage") return null;
			return {
				file,
				name: fm.binderName || file.basename,
				totalSlots: Number(fm.totalSlots || 0),
				slotsPerPage: Number(fm.slotsPerPage || 0),
				pages: Number(fm.pages || 0),
			};
		})
		.filter(Boolean)
		.filter((binder) => {
			if (!q) return true;
			return [binder.name, binder.file.basename, binder.file.path]
				.join(" ")
				.toLowerCase()
				.includes(q);
		})
		.sort(
			(a, b) =>
				a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
				a.file.path.localeCompare(b.file.path),
		);
}

async function chooseBinder(config, prompt, query = "") {
	const preselect = globalThis.__sorceryStoragePreselect;
	globalThis.__sorceryStoragePreselect = null;
	if (preselect?.name) {
		const candidates = binderCandidates(config);
		const match = candidates.find((b) => b.name === preselect.name);
		if (match) return match;
	}

	const candidates = binderCandidates(config);
	if (!candidates.length) {
		new Notice(`No binders found for: ${prompt}`, 5000);
		return null;
	}

	// Promote most recently used storage to the top of the alphabetical list
	const lastUsed = globalThis.__sorceryLastStorage;
	if (lastUsed) {
		const idx = candidates.findIndex((b) => b.name === lastUsed);
		if (idx > 0) candidates.unshift(...candidates.splice(idx, 1));
	}

	const q = String(query || "").trim().toLowerCase();
	const exact = q
		? candidates.find((binder) =>
				[binder.name, binder.file.basename, binder.file.path].some(
					(part) => String(part).toLowerCase() === q,
				),
			)
		: null;
	if (exact) {
		globalThis.__sorceryLastStorage = exact.name;
		return exact;
	}
	const filtered = q
		? candidates.filter((binder) =>
				[binder.name, binder.file.basename, binder.file.path].some((part) =>
					String(part).toLowerCase().includes(q),
				),
			)
		: candidates;
	if (filtered.length === 1) {
		globalThis.__sorceryLastStorage = filtered[0].name;
		return filtered[0];
	}
	const labels = filtered.map((b) => b.name);
	const chosen = await QuickAdd.quickAddApi.suggester(labels, filtered, prompt);
	if (chosen) globalThis.__sorceryLastStorage = chosen.name;
	return chosen;
}

const suggest = (labels, values, placeholder) => QuickAdd.quickAddApi.suggester(labels, values, placeholder);
const chooseVariant = (config, prompt, query = "") => S.chooseVariant(config, suggest, query, prompt);

// slug -> { cardName, setName, type, product, finish } from the API, so placement
// choices (which only store a slug under ownership) can show a readable label.
let slugMetaCache = null;
async function slugMetaIndex(config) {
	if (slugMetaCache) return slugMetaCache;
	const map = new Map();
	const api = await S.loadApiData(config);
	for (const card of api?.data || []) {
		const guardian = card.guardian || {};
		for (const set of card.sets || []) {
			const meta = set.metadata || {};
			const type = String(meta.type ?? guardian.type ?? "");
			for (const v of set.variants || []) {
				map.set(v.slug, {
					cardName: card.name,
					setName: set.name,
					type,
					product: v.product || "",
					finish: v.finish || "",
				});
			}
		}
	}
	slugMetaCache = map;
	return map;
}

// Summary notes hold fm.ownership[slug] = { normalCount, foilCount, binderPlacements }.
function summaryNotes(config) {
	const prefix = `${S.vaultPath(config, config.cardsDir)}/`;
	const out = [];
	for (const file of app.vault.getMarkdownFiles()) {
		if (!file.path.startsWith(prefix)) continue;
		const fm = app.metadataCache.getFileCache(file)?.frontmatter || {};
		if (fm.kind !== "sorcery-card-summary") continue;
		out.push({ file, fm });
	}
	return out;
}

async function placementChoices(config, binderName) {
	const meta = await slugMetaIndex(config);
	const choices = [];
	for (const { file, fm } of summaryNotes(config)) {
		const ownership =
			fm.ownership && typeof fm.ownership === "object" ? fm.ownership : {};
		for (const [slug, entry] of Object.entries(ownership)) {
			const placements = Array.isArray(entry?.binderPlacements)
				? entry.binderPlacements
				: [];
			placements.forEach((placement, placementIndex) => {
				if (placement.binder !== binderName) return;
				const count = Math.max(0, Number(placement.count || 0));
				if (!count) return;
				const m = meta.get(slug) || {};
				choices.push({
					file,
					slug,
					placementIndex,
					binder: binderName,
					cardName: m.cardName || fm.cardName || file.basename,
					setName: m.setName || "",
					type: m.type || "",
					product: m.product || "",
					finish: m.finish || "",
					foil: Boolean(placement.foil),
					count,
				});
			});
		}
	}
	choices.sort(
		(a, b) =>
			a.cardName.localeCompare(b.cardName, undefined, {
				sensitivity: "base",
			}) ||
			a.setName.localeCompare(b.setName, undefined, { sensitivity: "base" }) ||
			Number(a.foil) - Number(b.foil) ||
			a.slug.localeCompare(b.slug, undefined, { sensitivity: "base" }),
	);
	return choices;
}

const padColumn = (value, width, align) => S.padColumn(value, width, align);
const maxStringLength = (values, fallback) => S.maxStringLength(values, fallback);
const displayProduct = (value) => S.displayProduct(value);

const withStyledSuggestions = (labels, fn) => S.withStyledSuggestions(fn, { labels });
const refreshDataview = () => S.refreshDataview();
const logAction = (config, message) => S.logAction(config, message);

function placementLabel(choice, widths) {
	return [
		` ${padColumn(choice.cardName, widths.cardName)} `,
		` ${padColumn(choice.setName, widths.setName)} `,
		` ${padColumn(choice.type, widths.type)} `,
		` ${padColumn(choice.finish, widths.finish)} `,
		` ${padColumn(displayProduct(choice.product), widths.product)} `,
		` ${padColumn(`x${choice.count}`, widths.count, "right")} `,
	]
		.join("|")
		.trimEnd();
}

async function choosePlacement(config, binderName, placeholder = "") {
	const choices = await placementChoices(config, binderName);
	if (!choices.length) {
		new Notice(`No cards found in binder: ${binderName}`, 5000);
		return null;
	}
	if (choices.length === 1) return choices[0];
	const widths = {
		cardName: maxStringLength(choices.map((c) => c.cardName)),
		setName: maxStringLength(choices.map((c) => c.setName)),
		type: maxStringLength(choices.map((c) => c.type)),
		finish: maxStringLength(choices.map((c) => c.finish)),
		product: maxStringLength(choices.map((c) => displayProduct(c.product))),
		count: maxStringLength(choices.map((c) => `x${c.count}`)),
	};
	const labels = choices.map((c) => placementLabel(c, widths));
	return await withStyledSuggestions(labels, () =>
		QuickAdd.quickAddApi.suggester(labels, choices, placeholder || undefined),
	);
}

function parseQuantity(raw) {
	const qty = Number(String(raw ?? "").trim());
	return Number.isInteger(qty) && qty > 0 ? qty : null;
}

async function promptQuantity(prompt, defaultValue) {
	const raw = await QuickAdd.quickAddApi.inputPrompt(
		prompt,
		String(defaultValue),
		String(defaultValue),
	);
	if (raw === null || raw === undefined) return null;
	const qty = parseQuantity(raw);
	if (qty === null) {
		throw new Error(`Quantity must be a positive integer: ${raw}`);
	}
	return qty;
}

const addToOwnership = (fm, slug, binderName, count, foil) =>
	S.addPlacementToOwnership(fm, slug, binderName, count, foil);

// Removes from fm.ownership[slug]; returns amount removed, or -1 if requireExact
// and the full count isn't available in that binder/finish.
function removeFromOwnership(fm, slug, binderName, count, foil, requireExact = false) {
	const entry = S.ownershipEntry(fm, slug);
	const placement = entry.binderPlacements.find(
		(p) => p && p.binder === binderName && Boolean(p.foil) === foil,
	);
	const available = foil ? entry.foilCount : entry.normalCount;
	const placementCount = placement ? Number(placement.count || 0) : 0;
	const amount = Math.max(0, Math.min(count, available, placementCount));
	if (requireExact && amount !== count) return -1;
	if (amount <= 0) return 0;
	return S.removePlacementFromOwnership(fm, slug, binderName, amount, foil);
}

function ownershipHasBinder(fm, binderName) {
	const o = fm.ownership && typeof fm.ownership === "object" ? fm.ownership : {};
	return Object.values(o).some(
		(e) =>
			Array.isArray(e?.binderPlacements) &&
			e.binderPlacements.some((p) => p.binder === binderName),
	);
}

// Strips every placement for `binderName` across all ownership entries of a summary
// note's frontmatter, decrementing counts and pruning empty entries. Returns removed.
function stripBinderFromOwnership(fm, binderName) {
	const o = fm.ownership && typeof fm.ownership === "object" ? fm.ownership : {};
	let removed = 0;
	for (const slug of Object.keys(o)) {
		const entry = o[slug] || {};
		const placements = Array.isArray(entry.binderPlacements) ? entry.binderPlacements : [];
		let normalRemoved = 0;
		let foilRemoved = 0;
		entry.binderPlacements = placements.filter((p) => {
			if (p.binder !== binderName) return true;
			if (p.foil) foilRemoved += Number(p.count || 0);
			else normalRemoved += Number(p.count || 0);
			return false;
		});
		entry.normalCount = Math.max(0, Number(entry.normalCount || 0) - normalRemoved);
		entry.foilCount = Math.max(0, Number(entry.foilCount || 0) - foilRemoved);
		removed += normalRemoved + foilRemoved;
		if (
			entry.normalCount === 0 &&
			entry.foilCount === 0 &&
			entry.binderPlacements.length === 0
		)
			delete o[slug];
	}
	return removed;
}

// Reassigns every placement from `fromBinder` to `toBinder` across all ownership
// entries (counts unchanged). Returns the number of copies moved.
function moveBinderInOwnership(fm, fromBinder, toBinder) {
	const o = fm.ownership && typeof fm.ownership === "object" ? fm.ownership : {};
	let moved = 0;
	for (const slug of Object.keys(o)) {
		const entry = o[slug] || {};
		const placements = Array.isArray(entry.binderPlacements) ? [...entry.binderPlacements] : [];
		const rest = placements.filter((p) => p.binder !== fromBinder);
		for (const p of placements.filter((p) => p.binder === fromBinder)) {
			const count = Number(p.count || 0);
			if (!count) continue;
			moved += count;
			const existing = rest.find(
				(t) => t.binder === toBinder && Boolean(t.foil) === Boolean(p.foil),
			);
			if (existing) existing.count = Number(existing.count || 0) + count;
			else rest.push({ binder: toBinder, count, foil: Boolean(p.foil) });
		}
		entry.binderPlacements = rest;
	}
	return moved;
}

async function handleAdd(config) {
	const binder = await chooseBinder(config, "Destination storage");
	if (!binder) return;
	let added = false;
	while (true) {
		const card = await chooseVariant(config, "Choose card", "");
		if (!card) break;
		const quantity = await promptQuantity("Quantity:", 1);
		if (!quantity) break;
		const foil = (card.finish || "").toLowerCase() === "foil";
		if (!card.file) {
			new Notice(`No summary note found for ${card.cardName}`, 5000);
			break;
		}
		await app.fileManager.processFrontMatter(card.file, (fm) => {
			addToOwnership(fm, card.slug, binder.name, quantity, foil);
		});
		new Notice(
			`Added ${quantity} ${card.cardName} - ${foil ? "Foil" : "Standard"} to ${binder.name}`,
			4000,
		);
		await logAction(config, `Added ${quantity}x ${card.cardName} - ${foil ? "Foil" : "Standard"} to ${binder.name}`);
		refreshDataview();
		added = true;
	}
	if (added) refreshDataview();
}

async function handleRemove(config) {
	const binder = await chooseBinder(config, "Source storage");
	if (!binder) return;
	const placement = await choosePlacement(config, binder.name, "Card to remove");
	if (!placement) return;
	const quantity = await promptQuantity(
		"Quantity to remove:",
		1,
	);
	if (!quantity) return;
	let removed = 0;
	await app.fileManager.processFrontMatter(placement.file, (fm) => {
		removed = removeFromOwnership(
			fm,
			placement.slug,
			binder.name,
			quantity,
			placement.foil,
			true,
		);
		if (removed < 0) {
			throw new Error(
				`Not enough ${placement.foil ? "foil" : "standard"} cards to remove from ${binder.name}`,
			);
		}
	});
	new Notice(
		`Removed ${removed} ${placement.cardName} - ${placement.foil ? "Foil" : "Standard"} from ${binder.name}`,
		4000,
	);
	await logAction(config, `Removed ${removed}x ${placement.cardName} - ${placement.foil ? "Foil" : "Standard"} from ${binder.name}`);
	refreshDataview();
}

async function handleMove(config) {
	const sourceBinder = await chooseBinder(config, "Source storage");
	if (!sourceBinder) return;
	const placement = await choosePlacement(config, sourceBinder.name, "Card to move");
	if (!placement) return;
	const targetBinder = await chooseBinder(config, "Destination storage");
	if (!targetBinder) return;
	if (targetBinder.name === sourceBinder.name) {
		new Notice("Source and target binder are the same", 4000);
		return;
	}
	const quantity = await promptQuantity(
		"Quantity to move:",
		1,
	);
	if (!quantity) return;
	let moved = 0;
	await app.fileManager.processFrontMatter(placement.file, (fm) => {
		moved = removeFromOwnership(
			fm,
			placement.slug,
			sourceBinder.name,
			quantity,
			placement.foil,
			true,
		);
		if (moved < 0) {
			throw new Error(
				`Not enough ${placement.foil ? "foil" : "standard"} cards to move from ${sourceBinder.name}`,
			);
		}
		if (moved > 0) {
			addToOwnership(fm, placement.slug, targetBinder.name, moved, placement.foil);
		}
	});
	new Notice(
		`Moved ${moved} ${placement.cardName} - ${placement.foil ? "Foil" : "Standard"} from ${sourceBinder.name} to ${targetBinder.name}`,
		4000,
	);
	await logAction(config, `Moved ${moved}x ${placement.cardName} - ${placement.foil ? "Foil" : "Standard"} from ${sourceBinder.name} to ${targetBinder.name}`);
	refreshDataview();
}

async function handleClear(config) {
	const binder = await chooseBinder(config, "Storage to clear");
	if (!binder) return;
	const confirm = await QuickAdd.quickAddApi.inputPrompt(
		`Type "clear" to wipe all cards from ${binder.name}:`,
		"",
		"",
	);
	if (confirm === null || confirm === undefined) return;
	if (confirm.trim().toLowerCase() !== "clear") {
		new Notice(`Cancelled — type "clear" to confirm.`, 3000);
		return;
	}
	let totalRemoved = 0;
	for (const { file, fm } of summaryNotes(config)) {
		if (!ownershipHasBinder(fm, binder.name)) continue;
		await app.fileManager.processFrontMatter(file, (f) => {
			totalRemoved += stripBinderFromOwnership(f, binder.name);
		});
	}
	new Notice(`Cleared ${totalRemoved} card${totalRemoved !== 1 ? "s" : ""} from ${binder.name}`, 4000);
	await logAction(config, `Cleared ${totalRemoved} cards from ${binder.name}`);
	refreshDataview();
}

async function handleMoveAll(config) {
	const sourceBinder = await chooseBinder(config, "Source storage");
	if (!sourceBinder) return;
	const targetBinder = await chooseBinder(config, "Destination storage");
	if (!targetBinder) return;
	if (targetBinder.name === sourceBinder.name) {
		new Notice("Source and target storage are the same", 4000);
		return;
	}
	let totalMoved = 0;
	for (const { file, fm } of summaryNotes(config)) {
		if (!ownershipHasBinder(fm, sourceBinder.name)) continue;
		await app.fileManager.processFrontMatter(file, (f) => {
			totalMoved += moveBinderInOwnership(f, sourceBinder.name, targetBinder.name);
		});
	}
	new Notice(`Moved ${totalMoved} card${totalMoved !== 1 ? "s" : ""} from ${sourceBinder.name} to ${targetBinder.name}`, 4000);
	await logAction(config, `Moved all (${totalMoved}) from ${sourceBinder.name} to ${targetBinder.name}`);
	refreshDataview();
}

async function handleEdit(config) {
	const binder = await chooseBinder(config, "Storage to edit");
	if (!binder) return;
	const fm = app.metadataCache.getFileCache(binder.file)?.frontmatter || {};
	const isBox = String(fm.storageType || "binder") === "box";

	const newName = await QuickAdd.quickAddApi.inputPrompt(
		"Storage name:",
		"",
		String(fm.binderName || binder.file.basename),
	);
	if (newName === null || newName === undefined) return;

	if (isBox) {
		await app.fileManager.processFrontMatter(binder.file, (fm) => {
			if (newName.trim()) fm.binderName = newName.trim();
		});
	} else {
		const newColour = await QuickAdd.quickAddApi.inputPrompt(
			"Colour:",
			"",
			String(fm.colour || ""),
		);
		if (newColour === null || newColour === undefined) return;

		const slotsStr = await QuickAdd.quickAddApi.inputPrompt(
			"Slots per page:",
			"",
			String(fm.slotsPerPage || "9"),
		);
		if (slotsStr === null || slotsStr === undefined) return;
		const slotsPerPage = Math.max(1, Number(slotsStr) || 9);

		const pagesStr = await QuickAdd.quickAddApi.inputPrompt(
			"Pages:",
			"",
			String(fm.pages || "1"),
		);
		if (pagesStr === null || pagesStr === undefined) return;
		const pages = Math.max(1, Number(pagesStr) || 1);

		await app.fileManager.processFrontMatter(binder.file, (fm) => {
			if (newName.trim()) fm.binderName = newName.trim();
			fm.colour = newColour.trim();
			fm.slotsPerPage = slotsPerPage;
			fm.pages = pages;
			fm.totalSlots = slotsPerPage * pages;
		});
	}
	new Notice(`Updated "${newName.trim() || binder.name}"`, 4000);
}

async function handleDelete(config) {
	const binder = await chooseBinder(config, "Storage to delete");
	if (!binder) return;

	const confirm = await QuickAdd.quickAddApi.inputPrompt(
		`Type "delete" to permanently delete "${binder.name}":`,
		"",
		"",
	);
	if (confirm === null || confirm === undefined) return;
	if (confirm.trim().toLowerCase() !== "delete") {
		new Notice(`Cancelled — type "delete" to confirm.`, 3000);
		return;
	}

	let totalRemoved = 0;
	for (const { file, fm } of summaryNotes(config)) {
		if (!ownershipHasBinder(fm, binder.name)) continue;
		await app.fileManager.processFrontMatter(file, (f) => {
			totalRemoved += stripBinderFromOwnership(f, binder.name);
		});
	}

	const deletedPath = binder.file.path;
	await app.vault.delete(binder.file);

	app.workspace.iterateAllLeaves((leaf) => {
		if (leaf.view?.file?.path === deletedPath) leaf.detach();
	});

	new Notice(`Deleted "${binder.name}" (${totalRemoved} card${totalRemoved !== 1 ? "s" : ""} cleared)`, 4000);
	refreshDataview();
}
