const SorceryTrackerShared = (() => {
	const RELEASE_ORDER = [
		"Alpha",
		"Beta",
		"Promotional",
		"Arthurian Legends",
		"Dragonlord",
		"Gothic",
	];
	const DEFAULT_CONFIG = {
		vaultRoot: "",
		assetsDir: "assets",
		dataDir: "data",
		cardsDir: "cards",
		bindersDir: "storage",
		decksDir: "decks",
		setOrder: RELEASE_ORDER,
		costOrder: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
		rarityTargets: { Unique: 1, Elite: 2, Exceptional: 3, Ordinary: 4 },
		iconMap: {
			Air: "wind.png",
			Fire: "fire.png",
			Water: "water.png",
			Earth: "earth.png",
		},
		manifestFile: "set-manifests.json",
		apiFile: "sorcery-api.json",
		cardGroups: [],
		otherCards: [],
		tokenCards: [],
		sortOrder: ["avatar", "other", "type", "rarity", "name", "set", "finish"],
		typeOrder: ["Artifact", "Aura", "Minion", "Magic", "Site"],
		rarityOrder: ["Unique", "Elite", "Exceptional", "Ordinary"],
	};
	const CONFIG_PATHS = ["data/config.json", "Sorcery Tracker/data/config.json"];
	let configCache = null;
	const siteImageCache = new Map();

	function normalizePathSegment(value) {
		return String(value ?? "")
			.replace(/\\/g, "/")
			.replace(/^\.\/+/, "")
			.replace(/^\/+|\/+$/g, "");
	}

	function vaultPath(config, relPath) {
		const root = normalizePathSegment(config?.vaultRoot);
		const rel = normalizePathSegment(relPath);
		if (!root) return rel;
		if (!rel) return root;
		if (rel === root || rel.startsWith(`${root}/`)) return rel;
		return `${root}/${rel}`;
	}

	function mergeConfig(user) {
		const cfg = user && typeof user === "object" ? user : {};
		return {
			...DEFAULT_CONFIG,
			...cfg,
			setOrder: Array.isArray(cfg.setOrder)
				? cfg.setOrder
				: DEFAULT_CONFIG.setOrder,
			costOrder: Array.isArray(cfg.costOrder)
				? cfg.costOrder
				: DEFAULT_CONFIG.costOrder,
			sortOrder:
				Array.isArray(cfg.sortOrder) && cfg.sortOrder.length
					? cfg.sortOrder
					: DEFAULT_CONFIG.sortOrder,
			typeOrder:
				Array.isArray(cfg.typeOrder) && cfg.typeOrder.length
					? cfg.typeOrder
					: DEFAULT_CONFIG.typeOrder,
			rarityOrder:
				Array.isArray(cfg.rarityOrder) && cfg.rarityOrder.length
					? cfg.rarityOrder
					: DEFAULT_CONFIG.rarityOrder,
			rarityTargets: {
				...DEFAULT_CONFIG.rarityTargets,
				...(cfg.rarityTargets || {}),
			},
			iconMap: { ...DEFAULT_CONFIG.iconMap, ...(cfg.iconMap || {}) },
		};
	}

	function setOrderFor(config) {
		return Array.isArray(config?.setOrder) && config.setOrder.length
			? config.setOrder
			: RELEASE_ORDER;
	}

	function costOrderFor(config) {
		return Array.isArray(config?.costOrder) && config.costOrder.length
			? config.costOrder
			: DEFAULT_CONFIG.costOrder;
	}

	const PRODUCT_LABELS = {
		Booster: "Booster",
		Preconstructed_Deck: "Precon",
		Box_Topper: "Box Topper",
		Starter_Deck: "Starter",
		Promotional: "Promo",
	};

	function finishRankFor(name) {
		const value = lowerTrim(name);
		return value === "standard" ? 0 : value === "foil" ? 1 : 9;
	}

	function compareTuples(ka, kb) {
		for (let i = 0; i < ka.length; i++) {
			const a = ka[i], b = kb[i];
			if (typeof a === "string" && typeof b === "string") {
				const c = a.localeCompare(b, undefined, { sensitivity: "base" });
				if (c !== 0) return c;
			} else if (a !== b) {
				return a < b ? -1 : 1;
			}
		}
		return 0;
	}

	function buildMemberToAnchor(cardGroups) {
		const m = new Map();
		for (const group of (cardGroups || []))
			for (const member of (group.members || []))
				m.set(member, group.anchor);
		return m;
	}

	// Configurable sort. sortOrder lists dimensions applied in order; type/rarity
	// read their sub-order from config.typeOrder/rarityOrder. Identity dims describe
	// the card; printing dims (set/finish) vary per printing. cardGroups members
	// inherit their anchor's identity key and sort right after it.
	const SORT_IDENTITY_DIMS = ["avatar", "other", "type", "rarity", "name"];
	const SORT_PRINTING_DIMS = ["set", "finish"];

	function sortListsFor(config) {
		const sortOrder =
			Array.isArray(config?.sortOrder) && config.sortOrder.length
				? config.sortOrder
				: DEFAULT_CONFIG.sortOrder;
		const typeOrder =
			Array.isArray(config?.typeOrder) && config.typeOrder.length
				? config.typeOrder
				: DEFAULT_CONFIG.typeOrder;
		const rarityOrder =
			Array.isArray(config?.rarityOrder) && config.rarityOrder.length
				? config.rarityOrder
				: DEFAULT_CONFIG.rarityOrder;
		return { sortOrder, typeOrder, rarityOrder };
	}

	function sortDimValue(dim, card, ctx) {
		switch (dim) {
			case "avatar":
				return lowerTrim(card.type) === "avatar" ? 0 : 1;
			case "other":
				// Other cards sort to the very END of the flat views (after all real
				// types). 1 for Other / 0 otherwise pushes the Other block last; the type
				// dim then subsorts within that block by real type.
				return ctx.otherNames.has(card.name) ? 1 : 0;
			case "type": {
				// Avatar is pinned to the front by the "avatar" dim and Other to the back by
				// the "other" dim, so the type dim uses each card's real type — this lets
				// Other cards subsort by type (Artifact → Minion → Site) within their block.
				const effectiveType = lowerTrim(card.type) === "avatar"
					? "Avatar"
					: String(card.type ?? "").trim();
				const i = ctx.typeOrder.indexOf(effectiveType);
				return i === -1 ? 999 : i;
			}
			case "rarity": {
				const i = ctx.rarityOrder.indexOf(String(card.rarity ?? "").trim());
				return i === -1 ? 999 : i;
			}
			case "name":
				return lowerTrim(card.name);
			case "set": {
				const i = ctx.setOrder.indexOf(String(card.setName ?? ""));
				return i === -1 ? 999 : i;
			}
			case "finish":
				return finishRankFor(card.finish);
			default:
				return 0;
		}
	}

	// Comparator honouring config.sortOrder, restricted to opts.dims. opts.get(item)
	// yields { name, type, rarity, setName, finish }; opts.allItems (unfiltered) seeds
	// anchor inheritance. identityPerPrinting true sorts each printing by its own
	// metadata (binders); false (default) caches one key per card name (collection).
	function makeCardComparator(config, opts) {
		const get = opts.get || ((x) => x);
		const allowed = new Set(
			opts.dims || SORT_IDENTITY_DIMS.concat(SORT_PRINTING_DIMS),
		);
		const { sortOrder, typeOrder, rarityOrder } = sortListsFor(config);
		const ctx = {
			otherNames: new Set(config?.otherCards || []),
			typeOrder,
			rarityOrder,
			setOrder: setOrderFor(config),
		};
		const ordered = sortOrder.filter((d) => allowed.has(d));
		if (!ordered.includes("name")) ordered.push("name"); // deterministic tiebreak
		const idDims = ordered.filter((d) => SORT_IDENTITY_DIMS.includes(d));
		const prDims = ordered.filter((d) => SORT_PRINTING_DIMS.includes(d));
		const memberToAnchor = buildMemberToAnchor(config?.cardGroups);
		const idKeyByName = new Map();
		const idKeyForCard = (c) => idDims.map((d) => sortDimValue(d, c, ctx));
		for (const item of opts.allItems || []) {
			const c = get(item);
			if (c && c.name != null && !idKeyByName.has(c.name))
				idKeyByName.set(c.name, idKeyForCard(c));
		}
		const anchorKey = (name) =>
			idKeyByName.get(name) || idKeyForCard({ name });
		const keyFor = (item) => {
			const c = get(item);
			const anchor = memberToAnchor.get(c.name);
			const pr = prDims.map((d) => sortDimValue(d, c, ctx));
			if (anchor)
				return [...anchorKey(anchor), 1, lowerTrim(c.name), ...pr];
			const own = opts.identityPerPrinting
				? idKeyForCard(c)
				: idKeyByName.get(c.name) || idKeyForCard(c);
			return [...own, 0, "", ...pr];
		};
		return (a, b) => compareTuples(keyFor(a), keyFor(b));
	}

	async function loadConfig() {
		for (const candidate of CONFIG_PATHS) {
			try {
				const raw = await app.vault.adapter.read(candidate);
				configCache = mergeConfig(JSON.parse(raw));
				return configCache;
			} catch (_) {}
		}
		configCache = DEFAULT_CONFIG;
		return configCache;
	}

	function invalidateConfigCache() {
		configCache = null;
	}

	function resolvePath(config, relPaths) {
		const paths = Array.isArray(relPaths) ? relPaths : [relPaths];
		const seen = new Set();
		for (const rel of paths) {
			for (const candidate of [
				vaultPath(config, rel),
				normalizePathSegment(rel),
			]) {
				if (!candidate || seen.has(candidate)) continue;
				seen.add(candidate);
				if (app.vault.getAbstractFileByPath(candidate)) return candidate;
			}
		}
		return null;
	}

	async function ensureFolder(path) {
		try {
			await app.vault.createFolder(path);
		} catch (_) {}
	}

	function owned(p) {
		return Number(p?.normalCount ?? 0) + Number(p?.foilCount ?? 0);
	}
	function ownedFromVariants(variants) {
		return (variants || []).reduce((sum, p) => sum + owned(p), 0);
	}

	async function logAction(config, message) {
		const logPath = `${vaultPath(config, config.dataDir)}/logs.md`;
		const now = new Date();
		const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
		const entry = `- ${ts} — ${message}`;
		let existing = "";
		try {
			existing = await app.vault.adapter.read(logPath);
		} catch (_) {}
		const lines = existing ? existing.split("\n").filter((l) => l.trim()) : [];
		await app.vault.adapter.write(logPath, [entry, ...lines].slice(0, 200).join("\n") + "\n");
	}

	function refreshDataview() {
		app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!view) return;
			view.previewMode?.rerender?.(true);
			if (view.currentMode && view.currentMode !== view.previewMode)
				view.currentMode.rerender?.(true);
		});
	}

	// Ownership lives on the per-card summary note under
	// fm.ownership[slug] = { normalCount, foilCount, binderPlacements:[{binder,count,foil}] }.
	function ownershipEntry(fm, slug) {
		if (!fm.ownership || typeof fm.ownership !== "object") fm.ownership = {};
		const cur = fm.ownership[slug];
		const entry = {
			normalCount: Number(cur?.normalCount) || 0,
			foilCount: Number(cur?.foilCount) || 0,
			binderPlacements: Array.isArray(cur?.binderPlacements)
				? cur.binderPlacements.map((p) => ({
						binder: p?.binder,
						count: Number(p?.count) || 0,
						foil: Boolean(p?.foil),
					}))
				: [],
		};
		fm.ownership[slug] = entry;
		return entry;
	}

	function addPlacementToOwnership(fm, slug, binderName, count, foil) {
		fm.kind = fm.kind || "sorcery-card-summary";
		const entry = ownershipEntry(fm, slug);
		if (foil) entry.foilCount += count;
		else entry.normalCount += count;
		const idx = entry.binderPlacements.findIndex(
			(p) => p && p.binder === binderName && Boolean(p.foil) === foil,
		);
		if (idx >= 0)
			entry.binderPlacements[idx].count =
				Number(entry.binderPlacements[idx].count || 0) + count;
		else entry.binderPlacements.push({ binder: binderName, count, foil });
	}

	// Removes up to `count` copies of `slug` from `binderName` (matching finish).
	// Returns the number actually removed. Prunes empty placements/entries.
	function removePlacementFromOwnership(fm, slug, binderName, count, foil) {
		const entry = ownershipEntry(fm, slug);
		const idx = entry.binderPlacements.findIndex(
			(p) => p && p.binder === binderName && Boolean(p.foil) === foil,
		);
		if (idx < 0) return 0;
		const available = Number(entry.binderPlacements[idx].count || 0);
		const amount = Math.min(available, count);
		if (amount <= 0) return 0;
		entry.binderPlacements[idx].count = available - amount;
		if (entry.binderPlacements[idx].count <= 0)
			entry.binderPlacements.splice(idx, 1);
		if (foil) entry.foilCount = Math.max(0, entry.foilCount - amount);
		else entry.normalCount = Math.max(0, entry.normalCount - amount);
		if (
			entry.normalCount === 0 &&
			entry.foilCount === 0 &&
			entry.binderPlacements.length === 0
		)
			delete fm.ownership[slug];
		return amount;
	}

	function targetFor(config, rarity, mode) {
		return mode === "play" ? (config.rarityTargets?.[rarity] ?? 1) : 1;
	}
	function complete(config, p, mode) {
		return owned(p) >= targetFor(config, p?.rarity, mode);
	}

	function elementComboName(elements) {
		const els = (Array.isArray(elements) ? elements : [])
			.map((e) => String(e).trim())
			.filter(Boolean);
		if (!els.length) return "Neutral";
		if (els.length === 1) return els[0];
		if (els.length === 4) return "Rainbow";
		const key = [...els].sort().join("+");
		const COMBOS = {
			"Air+Earth": "Dust",
			"Air+Fire": "Smoke",
			"Air+Water": "Mist",
			"Earth+Fire": "Lava",
			"Earth+Water": "Mud",
			"Fire+Water": "Steam",
		};
		return COMBOS[key] || els.join("/");
	}

	function splitElements(value) {
		if (Array.isArray(value))
			return value.map((v) => String(v)).filter(Boolean);
		if (value === undefined || value === null || value === "") return [];
		return String(value)
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);
	}

	function extractKeywordsFromRules(rulesText) {
		if (!rulesText) return [];
		const STATIC = [
			"Airborne", "Burrowing", "Charge", "Deathrite", "Genesis",
			"Immobile", "Lance", "Lethal", "Ranged", "Stealth",
			"Submerge", "Voidwalk", "Ward", "Waterbound",
		];
		const STATIC_SET = new Set(STATIC);
		// Matches "Spellcaster", "Air Spellcaster", "Non-fire Spellcaster", etc.
		// One optional word (possibly hyphenated) before "Spellcaster".
		const SPELLCASTER_RE = /^(?:[A-Za-z]+(?:-[A-Za-z]+)?\s+)?Spellcaster$/;
		const found = new Set();
		const lines = String(rulesText).split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
		for (const line of lines) {
			const keyPart = line.includes("→") ? line.split("→")[0].trim() : line;
			// Split on commas - keyword headers list multiple keywords per line
			const parts = keyPart.split(",").map((p) => p.trim()).filter(Boolean);
			for (const part of parts) {
				// "X and Y Spellcaster" becomes two separate keywords
				const compound = part.match(/^(\w+)\s+and\s+(\w+)\s+Spellcaster$/i);
				if (compound) {
					found.add(`${compound[1]} Spellcaster`);
					found.add(`${compound[2]} Spellcaster`);
				} else {
					if (SPELLCASTER_RE.test(part)) found.add(part);
					if (STATIC_SET.has(part)) found.add(part);
					if (part.includes("&")) {
						for (const sub of part.split(/\s*&\s*/))
							if (STATIC_SET.has(sub.trim())) found.add(sub.trim());
					}
				}
			}
			// Also catch static keywords mentioned inline in rules text
			for (const kw of STATIC) if (new RegExp(`\\b${kw}\\b`).test(line)) found.add(kw);
		}
		return [...found];
	}

	function iconPath(config, name) {
		const filePath = resolvePath(
			config,
			`${config.assetsDir}/${config.iconMap?.[name]}`,
		);
		if (!filePath) return null;
		const file = app.vault.getAbstractFileByPath(filePath);
		return file ? app.vault.getResourcePath(file) : null;
	}

	function lowerTrim(value) {
		return String(value ?? "")
			.trim()
			.toLowerCase();
	}

	// Standard-finish slug for the same card/set/product (foil art falls back to it).
	// Derived from the cached API array; null until the API has been loaded.
	function standardArtSlug(config, p) {
		const cardName = lowerTrim(p?.cardName);
		const setName = lowerTrim(p?.setName);
		const product = lowerTrim(p?.product);
		if (!cardName || !setName || !product) return null;
		const cards = globalThis.__sorceryApiData;
		if (!Array.isArray(cards)) return null;
		const matches = [];
		for (const card of cards) {
			if (lowerTrim(card.name) !== cardName) continue;
			for (const set of card.sets || []) {
				if (lowerTrim(set.name) !== setName) continue;
				for (const v of set.variants || []) {
					if (lowerTrim(v.product) !== product) continue;
					if (lowerTrim(v.finish) !== "standard") continue;
					matches.push(String(v.slug));
				}
			}
		}
		matches.sort((a, b) =>
			a.localeCompare(b, undefined, { sensitivity: "base" }),
		);
		return matches[0] || null;
	}

	function artPathForVariant(config, p) {
		const candidates = [
			`${config.assetsDir}/art/${p.slug}.jpg`,
			`assets/art/${p.slug}.jpg`,
			`${config.assetsDir}/art/${p.slug}.png`,
			`assets/art/${p.slug}.png`,
		];
		if (lowerTrim(p?.finish) === "foil") {
			const slug = standardArtSlug(config, p);
			if (slug) {
				candidates.push(
					`${config.assetsDir}/art/${slug}.jpg`,
					`assets/art/${slug}.jpg`,
					`${config.assetsDir}/art/${slug}.png`,
					`assets/art/${slug}.png`,
				);
			}
		}
		return resolvePath(config, candidates);
	}

	function reverseArtPathForVariant(config, p) {
		if (!p?.slug) return null;
		return resolvePath(config, [
			`${config.assetsDir}/art/${p.slug}-r.jpg`,
			`assets/art/${p.slug}-r.jpg`,
			`${config.assetsDir}/art/${p.slug}-r.png`,
			`assets/art/${p.slug}-r.png`,
		]);
	}

	function appendFoilRibbon(parent, cls = "sorcery-foil-corner") {
		return parent.createDiv({ cls });
	}

	function showImageLightbox(src, alt, opts = {}) {
		const overlay = document.createElement("div");
		overlay.className = "sorcery-lightbox";
		const img = document.createElement("img");
		img.className = "sorcery-lightbox-img" + (opts.rotate ? " sorcery-lightbox-img--rotated" : "");
		img.src = src;
		img.alt = alt || "";
		overlay.appendChild(img);
		const close = () => overlay.remove();
		overlay.addEventListener("click", close);
		const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
		document.addEventListener("keydown", onKey);
		document.body.appendChild(overlay);
	}

	function renderArtFrame(parent, config, p, options = {}) {
		const wrapClass = options.wrapClass || "sorcery-card-image-wrap";
		const imageClass = options.imageClass || "sorcery-card-image";
		const placeholderClass =
			options.placeholderClass ||
			"sorcery-card-image sorcery-card-image--placeholder";
		const placeholderText = options.placeholderText || "No art";
		const ribbonClass = options.ribbonClass || "sorcery-foil-corner";
		const ribbon = options.ribbon !== false && lowerTrim(p?.finish) === "foil";
		const alt = options.alt || p.cardName || p.slug || p.file?.name;
		const wrap = parent.createDiv({ cls: wrapClass });
		const imagePath = artPathForVariant(config, p);
		const file = imagePath ? app.vault.getAbstractFileByPath(imagePath) : null;
		const resourceSrc = file ? app.vault.getResourcePath(file) : null;
		const image = resourceSrc
			? wrap.createEl("img", {
					cls: imageClass,
					attr: {
						src: resourceSrc,
						alt: String(alt || ""),
						loading: "eager",
						style: "pointer-events:none;",
					},
				})
			: wrap.createDiv({ cls: placeholderClass, text: placeholderText });
		if (ribbon && file) appendFoilRibbon(wrap, ribbonClass);
		if (resourceSrc && image instanceof HTMLImageElement) {
			wrap.classList.add("sorcery-lightbox-trigger");
			const isSite = String(p?.type || "").trim() === "Site";
			wrap.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); showImageLightbox(resourceSrc, String(alt || ""), isSite ? { rotate: 90 } : {}); });
		}
		return { wrap, image, file };
	}

	function makeRow(label, value, iconName, config) {
		const row = document.createElement("div");
		row.className = "sorcery-kv-row";
		const labelEl = document.createElement("div");
		labelEl.className = "sorcery-kv-label";
		labelEl.appendChild(document.createTextNode(String(label)));
		if (iconName) {
			const src = iconPath(config, iconName);
			if (src) {
				const img = document.createElement("img");
				img.className = "sorcery-element-icon";
				img.alt = String(label);
				img.src = src;
				labelEl.appendChild(img);
			}
		}
		const valueEl = document.createElement("div");
		valueEl.className = "sorcery-kv-value";
		if (value instanceof Node) valueEl.appendChild(value);
		else valueEl.textContent = String(value);
		row.appendChild(labelEl);
		row.appendChild(valueEl);
		return row;
	}

	function makeToken(value, config) {
		const token = document.createElement("span");
		token.className = "sorcery-element-token";
		token.appendChild(document.createTextNode(String(value)));
		const src = iconPath(config, value);
		if (src) {
			const img = document.createElement("img");
			img.className = "sorcery-element-icon";
			img.alt = String(value);
			img.src = src;
			token.appendChild(img);
		}
		return token;
	}

	function addRow(container, label, value, iconName, config) {
		if (value === undefined || value === null || value === "") return;
		container.appendChild(makeRow(label, value, iconName, config));
	}

	function addListRow(container, label, values, config) {
		const list = Array.isArray(values)
			? values.filter((v) => v !== undefined && v !== null && v !== "")
			: [];
		if (!list.length) return;
		const row = document.createElement("div");
		row.className = "sorcery-kv-row";
		const labelEl = document.createElement("div");
		labelEl.className = "sorcery-kv-label";
		labelEl.textContent = label;
		const valueEl = document.createElement("div");
		valueEl.className = "sorcery-kv-value";
		const wrap = document.createElement("div");
		wrap.className = "sorcery-element-list";
		for (const item of list) wrap.appendChild(makeToken(item, config));
		valueEl.appendChild(wrap);
		row.appendChild(labelEl);
		row.appendChild(valueEl);
		container.appendChild(row);
	}

	function kvBlock(parent, cls = "sorcery-kv") {
		return parent.createDiv({ cls });
	}

	function cardLink(_dv, path, label, preselectSlug) {
		const link = document.createElement("a");
		link.className = "internal-link";
		link.setAttribute("data-href", String(path || ""));
		link.setAttribute("href", String(path || ""));
		link.textContent = String(label ?? path ?? "");
		// When a printing slug is given, opening the card note selects that printing in
		// its Variant dropdown (renderSummary reads this global). Set on mousedown so
		// it lands before Obsidian's click navigation; also on click as a backstop.
		if (preselectSlug) {
			const setPreselect = () => {
				globalThis.__sorceryVariantPreselect = String(preselectSlug);
			};
			link.addEventListener("mousedown", setPreselect);
			link.addEventListener("click", setPreselect);
		}
		return link;
	}

	async function readJsonByCandidates(candidates) {
		for (const candidate of candidates) {
			try {
				const raw = await app.vault.adapter.read(candidate);
				return { path: candidate, data: JSON.parse(raw) };
			} catch (_) {}
		}
		return null;
	}

	async function loadApiData(config) {
		if (globalThis.__sorceryApiData) return { data: globalThis.__sorceryApiData };
		const result = await readJsonByCandidates([
			`${config.dataDir}/${config.apiFile}`,
			`data/${config.apiFile}`,
			vaultPath(config, `${config.dataDir}/${config.apiFile}`),
		]);
		if (result?.data) globalThis.__sorceryApiData = result.data;
		return result;
	}

	async function loadFaqData(config) {
		if (globalThis.__sorceryFaqData) return globalThis.__sorceryFaqData;
		const result = await readJsonByCandidates([
			`${config.dataDir}/faq-scraped.json`,
			`data/faq-scraped.json`,
			vaultPath(config, `${config.dataDir}/faq-scraped.json`),
		]);
		if (result?.data) globalThis.__sorceryFaqData = result.data;
		return result?.data ?? null;
	}

	function buildSetManifests(cards) {
		const manifests = {};
		for (const card of cards || []) {
			const cardName = card?.name;
			if (!cardName) continue;
			const seen = new Set();
			for (const set of card.sets || []) {
				const setName = set?.name;
				if (!setName || seen.has(setName)) continue;
				seen.add(setName);
				if (!manifests[setName]) manifests[setName] = [];
				const rarity = set?.metadata?.rarity || card?.guardian?.rarity || "";
				const stdVariants = (set.variants || []).filter((v) => v.finish === "Standard");
				if (stdVariants.length > 1) {
					for (const v of stdVariants) {
						const productLabel = PRODUCT_LABELS[v.product] || v.product;
						manifests[setName].push({ cardName, rarity, product: v.product, productLabel, slug: v.slug });
					}
				} else if (!manifests[setName].some((e) => e.cardName === cardName && !e.product)) {
					manifests[setName].push({ cardName, rarity });
				}
			}
		}
		return manifests;
	}

	async function getSiteImageSrc(imageFile) {
		if (!imageFile) return null;
		if (siteImageCache.has(imageFile.path))
			return siteImageCache.get(imageFile.path);
		const promise = (async () => {
			try {
				const src = app.vault.getResourcePath(imageFile);
				const image = new Image();
				image.decoding = "async";
				image.src = src;
				await new Promise((resolve, reject) => {
					image.onload = resolve;
					image.onerror = reject;
				});
				const canvas = document.createElement("canvas");
				canvas.width = image.naturalHeight;
				canvas.height = image.naturalWidth;
				const ctx = canvas.getContext("2d");
				if (!ctx) return src;
				ctx.translate(canvas.width / 2, canvas.height / 2);
				ctx.rotate(Math.PI / 2);
				ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
				return canvas.toDataURL("image/png");
			} catch (_) {
				return app.vault.getResourcePath(imageFile);
			}
		})();
		siteImageCache.set(imageFile.path, promise);
		return promise;
	}

	async function renderVariantArtFrame(parent, config, p, options = {}) {
		const imagePath = artPathForVariant(config, p);
		const imageFile = imagePath
			? app.vault.getAbstractFileByPath(imagePath)
			: null;
		if (!imageFile) return null;
		const isSite = p.type === "Site";
		const imgWrap = parent.createDiv({
			cls: `sorcery-variant-image${isSite ? " sorcery-variant-image--site" : ""}`,
		});
		const src = isSite
			? await getSiteImageSrc(imageFile)
			: app.vault.getResourcePath(imageFile);
		const img = imgWrap.createEl("img", {
			attr: {
				src,
				alt: options.alt ?? p.cardName ?? p.slug ?? p.file?.name ?? "",
				style: "pointer-events:none;",
			},
		});
		if (options.ribbon !== false && lowerTrim(p.finish) === "foil")
			appendFoilRibbon(imgWrap);
		imgWrap.classList.add("sorcery-lightbox-trigger");
		imgWrap.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); showImageLightbox(src, img.alt); });
		if (isSite) {
			img.style.setProperty("position", "absolute", "important");
			img.style.setProperty("left", "0", "important");
			img.style.setProperty("top", "0", "important");
			img.style.setProperty("width", "100%", "important");
			img.style.setProperty("height", "100%", "important");
			img.style.setProperty("max-width", "none", "important");
			img.style.setProperty("object-fit", "cover");
			img.style.setProperty("transform", "none", "important");
			img.style.setProperty("transform-origin", "center");
		} else {
			img.style.setProperty("aspect-ratio", "2 / 3");
			img.style.setProperty("object-fit", "cover");
		}
		return { wrap: imgWrap, image: img, file: imageFile };
	}

	function binderPathForName(config, binderName) {
		return resolvePath(config, [
			`${config.bindersDir}/${binderName}.md`,
			`storage/${binderName}.md`,
		]);
	}

	function artistPathForName(config, artistName) {
		return resolvePath(config, [`artists/${artistName}.md`]);
	}

	// Card notes are flat (cards/[Name].md).
	function cardSummaryPathForName(config, cardName) {
		return resolvePath(config, [
			`${config.cardsDir}/${cardName}.md`,
			`cards/${cardName}.md`,
		]);
	}
	// The canonical (flat) path for a card note, for creation/fallback.
	function cardNotePath(config, cardName) {
		return vaultPath(config, `${config.cardsDir}/${cardName}.md`);
	}

	function beginTrackedRender(container) {
		const token = Symbol("sorcery-render");
		container.__sorceryRenderToken = token;
		container.replaceChildren();
		container.dataset.sorcery = "1";
		return () => container.__sorceryRenderToken === token;
	}

	// dv.current() can be null before Dataview indexes the file (startup, multiple
	// tabs). Fall back to Obsidian's native cache, then to the "resolved" event.
	async function awaitCurrentFm(dv) {
		const filePath = dv.currentFilePath;
		const getFm = () => {
			// Native cache updates synchronously on write, so post-processFrontMatter
			// rerenders see fresh frontmatter instead of Dataview's stale page cache.
			const cached = app.metadataCache.getCache(filePath)?.frontmatter;
			if (cached) return { ...cached, file: app.vault.getAbstractFileByPath(filePath) };
			const live = dv.current();
			if (live) return live;
			return null;
		};
		let current = getFm();
		if (!current) {
			await new Promise((resolve) => {
				const ref = app.metadataCache.on("resolved", () => {
					app.metadataCache.offref(ref);
					resolve();
				});
				setTimeout(resolve, 2000);
			});
			current = getFm();
		}
		return current;
	}

	function binderPlacementsForCard(p) {
		const placements = Array.isArray(p?.binderPlacements)
			? p.binderPlacements
			: [];
		const grouped = new Map();
		for (const placement of placements) {
			const binder = String(placement?.binder || "").trim();
			const count = Number(placement?.count || 0);
			if (!binder || !Number.isFinite(count) || count <= 0) continue;
			grouped.set(binder, (grouped.get(binder) || 0) + count);
		}
		return [...grouped.entries()]
			.map(([binder, count]) => ({ binder, count }))
			.sort((a, b) =>
				lowerTrim(a.binder).localeCompare(lowerTrim(b.binder), undefined, {
					sensitivity: "base",
				}),
			);
	}

	// Synthesizes one variant-shaped row per API printing (cardName, slug, setName,
	// finish, product, type, rarity, elements, subTypes, keywords, rules, artist,
	// counts, binderPlacements, file.path), reading ownership from the summary note's
	// fm.ownership[slug]. file.path points at the summary note so links land there.
	async function loadVariantRows(config, dv) {
		const apiSource = await loadApiData(config);
		const cards = apiSource?.data || [];
		const cardsRoot = vaultPath(config, config.cardsDir);
		const pages = dv.pages(`"${cardsRoot}"`).array();

		// Summary ownership, read from raw frontmatter (avoids Dataview nested proxies).
		const summaryByCard = new Map();
		for (const p of pages) {
			if (p.kind !== "sorcery-card-summary") continue;
			const tfile = app.vault.getAbstractFileByPath(p.file.path);
			const fm = tfile
				? app.metadataCache.getFileCache(tfile)?.frontmatter || {}
				: {};
			summaryByCard.set(p.cardName ?? p.file.name, {
				path: p.file.path,
				name: p.file.name,
				ownership: fm.ownership || {},
			});
		}

		const rows = [];
		for (const card of cards) {
			const guardian = card.guardian || {};
			const summary = summaryByCard.get(card.name);
			const summaryPath =
				summary?.path || cardSummaryPathForName(config, card.name) ||
				cardNotePath(config, card.name);
			const summaryName = summary?.name || `${card.name}.md`;
			const elements = splitElements(card.elements);
			const subTypes = splitElements(card.subTypes || "");
			for (const set of card.sets || []) {
				const meta = set.metadata || {};
				const rulesText = meta.rulesText ?? guardian.rulesText ?? "";
				const type = meta.type ?? guardian.type;
				const rarity = meta.rarity ?? guardian.rarity;
				const keywords = extractKeywordsFromRules(rulesText);
				for (const variant of set.variants || []) {
					const own = summary?.ownership?.[variant.slug] || {};
					rows.push({
						cardName: card.name,
						slug: variant.slug,
						setName: set.name,
						finish: variant.finish,
						product: variant.product,
						type,
						rarity,
						elements,
						subTypes,
						keywords,
						rules: String(rulesText || ""),
						artist: variant.artist,
						typeText: variant.typeText || meta.typeText,
						flavorText: variant.flavorText || meta.flavorText,
						cost: guardian.cost,
						normalCount: Number(own.normalCount) || 0,
						foilCount: Number(own.foilCount) || 0,
						binderPlacements: Array.isArray(own.binderPlacements)
							? own.binderPlacements
							: [],
						file: { path: summaryPath, name: summaryName },
					});
				}
			}
		}
		return rows;
	}

	function renderBinderTable(parent, placements, config, referenceEl = null) {
		if (!Array.isArray(placements) || !placements.length) return null;
		const wrap = parent.createDiv({ cls: "sorcery-binder-table-wrap" });
		const table = wrap.createEl("table", { cls: "sorcery-binder-table" });
		const referenceWidth = referenceEl
			? Math.ceil(referenceEl.getBoundingClientRect().width)
			: 0;
		if (referenceWidth > 0) {
			table.style.width = `${referenceWidth}px`;
			table.style.tableLayout = "fixed";
		}
		const thead = table.createEl("thead");
		thead.createEl("tr").createEl("th", { text: "Binder" });
		const tbody = table.createEl("tbody");
		for (const placement of placements) {
			const tr = tbody.createEl("tr");
			const td = tr.createEl("td");
			td.appendChild(
				cardLink(
					null,
					binderPathForName(config, placement.binder) ||
						`${config.bindersDir}/${placement.binder}.md`,
					placement.binder,
				),
			);
			td.appendChild(document.createTextNode(` × ${placement.count}`));
		}
		return table;
	}

	// Cached lookup from codex title / finder alias / subcodex title → codex note path,
	// for resolving ((Codex Title)) references in FAQ text. Subcodexes resolve to
	// parentPath#Sub Title. Cleared by Scrape Curiosa (__sorceryCodexLookup = null).
	async function codexLookup(dv, config) {
		if (globalThis.__sorceryCodexLookup instanceof Map)
			return globalThis.__sorceryCodexLookup;
		const map = new Map();
		const pathByTitle = new Map();
		try {
			const pages = dv
				.pages(`"${vaultPath(config, "codex")}"`)
				.where((p) => p.kind === "sorcery-codex")
				.array();
			for (const p of pages) {
				const path = p.file?.path;
				if (!path) continue;
				if (p.title) {
					map.set(lowerTrim(p.title), path);
					pathByTitle.set(lowerTrim(p.title), path);
				}
				for (const alias of String(p.finder || "")
					.split(",")
					.map((a) => a.trim())
					.filter(Boolean)) {
					const k = lowerTrim(alias);
					if (!map.has(k)) map.set(k, path);
				}
			}
		} catch (_) {}
		// Subcodexes (from codex-scraped.json) → link to the parent note's heading.
		try {
			const raw = await app.vault.adapter.read(
				vaultPath(config, `${config.dataDir}/codex-scraped.json`),
			);
			for (const entry of JSON.parse(raw)) {
				const parentPath = pathByTitle.get(lowerTrim(entry.title));
				if (!parentPath) continue;
				for (const s of entry.subcodexes || []) {
					const k = lowerTrim(s.title);
					if (s.title && !map.has(k))
						map.set(k, `${parentPath}#${s.title}`);
				}
			}
		} catch (_) {}
		globalThis.__sorceryCodexLookup = map;
		return map;
	}

	// Renders text into a new child of `parent`, turning ((Codex Title)) markers into
	// links to the matching codex note. Markers that don't resolve to a codex entry
	// are shown as plain text (parentheses stripped).
	function appendTextWithCodexLinks(parent, cls, text, codexMap, dv) {
		const el = parent.createDiv({ cls });
		const str = String(text ?? "");
		// Plain-text between references: drop any leftover stray "((" / "))" markers
		// (curiosa's swapped ))word(( visual markers). Done per-gap, AFTER valid
		// ((...)) references are extracted, so adjacent refs like "((A)), ((B))" don't
		// get their separating ")), ((" merged.
		const plain = (s) => s.replace(/\(\(|\)\)/g, "");
		const re = /\(\(([\s\S]+?)\)\)/g;
		let last = 0;
		let m;
		while ((m = re.exec(str)) !== null) {
			if (m.index > last)
				el.appendChild(document.createTextNode(plain(str.slice(last, m.index))));
			const inner = m[1];
			const path = codexMap.get(lowerTrim(inner));
			// Resolved → link; unresolved ((...)) → inner text with any stray nested
			// markers stripped (handles ((outer … ((inner)) …)) artifact nesting).
			if (path) el.appendChild(cardLink(dv, path, inner));
			else el.appendChild(document.createTextNode(plain(inner)));
			last = re.lastIndex;
		}
		if (last < str.length)
			el.appendChild(document.createTextNode(plain(str.slice(last))));
		return el;
	}

	async function renderSummary(dv) {
		const isActive = beginTrackedRender(dv.container);
		const current = await awaitCurrentFm(dv);
		if (!current || !isActive()) return;
		const config = await loadConfig();
		if (!isActive()) return;
		const cardName = current.cardName;
		const allRows = await loadVariantRows(config, dv);
		if (!isActive()) return;
		const setOrder = setOrderFor(config);
		const setRank = (name) => {
			const idx = setOrder.indexOf(name);
			return idx === -1 ? 999 : idx;
		};
		const rows = allRows
			.filter((p) => p.cardName === cardName)
			.sort(
				(a, b) =>
					setRank(a.setName) - setRank(b.setName) ||
					String(a.product || "").localeCompare(String(b.product || "")) ||
					finishRankFor(a.finish) - finishRankFor(b.finish) ||
					String(a.slug || "").localeCompare(String(b.slug || "")),
			);
		const total = rows.reduce((s, p) => s + owned(p), 0);

		// Renders one printing's art + back face + metadata + storage placements.
		const renderPrinting = async (container, p) => {
			container.replaceChildren();
			if (!p) return;
			container.createDiv({
				cls: "sorcery-variant-count",
				text: `Count: ${owned(p)}`,
			});
			await renderVariantArtFrame(container, config, p, {
				alt: cardName ?? p.slug,
			});
			const reversePath = reverseArtPathForVariant(config, p);
			if (reversePath) {
				container.createDiv({ cls: "sorcery-reverse-label", text: "Back face" });
				await renderVariantArtFrame(container, config,
					{ slug: `${p.slug}-r`, finish: "Standard", type: p.type },
					{ alt: `${cardName ?? p.slug} (back face)`, ribbon: false },
				);
			}
			const metaBox = kvBlock(container);
			const artistPath = artistPathForName(config, p.artist);
			addRow(metaBox, "Set", p.setName, null, config);
			addRow(metaBox, "Product", displayProduct(p.product), null, config);
			addRow(
				metaBox,
				"Artist",
				artistPath ? cardLink(dv, artistPath, p.artist) : p.artist,
				null,
				config,
			);
			// Aggregate owned count across all printings — below the Set/Product/Artist
			// block, above the storage placements.
			const totalBox = kvBlock(container);
			addRow(totalBox, "Total Count", total, null, config);
			renderBinderTable(container, binderPlacementsForCard(p), config, metaBox);
		};

		// Default printing: explicit preselect, else earliest-set Standard, else first.
		// Clear the preselect on a delay (not synchronously) — Dataview may render this
		// block twice on open, and clearing now would lose it on the 2nd render.
		const preselect = globalThis.__sorceryVariantPreselect;
		if (preselect)
			setTimeout(() => {
				if (globalThis.__sorceryVariantPreselect === preselect)
					globalThis.__sorceryVariantPreselect = null;
			}, 3000);
		const selected =
			(preselect && rows.find((p) => p.slug === preselect)) ||
			rows.find((p) => lowerTrim(p.finish) === "standard") ||
			rows[0] ||
			null;

		if (rows.length) {
			const picker = dv.container.createDiv({ cls: "sorcery-printing-picker" });
			picker.createEl("label", {
				cls: "sorcery-printing-label",
				text: "Variant:",
			});
			const select = picker.createEl("select", { cls: "sorcery-printing-select" });
			for (const p of rows) {
				const opt = select.createEl("option", {
					text: `${p.setName ?? ""} · ${displayProduct(p.product)} · ${p.finish ?? ""}`,
					attr: { value: p.slug },
				});
				if (p === selected) opt.selected = true;
			}
			const detail = dv.container.createDiv({ cls: "sorcery-printing-detail" });
			select.addEventListener("change", () => {
				renderPrinting(detail, rows.find((r) => r.slug === select.value));
			});
			await renderPrinting(detail, selected);
			if (!isActive()) return;
		}

		const faqData = await loadFaqData(config);
		if (!isActive()) return;
		const faqs = faqData?.[current.cardName];
		if (faqs?.length) {
			// Resolver for ((...)) references: codex titles/aliases/subcodexes, then a
			// fallback to card-name → summary note (e.g. ((Drown)) → the Drown page).
			const codexMap = await codexLookup(dv, config);
			if (!isActive()) return;
			const refMap = new Map(codexMap);
			for (const r of allRows) {
				const k = lowerTrim(r.cardName);
				if (k && !refMap.has(k)) refMap.set(k, r.file.path);
			}
			dv.container.createDiv({ cls: "sorcery-faq-heading", text: "FAQs" });
			const faqList = dv.container.createDiv({ cls: "sorcery-faq-list" });
			for (const entry of faqs) {
				const entryEl = faqList.createDiv({ cls: "sorcery-faq-entry" });
				appendTextWithCodexLinks(entryEl, "sorcery-faq-q", entry.question, refMap, dv);
				appendTextWithCodexLinks(entryEl, "sorcery-faq-a", entry.answer, refMap, dv);
			}
		}
	}

	// Applies monospace/overflow styling only; width comes from CSS
	// (`.prompt { width: fit-content }` + `white-space: pre` on items).
	function styleSuggestionModal() {
		const styleEl = document.createElement("style");
		styleEl.textContent = `
			.suggestion-container,
			.prompt-results,
			.modal-container .suggestion-container,
			.modal-container .prompt-results {
				font-family: var(--font-monospace) !important;
				font-size: 0.92rem !important;
				line-height: 1.15 !important;
				font-variant-numeric: tabular-nums !important;
				min-width: min(580px, 100vw) !important;
				max-width: 100vw !important;
				max-height: 75vh !important;
				overflow-x: auto !important;
				overflow-y: scroll !important;
			}
			.suggestion-container .suggestion-item,
			.prompt-results .suggestion-item,
			.suggestion-container .suggestion-item.is-selected,
			.prompt-results .suggestion-item.is-selected {
				font-family: var(--font-monospace) !important;
				font-size: 0.92rem !important;
				font-variant-numeric: tabular-nums !important;
				white-space: pre !important;
				width: max-content !important;
				min-width: 100% !important;
				padding-left: 8px !important;
				padding-right: 12px !important;
			}
			.prompt-input,
			.prompt-input:focus,
			.prompt-input:not(:placeholder-shown) {
				padding-left: 1.65rem !important;
				padding-right: 1.65rem !important;
				background-image: none !important;
				-webkit-appearance: none !important;
				appearance: none !important;
			}
		`;
		document.head.appendChild(styleEl);
		return () => styleEl.remove();
	}

	async function withStyledSuggestions(fn, opts = {}) {
		const stop = styleSuggestionModal();
		// After items paint, set their minWidth to the container's full scrollWidth so
		// the is-selected background reaches the right edge when scrolling horizontally.
		// min-width:100% (in CSS) only covers the visible width, not the scroll width.
		requestAnimationFrame(() => requestAnimationFrame(() => {
			for (const sel of [".prompt-results", ".suggestion-container"]) {
				for (const c of document.querySelectorAll(sel)) {
					const sw = c.scrollWidth;
					if (sw <= c.clientWidth) continue;
					for (const item of c.querySelectorAll(".suggestion-item")) {
						item.style.minWidth = sw + "px";
					}
				}
			}
		}));
		try {
			return await fn();
		} finally {
			stop();
		}
	}

	function padColumn(value, width, align = "left") {
		const text = String(value ?? "").trim();
		return align === "right" ? text.padStart(width) : text.padEnd(width);
	}

	function maxStringLength(values, fallback = 0) {
		return Math.max(fallback, ...values.map((v) => String(v ?? "").trim().length));
	}

	function finishRank(finish) {
		const f = String(finish ?? "").toLowerCase().trim();
		if (f === "standard") return 0;
		if (f === "foil") return 1;
		if (f === "rainbow") return 2;
		return 3;
	}

	function displayProduct(value) {
		return String(value ?? "").replace(/_/g, " ").trim();
	}

	async function chooseVariant(config, suggest, query = "", placeholder = "", opts = {}) {
		const q = String(query || "").trim().toLowerCase();
		const allowedTypes = Array.isArray(opts.types) && opts.types.length ? new Set(opts.types) : null;
		// Candidates come from the API (one per printing). The returned candidate's
		// `.file` is the per-card summary note and `.slug` identifies the printing
		// within fm.ownership[slug].
		const apiSource = await loadApiData(config);
		const apiCards = apiSource?.data || [];
		const summaryFileCache = new Map();
		const summaryFileFor = (cardName) => {
			if (summaryFileCache.has(cardName)) return summaryFileCache.get(cardName);
			const path =
				cardSummaryPathForName(config, cardName) ||
				cardNotePath(config, cardName);
			const f = app.vault.getAbstractFileByPath(path) || null;
			summaryFileCache.set(cardName, f);
			return f;
		};
		const built = [];
		for (const card of apiCards) {
			const guardian = card.guardian || {};
			for (const set of card.sets || []) {
				const meta = set.metadata || {};
				const type = String(meta.type ?? guardian.type ?? "");
				const rarity = String(meta.rarity ?? guardian.rarity ?? "");
				for (const variant of set.variants || []) {
					built.push({
						file: summaryFileFor(card.name),
						cardName: card.name,
						setName: set.name,
						slug: variant.slug,
						type,
						rarity,
						product: variant.product || "",
						finish: variant.finish || "",
					});
				}
			}
		}
		const candidates = built
			.filter((v) => {
				if (allowedTypes && !allowedTypes.has(v.type)) return false;
				if (!q) return true;
				return [v.cardName, v.setName, v.slug].join(" ").toLowerCase().includes(q);
			})
			.sort(
				(a, b) =>
					a.cardName.localeCompare(b.cardName, undefined, { sensitivity: "base" }) ||
					a.setName.localeCompare(b.setName, undefined, { sensitivity: "base" }) ||
					finishRank(a.finish) - finishRank(b.finish) ||
					a.slug.localeCompare(b.slug, undefined, { sensitivity: "base" }),
			);

		if (!candidates.length) {
			new Notice(`No cards found${q ? `: ${q}` : ""}`, 5000);
			return null;
		}

		const ALL_COLS = ["cardName", "setName", "type", "finish", "product"];
		const columns = Array.isArray(opts.columns) && opts.columns.length ? opts.columns : ALL_COLS;

		// Deduplicate by the visible key so identical-looking rows don't appear
		let displayed = candidates;
		if (columns.length < ALL_COLS.length) {
			const seen = new Set();
			displayed = candidates.filter((c) => {
				const k = columns.map((col) =>
					col === "product" ? displayProduct(c.product) : c[col]
				).join("\x00");
				if (seen.has(k)) return false;
				seen.add(k);
				return true;
			});
		}

		if (displayed.length === 1) return displayed[0];

		const widths = {
			cardName: columns.includes("cardName") ? maxStringLength(displayed.map((c) => c.cardName)) : 0,
			setName:  columns.includes("setName")  ? maxStringLength(displayed.map((c) => c.setName))  : 0,
			type:     columns.includes("type")     ? maxStringLength(displayed.map((c) => c.type))     : 0,
			finish:   columns.includes("finish")   ? maxStringLength(displayed.map((c) => c.finish))   : 0,
			product:  columns.includes("product")  ? maxStringLength(displayed.map((c) => displayProduct(c.product))) : 0,
		};
		const labels = displayed.map((c) => {
			const parts = [];
			if (columns.includes("cardName")) parts.push(` ${padColumn(c.cardName, widths.cardName)} `);
			if (columns.includes("setName"))  parts.push(` ${padColumn(c.setName,  widths.setName)} `);
			if (columns.includes("type"))     parts.push(` ${padColumn(c.type,     widths.type)} `);
			if (columns.includes("finish"))   parts.push(` ${padColumn(c.finish,   widths.finish)} `);
			if (columns.includes("product"))  parts.push(` ${padColumn(displayProduct(c.product), widths.product)} `);
			return parts.join("|").trimEnd();
		});

		return await withStyledSuggestions(() => suggest(labels, displayed, placeholder || undefined), { labels });
	}

	function createSearchWidget(parent, placeholder) {
		const widget = parent.createDiv({ cls: "sorcery-search-widget" });
		const input = widget.createEl("input", { type: "text", placeholder });
		return { widget, input };
	}

	function createDropdownWidget(parent, defaultLabel, config, onChange) {
		const root = parent.createDiv({ cls: "sorcery-dropdown" });
		const button = root.createEl("button", {
			cls: "sorcery-dropdown-button",
			attr: {
				type: "button",
				"aria-haspopup": "listbox",
				"aria-expanded": "false",
			},
		});
		const menu = document.createElement("div");
		menu.className = "sorcery-dropdown-menu";
		menu.setAttribute("role", "listbox");
		document.body.appendChild(menu);
		let value = "";
		let selectedLabel = defaultLabel;
		let selectedIcon = null;
		let hasIconOptions = false;
		const options = [];
		const renderLabel = (host, label, iconName) => {
			host.replaceChildren();
			const wrap = document.createElement("span");
			wrap.className = "sorcery-dropdown-label";
			if (iconName) {
				const src = iconPath(config, iconName);
				if (src) {
					const img = document.createElement("img");
					img.className = "sorcery-dropdown-icon";
					img.alt = String(label);
					img.src = src;
					wrap.appendChild(img);
				}
			}
			wrap.appendChild(document.createTextNode(String(label)));
			host.appendChild(wrap);
		};
		const renderOptionLabel = (host, label, iconName) => {
			host.replaceChildren();
			if (iconName) {
				const src = iconPath(config, iconName);
				if (src) {
					const img = document.createElement("img");
					img.className = "sorcery-dropdown-icon";
					img.alt = String(label);
					img.src = src;
					host.appendChild(img);
				}
			}
			const text = document.createElement("span");
			text.className = "sorcery-dropdown-option-label";
			text.textContent = String(label);
			host.appendChild(text);
		};
		const updateButton = () => {
			renderLabel(button, selectedLabel, selectedIcon);
			button.setAttribute("aria-label", selectedLabel);
		};
		const positionMenu = () => {
			const rect = button.getBoundingClientRect();
			const minW = Math.max(112, Math.ceil(rect.width));
			const left = Math.max(
				8,
				Math.min(rect.left, window.innerWidth - minW - 8),
			);
			const top = Math.min(rect.bottom + 4, window.innerHeight - 8);
			menu.style.width = "max-content";
			menu.style.minWidth = `${minW}px`;
			menu.style.maxWidth = "280px";
			menu.style.left = `${left}px`;
			menu.style.top = `${top}px`;
		};
		let openAc = null;
		const setOpen = (open) => {
			if (open && !root.isConnected) return;
			if (openAc) { openAc.abort(); openAc = null; }
			root.classList.toggle("is-open", open);
			menu.classList.toggle("is-open", open);
			button.setAttribute("aria-expanded", open ? "true" : "false");
			if (open) {
				if (!menu.isConnected) document.body.appendChild(menu);
				positionMenu();
				openAc = new AbortController();
				const sig = openAc.signal;
				window.addEventListener("scroll", () => {
					if (root.classList.contains("is-open")) positionMenu();
				}, { capture: true, signal: sig });
				window.addEventListener("resize", () => {
					if (root.classList.contains("is-open")) positionMenu();
				}, { signal: sig });
				document.addEventListener("click", (event) => {
					if (!root.contains(event.target) && !menu.contains(event.target)) {
						setOpen(false);
					}
				}, { capture: true, signal: sig });
			} else {
				button.blur();
			}
		};
		const syncSelection = () => {
			for (const option of options) {
				const selected = option.value === value;
				option.item.classList.toggle("is-selected", selected);
				option.item.setAttribute("aria-selected", selected ? "true" : "false");
			}
		};
		let rafId = null;
		const fitWidth = () => {
			if (rafId !== null) return;
			rafId = requestAnimationFrame(() => {
				rafId = null;
				if (!root.isConnected) return;
				const labels = [defaultLabel, ...options.map((o) => o.label)];
				const styles = getComputedStyle(button);
				const font =
					styles.font ||
					`${styles.fontStyle} ${styles.fontVariant} ${styles.fontWeight} ${styles.fontSize} / ${styles.lineHeight} ${styles.fontFamily}`;
				const canvas = document.createElement("canvas");
				const ctx = canvas.getContext("2d");
				const longest = labels.reduce(
					(best, label) => (label.length > best.length ? label : best),
					"",
				);
				let width = 112;
				if (longest) {
					if (ctx) {
						ctx.font = font;
						width = Math.ceil(ctx.measureText(longest).width + 42);
					} else {
						width = Math.ceil(longest.length * 9 + 42);
					}
				}
				if (hasIconOptions) width += 24;
				width = Math.max(112, Math.min(280, width));
				root.style.width = `${width}px`;
				root.style.minWidth = `${width}px`;
			});
		};
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			setOpen(!root.classList.contains("is-open"));
		});
		let disconnectTimer = null;
		const disconnectObs = new MutationObserver(() => {
			if (!root.isConnected) {
				if (disconnectTimer !== null) return;
				disconnectTimer = setTimeout(() => {
					disconnectTimer = null;
					if (!root.isConnected) { setOpen(false); menu.remove(); disconnectObs.disconnect(); }
				}, 200);
			} else if (disconnectTimer !== null) {
				clearTimeout(disconnectTimer);
				disconnectTimer = null;
			}
		});
		disconnectObs.observe(document.body, { childList: true, subtree: true });
		updateButton();
		return {
			root,
			button,
			menu,
			get value() {
				return value;
			},
			set value(nextValue) {
				value = nextValue;
				syncSelection();
				const selected = options.find((option) => option.value === value);
				if (selected) {
					selectedLabel = selected.label;
					selectedIcon = selected.iconName || null;
					updateButton();
				}
			},
			addOption(label, optionValue, iconName = null) {
				if (iconName) hasIconOptions = true;
				const item = document.createElement("button");
				item.className = "sorcery-dropdown-option";
				item.type = "button";
				item.setAttribute("role", "option");
				renderOptionLabel(item, label, iconName);
				item.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					value = optionValue;
					selectedLabel = label;
					selectedIcon = iconName;
					syncSelection();
					updateButton();
					setOpen(false);
					if (typeof onChange === "function") onChange();
				});
				menu.appendChild(item);
				options.push({ label, value: optionValue, iconName, item });
				if (optionValue === "" && value === "") {
					selectedLabel = label;
					selectedIcon = iconName;
					updateButton();
				}
				syncSelection();
				fitWidth();
			},
			fitWidth,
			setOpen,
		};
	}

	function createCheckboxDropdown(parent, defaultLabel, onChange, opts = {}) {
		const root = parent.createDiv({ cls: "sorcery-dropdown" });
		const button = root.createEl("button", {
			cls: "sorcery-dropdown-button",
			attr: { type: "button", "aria-haspopup": "true", "aria-expanded": "false" },
		});
		const menu = document.createElement("div");
		menu.className = "sorcery-dropdown-menu sorcery-checkbox-menu";
		document.body.appendChild(menu);
		const selected = new Set();
		const options = [];
		const notify = () => { if (typeof onChange === "function") onChange(); };
		const updateButton = () => {
			button.replaceChildren();
			const wrap = document.createElement("span");
			wrap.className = "sorcery-dropdown-label";
			wrap.textContent =
				(selected.size === 0 || selected.size === options.length) ? defaultLabel : `${defaultLabel} (${selected.size})`;
			button.appendChild(wrap);
			button.setAttribute("aria-label", wrap.textContent);
		};
		const positionMenu = () => {
			const rect = button.getBoundingClientRect();
			const minW = Math.max(140, Math.ceil(rect.width));
			const left = Math.max(8, Math.min(rect.left, window.innerWidth - minW - 8));
			const top = Math.min(rect.bottom + 4, window.innerHeight - 8);
			menu.style.width = "max-content";
			menu.style.minWidth = `${minW}px`;
			menu.style.maxWidth = "280px";
			menu.style.left = `${left}px`;
			menu.style.top = `${top}px`;
		};
		let openAc = null;
		const setOpen = (open) => {
			if (open && !root.isConnected) return;
			if (openAc) { openAc.abort(); openAc = null; }
			root.classList.toggle("is-open", open);
			menu.classList.toggle("is-open", open);
			button.setAttribute("aria-expanded", open ? "true" : "false");
			if (open) {
				if (!menu.isConnected) document.body.appendChild(menu);
				positionMenu();
				openAc = new AbortController();
				const sig = openAc.signal;
				window.addEventListener("scroll", () => {
					if (root.classList.contains("is-open")) positionMenu();
				}, { capture: true, signal: sig });
				window.addEventListener("resize", () => {
					if (root.classList.contains("is-open")) positionMenu();
				}, { signal: sig });
				document.addEventListener("click", (event) => {
					if (!root.contains(event.target) && !menu.contains(event.target)) {
						setOpen(false);
					}
				}, { capture: true, signal: sig });
			} else {
				button.blur();
			}
		};
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			setOpen(!root.classList.contains("is-open"));
		});
		let disconnectTimer = null;
		const disconnectObs = new MutationObserver(() => {
			if (!root.isConnected) {
				if (disconnectTimer !== null) return;
				disconnectTimer = setTimeout(() => {
					disconnectTimer = null;
					if (!root.isConnected) { setOpen(false); menu.remove(); disconnectObs.disconnect(); }
				}, 200);
			} else if (disconnectTimer !== null) {
				clearTimeout(disconnectTimer);
				disconnectTimer = null;
			}
		});
		disconnectObs.observe(document.body, { childList: true, subtree: true });
		let matchMode = opts.defaultMatch === "and" ? "and" : "or";
		let modeAnyBtn = null, modeAllBtn = null;
		const syncModeButtons = () => {
			if (!modeAnyBtn) return;
			modeAnyBtn.classList.toggle("is-active", matchMode === "or");
			modeAllBtn.classList.toggle("is-active", matchMode === "and");
		};
		if (opts.modeToggle) {
			const modeRow = document.createElement("div");
			modeRow.className = "sorcery-checkbox-mode";
			const mk = (label, mode) => {
				const b = document.createElement("button");
				b.type = "button";
				b.className = "sorcery-checkbox-mode-btn";
				b.textContent = label;
				b.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					if (matchMode === mode) return;
					matchMode = mode;
					syncModeButtons();
					notify();
				});
				return b;
			};
			modeAnyBtn = mk("ANY", "or");
			modeAllBtn = mk("ALL", "and");
			modeRow.appendChild(modeAnyBtn);
			modeRow.appendChild(modeAllBtn);
			menu.appendChild(modeRow);
			syncModeButtons();
		}
		if (!opts.noClear) {
			const clearBtn = document.createElement("button");
			clearBtn.className = "sorcery-checkbox-clear";
			clearBtn.type = "button";
			clearBtn.textContent = "Clear";
			clearBtn.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				selected.clear();
				for (const opt of options) { opt.checkbox.checked = false; opt.item.classList.remove("is-checked"); }
				updateButton();
				notify();
			});
			menu.appendChild(clearBtn);
		}
		updateButton();
		return {
			root,
			get selectedValues() { return selected; },
			get matchMode() { return matchMode; },
			setMatchMode(mode) { matchMode = mode === "and" ? "and" : "or"; syncModeButtons(); },
			fitWidth() {
				const labels = [defaultLabel, ...options.map((o) => o.label)];
				const longest = labels.reduce((a, b) => (a.length > b.length ? a : b), "");
				const width = Math.max(140, Math.min(280, longest.length * 9 + 52));
				root.style.width = `${width}px`;
				root.style.minWidth = `${width}px`;
			},
			setSelected(values) {
				const want = new Set((values || []).map((v) => String(v)));
				selected.clear();
				for (const opt of options) {
					const on = want.has(String(opt.value));
					opt.checkbox.checked = on;
					opt.item.classList.toggle("is-checked", on);
					if (on) selected.add(opt.value);
				}
				updateButton();
			},
			addOption(label, value, initiallyChecked = false) {
				const item = document.createElement("label");
				item.className = "sorcery-checkbox-option";
				const checkbox = document.createElement("input");
				checkbox.type = "checkbox";
				checkbox.value = String(value);
				const text = document.createElement("span");
				text.textContent = label;
				item.appendChild(checkbox);
				item.appendChild(text);
				item.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					checkbox.checked = !checkbox.checked;
					if (checkbox.checked) selected.add(value);
					else selected.delete(value);
					item.classList.toggle("is-checked", checkbox.checked);
					updateButton();
					notify();
				});
				if (initiallyChecked) {
					checkbox.checked = true;
					selected.add(value);
					item.classList.add("is-checked");
					updateButton();
				}
				menu.appendChild(item);
				options.push({ label, value, checkbox, item });
			},
		};
	}

	async function renderCollection(dv) {
		const isActive = beginTrackedRender(dv.container);
		const current = await awaitCurrentFm(dv);
		if (!current || !isActive()) return;
		const config = await loadConfig();
		if (!isActive()) return;
		const all = await loadVariantRows(config, dv);
		if (!isActive()) return;
		const pageSet = current.setName ?? null;
		const isSetPage = Boolean(pageSet);
		const filtered = isSetPage ? all.filter((p) => p.setName === pageSet) : all;

		if (isSetPage) {
			const stats = dv.container.createDiv({ cls: "sorcery-stats" });
			const output = dv.container.createDiv({ cls: "sorcery-output" });
			return renderSet(dv, config, filtered, stats, output);
		}

		// Do ALL async I/O before touching the DOM so Dataview cannot wipe
		// dv.container between awaits and detach the controls div.
		const apiSource = await loadApiData(config);
		if (!isActive()) return;
		const apiCards = apiSource?.data || [];
		const metaByVariant = new Map();
		for (const card of apiCards) {
			const guardian = card.guardian || {};
			const hasBooster = (card.sets || []).some((s) => (s.variants || []).some((v) => v.product === "Booster"));
			const costIsX = guardian.cost === null && !["Site", "Avatar"].includes(guardian.type || "") && hasBooster;
			for (const set of card.sets || []) {
				for (const variant of set.variants || []) {
					metaByVariant.set(
						`${card.name}|${set.name}|${variant.finish}|${variant.product}|${variant.slug}`,
						{
							cost: guardian.cost,
							costIsX,
							elements: splitElements(card.elements),
						},
					);
				}
			}
		}
		const variantKey = (p) =>
			`${p.cardName}|${p.setName}|${p.finish}|${p.product}|${p.slug}`;
		const metaFor = (p) => metaByVariant.get(variantKey(p)) || {};
		const costFor = (p) => {
			const meta = metaFor(p);
			const cost = meta.cost ?? p.cost;
			if (cost == null) return meta.costIsX ? "X" : null;
			const num = Number(cost);
			return Number.isFinite(num) ? num : null;
		};
		const elementsFor = (p) =>
			splitElements(
				Array.isArray(p.elements) && p.elements.length
					? p.elements
					: metaFor(p).elements || [],
			);
		const allSubtypes = [
			...new Set(
				apiCards.flatMap((card) =>
					splitElements(card.subTypes || ""),
				),
			),
		].sort();
		const allKeywords = [
			...new Set(
				apiCards.flatMap((card) => {
					const guardian = card.guardian || {};
					const rulesTexts = [
						guardian.rulesText || "",
						...(card.sets || []).map((s) => (s.metadata || {}).rulesText || ""),
					];
					return rulesTexts.flatMap((rt) => extractKeywordsFromRules(rt));
				}),
			),
		].sort();

		// All async work done; DOM manipulation below is now uninterrupted.
		const topbar = dv.container.createDiv({ cls: "sorcery-deck-actions" });
		const fireMode = (mode) => {
			globalThis.__sorceryStoragePreselect = { mode };
			app.commands.executeCommandById("quickadd:choice:sorcery-edit-binder");
		};
		[
			{ label: "Add Cards",    mode: "add" },
			{ label: "Remove Cards", mode: "remove" },
			{ label: "Move Card",    mode: "move" },
		].forEach(({ label, mode }) => {
			const btn = topbar.createEl("button", {
				cls: "sorcery-action-btn",
				text: label,
				attr: { type: "button" },
			});
			btn.addEventListener("click", () => fireMode(mode));
		});

		const controls = dv.container.createDiv({ cls: "sorcery-controls" });
		const { widget: searchWidget, input: search } = createSearchWidget(
			controls,
			"Search cards...",
		);
		const createDropdownWidget = (parent, defaultLabel) => {
			const root = parent.createDiv({ cls: "sorcery-dropdown" });
			const button = root.createEl("button", {
				cls: "sorcery-dropdown-button",
				attr: {
					type: "button",
					"aria-haspopup": "listbox",
					"aria-expanded": "false",
				},
			});
			const menu = document.createElement("div");
			menu.className = "sorcery-dropdown-menu";
			menu.setAttribute("role", "listbox");
			document.body.appendChild(menu);
			let value = "";
			let selectedLabel = defaultLabel;
			let selectedIcon = null;
			let hasIconOptions = false;
			const options = [];
			const renderLabel = (host, label, iconName) => {
				host.replaceChildren();
				const wrap = document.createElement("span");
				wrap.className = "sorcery-dropdown-label";
				if (iconName) {
					const src = iconPath(config, iconName);
					if (src) {
						const img = document.createElement("img");
						img.className = "sorcery-dropdown-icon";
						img.alt = String(label);
						img.src = src;
						wrap.appendChild(img);
					}
				}
				wrap.appendChild(document.createTextNode(String(label)));
				host.appendChild(wrap);
			};
			const renderOptionLabel = (host, label, iconName) => {
				host.replaceChildren();
				if (iconName) {
					const src = iconPath(config, iconName);
					if (src) {
						const img = document.createElement("img");
						img.className = "sorcery-dropdown-icon";
						img.alt = String(label);
						img.src = src;
						host.appendChild(img);
					}
				}
				const text = document.createElement("span");
				text.className = "sorcery-dropdown-option-label";
				text.textContent = String(label);
				host.appendChild(text);
			};
			const updateButton = () => {
				renderLabel(button, selectedLabel, selectedIcon);
				button.setAttribute("aria-label", selectedLabel);
			};
			const positionMenu = () => {
				const rect = button.getBoundingClientRect();
				const width = Math.max(112, Math.ceil(rect.width));
				const left = Math.max(
					8,
					Math.min(rect.left, window.innerWidth - width - 8),
				);
				const top = Math.min(rect.bottom + 4, window.innerHeight - 8);
				menu.style.width = `${width}px`;
				menu.style.left = `${left}px`;
				menu.style.top = `${top}px`;
			};
			let openAc = null;
			const setOpen = (open) => {
				if (open && !root.isConnected) return;
				if (openAc) { openAc.abort(); openAc = null; }
				root.classList.toggle("is-open", open);
				menu.classList.toggle("is-open", open);
				button.setAttribute("aria-expanded", open ? "true" : "false");
				if (open) {
					if (!menu.isConnected) document.body.appendChild(menu);
					positionMenu();
					openAc = new AbortController();
					const sig = openAc.signal;
					window.addEventListener("scroll", () => {
						if (root.classList.contains("is-open")) positionMenu();
					}, { capture: true, signal: sig });
					window.addEventListener("resize", () => {
						if (root.classList.contains("is-open")) positionMenu();
					}, { signal: sig });
					document.addEventListener("click", (event) => {
						if (!root.contains(event.target) && !menu.contains(event.target)) {
							setOpen(false);
						}
					}, { capture: true, signal: sig });
				} else {
					button.blur();
				}
			};
			const syncSelection = () => {
				for (const option of options) {
					const selected = option.value === value;
					option.item.classList.toggle("is-selected", selected);
					option.item.setAttribute(
						"aria-selected",
						selected ? "true" : "false",
					);
				}
			};
			let rafId = null;
			const fitWidth = () => {
				if (rafId !== null) return;
				rafId = requestAnimationFrame(() => {
					rafId = null;
					if (!root.isConnected) return;
					const labels = [defaultLabel, ...options.map((o) => o.label)];
					const styles = getComputedStyle(button);
					const font =
						styles.font ||
						`${styles.fontStyle} ${styles.fontVariant} ${styles.fontWeight} ${styles.fontSize} / ${styles.lineHeight} ${styles.fontFamily}`;
					const canvas = document.createElement("canvas");
					const ctx = canvas.getContext("2d");
					const longest = labels.reduce(
						(best, label) => (label.length > best.length ? label : best),
						"",
					);
					let width = 112;
					if (longest) {
						if (ctx) {
							ctx.font = font;
							width = Math.ceil(ctx.measureText(longest).width + 42);
						} else {
							width = Math.ceil(longest.length * 9 + 42);
						}
					}
					if (hasIconOptions) width += 24;
					width = Math.max(112, Math.min(280, width));
					root.style.width = `${width}px`;
					root.style.minWidth = `${width}px`;
				});
			};
			button.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				setOpen(!root.classList.contains("is-open"));
			});
			let disconnectTimer = null;
			const disconnectObs = new MutationObserver(() => {
				if (!root.isConnected) {
					if (disconnectTimer !== null) return;
					disconnectTimer = setTimeout(() => {
						disconnectTimer = null;
						if (!root.isConnected) { setOpen(false); menu.remove(); disconnectObs.disconnect(); }
					}, 200);
				} else if (disconnectTimer !== null) {
					clearTimeout(disconnectTimer);
					disconnectTimer = null;
				}
			});
			disconnectObs.observe(document.body, { childList: true, subtree: true });
			updateButton();
			return {
				root,
				button,
				menu,
				get value() {
					return value;
				},
				set value(nextValue) {
					value = nextValue;
					syncSelection();
					const selected = options.find((option) => option.value === value);
					if (selected) {
						selectedLabel = selected.label;
						selectedIcon = selected.iconName || null;
						updateButton();
					}
				},
				addOption(label, optionValue, iconName = null) {
					if (iconName) hasIconOptions = true;
					const item = document.createElement("button");
					item.className = "sorcery-dropdown-option";
					item.type = "button";
					item.setAttribute("role", "option");
					renderOptionLabel(item, label, iconName);
					item.addEventListener("click", (event) => {
						event.preventDefault();
						event.stopPropagation();
						value = optionValue;
						selectedLabel = label;
						selectedIcon = iconName;
						syncSelection();
						updateButton();
						setOpen(false);
						renderRows();
					});
					menu.appendChild(item);
					options.push({ label, value: optionValue, iconName, item });
					if (optionValue === "" && value === "") {
						selectedLabel = label;
						selectedIcon = iconName;
						updateButton();
					}
					syncSelection();
					fitWidth();
				},
				fitWidth,
				setOpen,
			};
		};
		const setFilter = createDropdownWidget(controls, "All sets");
		const typeFilter = createDropdownWidget(controls, "All types");
		const rarityFilter = createDropdownWidget(controls, "All rarities");
		const costFilter = createDropdownWidget(controls, "All costs");
		const elementFilter = createCheckboxDropdown(controls, "Elements", () => renderRows(), { modeToggle: true });
		const finishFilter = createDropdownWidget(controls, "All finishes");
		setFilter.addOption("All sets", "");
		typeFilter.addOption("All types", "");
		rarityFilter.addOption("All rarities", "");
		costFilter.addOption("All costs", "");
		finishFilter.addOption("All finishes", "");
		const setOrder = setOrderFor(config);
		const sets = [...new Set(setOrder.filter(Boolean))].sort((a, b) => {
			const ai = setOrder.indexOf(a);
			const bi = setOrder.indexOf(b);
			if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
			return a.localeCompare(b, undefined, { sensitivity: "base" });
		});
		const types = ["Avatar", "Artifact", "Aura", "Minion", "Magic", "Site"];
		const rarities = Object.keys(config.rarityTargets).sort(
			(a, b) =>
				(config.rarityTargets[a] ?? 99) - (config.rarityTargets[b] ?? 99),
		);
		const costValues = costOrderFor(config);
		const elementValues = Object.keys(config.iconMap).sort((a, b) =>
			a === "None" ? 1 : b === "None" ? -1 : a.localeCompare(b),
		);
		const finishValues = ["Standard", "Foil", "Rainbow"];
		for (const s of sets) setFilter.addOption(s, s);
		for (const t of types) typeFilter.addOption(t, t);
		for (const r of rarities) rarityFilter.addOption(r, r);
		for (const c of costValues) costFilter.addOption(String(c), String(c));
		costFilter.addOption("X", "X");
		for (const e of elementValues)
			if (e !== "None") elementFilter.addOption(e, e, true);
		elementFilter.addOption("Neutral", "__neutral__", true);
		for (const f of finishValues) finishFilter.addOption(f, f);
		finishFilter.value = "Standard";
		[
			setFilter,
			typeFilter,
			rarityFilter,
			costFilter,
			elementFilter,
			finishFilter,
		].forEach((widget) => widget.fitWidth());
		const subtypeFilter = createCheckboxDropdown(controls, "Subtypes", () => renderRows(), { modeToggle: true, defaultMatch: "and" });
		const keywordFilter = createCheckboxDropdown(controls, "Keywords", () => renderRows(), { modeToggle: true, defaultMatch: "and" });
		for (const s of allSubtypes) subtypeFilter.addOption(s, s);
		for (const k of allKeywords) keywordFilter.addOption(k, k);
		subtypeFilter.fitWidth();
		keywordFilter.fitWidth();
		let ownedOnly = true;
		const ownedToggle = controls.createEl("button", {
			cls: "sorcery-view-toggle sorcery-owned-toggle",
			attr: { type: "button", title: "Owned only", "aria-pressed": "true" },
		});
		const makeOwnedIcon = (off) => {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.setAttribute("fill", "none");
			svg.setAttribute("aria-hidden", "true");
			svg.setAttribute("stroke", "currentColor");
			svg.setAttribute("stroke-width", "2");
			svg.setAttribute("stroke-linecap", "round");
			svg.setAttribute("stroke-linejoin", "round");
			const eye = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"path",
			);
			eye.setAttribute(
				"d",
				"M2.062 12.348a1 1 0 0 1 0-.696 11 11 0 0 1 19.876 0 1 1 0 0 1 0 .696 11 11 0 0 1-19.876 0Z",
			);
			const pupil = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"circle",
			);
			pupil.setAttribute("cx", "12");
			pupil.setAttribute("cy", "12");
			pupil.setAttribute("r", "3.25");
			svg.append(eye, pupil);
			if (off) {
				const slash = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"path",
				);
				slash.setAttribute("d", "M3 3l18 18");
				svg.appendChild(slash);
			}
			return svg;
		};
		const updateOwnedToggle = () => {
			ownedToggle.replaceChildren(makeOwnedIcon(!ownedOnly));
			ownedToggle.setAttribute("aria-pressed", ownedOnly ? "true" : "false");
			ownedToggle.setAttribute(
				"title",
				ownedOnly ? "Owned only (On)" : "Owned only (Off)",
			);
			ownedToggle.setAttribute("aria-label", "Owned only");
		};
		ownedToggle.addEventListener("click", (event) => {
			event.preventDefault();
			ownedOnly = !ownedOnly;
			updateOwnedToggle();
			renderRows();
		});
		updateOwnedToggle();
		const toggle = controls.createEl("button", {
			cls: "sorcery-view-toggle",
			attr: { title: "Toggle list/card view" },
		});
		let view = current.viewMode ?? "cards";
		const updateToggle = () => {
			const isList = view === "list";
			toggle.textContent = isList ? "▦" : "☰";
			toggle.setAttribute(
				"title",
				isList ? "Switch to card view" : "Switch to list view",
			);
		};
		updateToggle();
		const stats = dv.container.createDiv({ cls: "sorcery-stats" });
		const output = dv.container.createDiv({ cls: "sorcery-output" });
		// Configurable order — Avatar and Other are resolved inside the type dim.
		const collectionCmp = makeCardComparator(config, {
			dims: ["avatar", "other", "type", "rarity", "name", "set", "finish"],
			allItems: all,
			get: (p) => ({
				name: p.cardName,
				type: p.type,
				rarity: p.rarity,
				setName: p.setName,
				finish: p.finish,
			}),
		});
		const sortRows = (rows) => [...rows].sort(collectionCmp);
		const filterRows = (rows) => {
			const q = String(search.value || "")
				.trim()
				.toLowerCase();
			return rows.filter((p) => {
				if (setFilter.value && p.setName !== setFilter.value) return false;
				if (typeFilter.value && p.type !== typeFilter.value) return false;
				if (rarityFilter.value && p.rarity !== rarityFilter.value) return false;
				if (costFilter.value) {
					const cv = costFor(p);
					if (costFilter.value === "X" ? cv !== "X" : cv !== Number(costFilter.value)) return false;
				}
				const elemSel = elementFilter.selectedValues;
				if (elemSel.size === 0) return false;
				{
					const cardElems = elementsFor(p).filter((e) => e !== "None");
					const cardTags = cardElems.length ? cardElems : ["__neutral__"];
					const elemMatch = elementFilter.matchMode === "and"
						? [...elemSel].every((e) => cardTags.includes(e))
						: cardTags.some((e) => elemSel.has(e));
					if (!elemMatch) return false;
				}
				if (finishFilter.value && p.finish !== finishFilter.value) return false;
				if (subtypeFilter.selectedValues.size > 0) {
					const cardSubtypes = Array.isArray(p.subTypes)
						? p.subTypes
						: splitElements(p.subTypes);
					const subSel = subtypeFilter.selectedValues;
					const subOk = subtypeFilter.matchMode === "and"
						? [...subSel].every((s) => cardSubtypes.includes(s))
						: [...subSel].some((s) => cardSubtypes.includes(s));
					if (!subOk) return false;
				}
				if (keywordFilter.selectedValues.size > 0) {
					const cardKeywords = Array.isArray(p.keywords) ? p.keywords : [];
					const kwSel = keywordFilter.selectedValues;
					const kwOk = keywordFilter.matchMode === "and"
						? [...kwSel].every((k) => cardKeywords.includes(k))
						: [...kwSel].some((k) => cardKeywords.includes(k));
					if (!kwOk) return false;
				}
				if (!q) return true;
				return (
					String(p.cardName ?? "").toLowerCase().includes(q) ||
					String(p.rules ?? "").toLowerCase().includes(q)
				);
			});
		};
		const subtitleFor = (p) => {
			const suffix =
				p.finish === "Foil"
					? " - Foil"
					: p.finish === "Rainbow"
						? " - Rainbow"
						: "";
			return `${p.setName ?? ""}${suffix}`.trim();
		};
		const CHUNK_FIRST = app.isMobile ? 20 : 100;
		const CHUNK_REST = app.isMobile ? 20 : 30;
		let renderGen = 0;
		const renderRows = () => {
			const sourceRows = ownedOnly ? all.filter((p) => owned(p) > 0) : all;
			const rows = sortRows(filterRows(sourceRows));
			const totalCards = rows.reduce((sum, p) => sum + owned(p), 0);
			stats.textContent = `Cards: ${totalCards} / ${rows.length}`;
			output.replaceChildren();
			const gen = ++renderGen;
			if (view === "cards") {
				const data = output.createDiv({ cls: "sorcery-card-grid" });
				const renderCard = (p) => {
					const card = data.createDiv({ cls: "sorcery-card" });
					renderArtFrame(card, config, p, { alt: p.cardName ?? p.slug });
					const meta = card.createDiv({ cls: "sorcery-card-meta-row" });
					const body = meta.createDiv({ cls: "sorcery-card-body" });
					const title = body.createDiv({ cls: "sorcery-card-title" });
					title.appendChild(
						cardLink(dv, p.file.path, p.cardName ?? p.slug ?? p.file.name, p.slug),
					);
					body.createDiv({ cls: "sorcery-card-subtitle", text: subtitleFor(p) });
					meta.createDiv({ cls: "sorcery-collection-count", text: String(owned(p)) });
				};
				for (const p of rows.slice(0, CHUNK_FIRST)) renderCard(p);
				let offset = CHUNK_FIRST;
				const tick = () => {
					if (renderGen !== gen) return;
					for (const p of rows.slice(offset, offset + CHUNK_REST)) renderCard(p);
					offset += CHUNK_REST;
					if (offset < rows.length) requestAnimationFrame(tick);
				};
				if (offset < rows.length) requestAnimationFrame(tick);
			} else {
				const list = output.createDiv({ cls: "sorcery-collection-grid" });
				const longestLabel = rows.reduce((best, p) => {
					const label = String(p.cardName ?? p.slug ?? p.file.name ?? "");
					return label.length > best.length ? label : best;
				}, "");
				const longestSubtitle = rows.reduce((best, p) => {
					const subtitle = subtitleFor(p);
					return subtitle.length > best.length ? subtitle : best;
				}, "");
				const maxCount = String(rows.reduce((max, p) => Math.max(max, owned(p)), 0));
				let columnWidth = 220;
				const canvas = document.createElement("canvas");
				const ctx = canvas.getContext("2d");
				const styles = getComputedStyle(output);
				const font =
					styles.font ||
					`${styles.fontStyle} ${styles.fontVariant} ${styles.fontWeight} ${styles.fontSize} / ${styles.lineHeight} ${styles.fontFamily}`;
				if (ctx && (longestLabel || longestSubtitle)) {
					ctx.font = font;
					const labelWidth = ctx.measureText(longestLabel).width;
					const subtitleWidth = ctx.measureText(longestSubtitle).width;
					const countWidth = ctx.measureText(maxCount).width;
					// Fit body column (max of label/subtitle) + count badge
					// (countWidth + 32 padding/border/gap) + 40 item padding.
					columnWidth = Math.ceil(
						Math.max(labelWidth, subtitleWidth) + countWidth + 32 + 40,
					);
				} else if (longestLabel || longestSubtitle) {
					columnWidth = Math.ceil(
						Math.max(longestLabel.length, longestSubtitle.length) * 8 +
							maxCount.length * 8 +
							72,
					);
				}
				columnWidth = Math.max(180, Math.min(320, columnWidth));
				list.style.setProperty("--collection-column-width", `${columnWidth}px`);
				const renderItem = (p) => {
					const item = list.createDiv({ cls: "sorcery-collection-item" });
					const body = item.createDiv({ cls: "sorcery-collection-item-body" });
					const title = body.createDiv({ cls: "sorcery-card-title" });
					title.appendChild(
						cardLink(dv, p.file.path, p.cardName ?? p.slug ?? p.file.name, p.slug),
					);
					body.createDiv({
						cls: "sorcery-card-subtitle sorcery-collection-item-subtitle",
						text: subtitleFor(p),
					});
					item.createDiv({ cls: "sorcery-collection-count", text: String(owned(p)) });
				};
				for (const p of rows) renderItem(p);
			}
			if (stateKey) stateStore[stateKey] = captureState();
		};
		search.addEventListener("input", renderRows);
		toggle.onclick = () => {
			view = view === "list" ? "cards" : "list";
			updateToggle();
			renderRows();
		};
		// Session filter state, keyed by note path, shared across the Reading/Editing
		// renders of a page so a mode flip stays consistent. In-memory only: resets on
		// close (see resetObs below) or Obsidian restart.
		const stateStore = (globalThis.__sorceryCollectionState ||= {});
		const stateKey = dv.currentFilePath;
		const captureState = () => ({
			search: search.value || "",
			set: setFilter.value,
			type: typeFilter.value,
			rarity: rarityFilter.value,
			cost: costFilter.value,
			finish: finishFilter.value,
			elements: [...elementFilter.selectedValues],
			elementMatch: elementFilter.matchMode,
			subtypes: [...subtypeFilter.selectedValues],
			subtypeMatch: subtypeFilter.matchMode,
			keywords: [...keywordFilter.selectedValues],
			keywordMatch: keywordFilter.matchMode,
			ownedOnly,
			view,
		});
		const applyState = (st) => {
			if (!st) return;
			search.value = st.search || "";
			setFilter.value = st.set || "";
			typeFilter.value = st.type || "";
			rarityFilter.value = st.rarity || "";
			costFilter.value = st.cost || "";
			finishFilter.value = st.finish || "";
			if (Array.isArray(st.elements)) elementFilter.setSelected(st.elements);
			if (st.elementMatch) elementFilter.setMatchMode(st.elementMatch);
			if (Array.isArray(st.subtypes)) subtypeFilter.setSelected(st.subtypes);
			if (st.subtypeMatch) subtypeFilter.setMatchMode(st.subtypeMatch);
			if (Array.isArray(st.keywords)) keywordFilter.setSelected(st.keywords);
			if (st.keywordMatch) keywordFilter.setMatchMode(st.keywordMatch);
			if (typeof st.ownedOnly === "boolean") { ownedOnly = st.ownedOnly; updateOwnedToggle(); }
			if (st.view === "cards" || st.view === "list") { view = st.view; updateToggle(); }
		};
		if (stateKey) applyState(stateStore[stateKey]);
		// Clear stored filters only when the page is genuinely closed. A Reading<->Edit
		// flip tears down the container but keeps the leaf open, so state survives;
		// navigating away leaves no leaf on the path and resets on next open.
		if (stateKey) {
			const resetObs = new MutationObserver(() => {
				if (dv.container.isConnected) return;
				resetObs.disconnect();
				setTimeout(() => {
					let stillOpen = false;
					app.workspace.iterateAllLeaves((leaf) => {
						if (leaf?.view?.file?.path === stateKey) stillOpen = true;
					});
					if (!stillOpen) delete stateStore[stateKey];
				}, 600);
			});
			resetObs.observe(document.body, { childList: true, subtree: true });
		}
		renderRows();
	}

	async function renderSet(
		dv,
		configOverride,
		prefilteredRows,
		statsEl,
		outputEl,
	) {
		const current = (dv.currentFilePath && app.metadataCache.getCache(dv.currentFilePath)?.frontmatter)
			? { ...app.metadataCache.getCache(dv.currentFilePath).frontmatter, file: app.vault.getAbstractFileByPath(dv.currentFilePath) }
			: dv.current();
		if (!current) return;
		const config = configOverride || (await loadConfig());
		const setName = current.setName;
		const isPlaySet = current.setMode === "play";
		const manifestPath = resolvePath(config, [
			`${config.dataDir}/${config.manifestFile}`,
			`data/${config.manifestFile}`,
		]);
		if (!manifestPath) throw new Error("Missing set-manifests.json");
		const raw = await app.vault.adapter.read(manifestPath);
		const manifests = JSON.parse(raw);
		const tokenCardNames = new Set(config.tokenCards || []);
		const otherCardNames = new Set(config.otherCards || []);
		const cards = (manifests[setName] ?? []).filter(c => !tokenCardNames.has(c.cardName) || otherCardNames.has(c.cardName));
		const allVariants =
			prefilteredRows ||
			(await loadVariantRows(config, dv)).filter((p) => p.setName === setName);
		const variantsByCard = new Map();
		for (const v of allVariants) {
			if (!variantsByCard.has(v.cardName)) variantsByCard.set(v.cardName, []);
			variantsByCard.get(v.cardName).push(v);
		}
		const variantsForCard = (card) => {
			const all = variantsByCard.get(card.cardName) ?? [];
			return card.product ? all.filter((v) => v.product === card.product) : all;
		};
		const isAvatarCard = (cardName) =>
			(variantsByCard.get(cardName) ?? []).some((v) => v.type === "Avatar");
		const targetForSet = (rarity) =>
			isPlaySet ? (config.rarityTargets[rarity] ?? 1) : 1;
		const targetForCard = (card) =>
			isAvatarCard(card.cardName) || otherCardNames.has(card.cardName) ? 1 : targetForSet(card.rarity);
		const weightedTarget = cards.reduce((sum, c) => sum + targetForCard(c), 0);
		const weightedOwned = cards.reduce((sum, c) => {
			const ownedCount = ownedFromVariants(variantsForCard(c));
			return sum + Math.min(ownedCount, targetForCard(c));
		}, 0);
		statsEl.replaceChildren();
		const makeCompletionStar = () => {
			const star = document.createElement("span");
			star.className = "sorcery-completion-star";
			star.textContent = "★";
			star.setAttribute("aria-label", "Complete");
			star.title = "Complete";
			return star;
		};
		const statsLabel = statsEl.createDiv({ cls: "sorcery-set-stats" });
		statsLabel.textContent = `Cards (${weightedOwned}/${weightedTarget || 1})`;
		if (weightedTarget > 0 && weightedOwned >= weightedTarget)
			statsLabel.appendChild(makeCompletionStar());
		const statsProgress = statsEl.createEl("progress", {
			cls: "sorcery-set-progress",
			attr: { value: String(weightedOwned), max: String(weightedTarget || 1) },
		});
		statsProgress.value = weightedOwned;
		statsProgress.max = weightedTarget || 1;
		outputEl.replaceChildren();
		const rarityGrid = outputEl.createDiv({ cls: "sorcery-rarity-grid" });
		const grouped = new Map();
		for (const card of cards) {
			const key = isAvatarCard(card.cardName)
				? "Avatar"
				: otherCardNames.has(card.cardName)
					? "Other"
					: card.rarity || "Avatars";
			if (!grouped.has(key)) grouped.set(key, []);
			grouped.get(key).push(card);
		}
		// Grouping structure (rarity columns → type sub-groups) is fixed; only the
		// order of rarity columns and types within them follows config.
		const visibleRarities = ["Avatar", "Other", ...sortListsFor(config).rarityOrder].filter(
			(rarity) => (grouped.get(rarity) ?? []).length,
		);
		const typeOrder = sortListsFor(config).typeOrder;
		const typeRank = (name) => {
			const idx = typeOrder.indexOf(name);
			return idx === -1 ? 999 : idx;
		};
		const renderChecklistItem = (list, card) => {
			const row = list.createDiv({ cls: "sorcery-checklist-item" });
			const ownedCount = ownedFromVariants(variantsForCard(card));
			const target = targetForCard(card);
			const displayName = card.productLabel ? `${card.cardName} (${card.productLabel})` : card.cardName;
			// Link to the card note.
			const linkPath =
				cardSummaryPathForName(config, card.cardName) ||
				cardNotePath(config, card.cardName);
			const label = row.createDiv({ cls: "sorcery-checklist-label" });
			label.appendChild(cardLink(dv, linkPath || "", displayName, card.slug));
			if (isPlaySet) {
				const bubble = row.createDiv({
					cls: `sorcery-play-count-bubble${
						ownedCount > target
							? " is-overcomplete"
							: ownedCount >= target
								? " is-complete"
								: ""
					}`,
				});
				bubble.textContent = `${ownedCount} / ${target}`;
			} else if (ownedCount >= target) {
				const bubble = row.createDiv({ cls: "sorcery-base-owned-bubble" });
				bubble.textContent = "✓";
				bubble.setAttribute("aria-label", "Owned");
				bubble.title = "Owned";
			}
		};
		const buildSection = (parent, rarity) => {
			const items = grouped.get(rarity) ?? [];
			if (!items.length) return;
			let ownedSum = 0;
			let targetSum = 0;
			for (const card of items) {
				const target = targetForCard(card);
				const owned = ownedFromVariants(variantsForCard(card));
				ownedSum += Math.min(owned, target);
				targetSum += target;
			}
			const section = parent.createDiv({ cls: "sorcery-checklist-group" });
			const heading = section.createDiv({ cls: "sorcery-checklist-heading" });
			heading.textContent = `${rarity} (${ownedSum}/${targetSum})`;
			if (ownedSum >= targetSum)
				heading.appendChild(makeCompletionStar());
			const progress = section.createEl("progress", {
				cls: "sorcery-rarity-progress",
				attr: { value: String(ownedSum), max: String(targetSum) },
			});
			progress.value = ownedSum;
			progress.max = targetSum;
			if (rarity === "Avatar" || rarity === "Other") {
				const list = section.createDiv({ cls: "sorcery-checklist" });
				for (const card of items) renderChecklistItem(list, card);
				return;
			}
			const typeGroups = new Map();
			for (const card of items) {
				const typeName =
					card.type ||
					(variantsByCard.get(card.cardName) ?? []).find((v) => v.type)?.type ||
					"Unknown";
				if (!typeGroups.has(typeName)) typeGroups.set(typeName, []);
				typeGroups.get(typeName).push(card);
			}
			const orderedTypes = [...typeGroups.entries()].sort(
				([a], [b]) =>
					typeRank(a) - typeRank(b) || String(a).localeCompare(String(b)),
			);
			for (const [typeName, typeItems] of orderedTypes) {
				const typeWrap = section.createDiv({ cls: "sorcery-checklist-type" });
				if (typeName !== "Avatar") {
					typeWrap.createDiv({
						cls: "sorcery-checklist-type-heading",
						text: typeName,
					});
				}
				const list = typeWrap.createDiv({ cls: "sorcery-checklist" });
				for (const card of typeItems) renderChecklistItem(list, card);
			}
		};
		if (visibleRarities.length === 1) {
			rarityGrid.classList.add("sorcery-rarity-grid--single");
			buildSection(rarityGrid, visibleRarities[0]);
		} else {
			const PINNED_LEFT = ["Avatar", "Other"];
			const pinnedLeft = visibleRarities.filter(r => PINNED_LEFT.includes(r));
			const distributed = visibleRarities.filter(r => !PINNED_LEFT.includes(r));
			const row = rarityGrid.createDiv({ cls: "sorcery-rarity-row" });
			const left = row.createDiv({ cls: "sorcery-rarity-side sorcery-rarity-side--left" });
			const center = row.createDiv({ cls: "sorcery-rarity-center" });
			const right = row.createDiv({ cls: "sorcery-rarity-side sorcery-rarity-side--right" });
			if (pinnedLeft.length > 0) {
				// Wrap Avatar + Other in a column-flex container so they stack vertically
				const stack = left.createDiv();
				stack.style.cssText = "display:flex;flex-direction:column;gap:0.45rem;width:max-content;";
				for (const r of pinnedLeft) buildSection(stack, r);
				for (const group of stack.querySelectorAll(':scope > .sorcery-checklist-group')) {
					group.style.width = '100%';
					group.style.alignSelf = 'auto';
					group.style.boxSizing = 'border-box';
				}
				// Preserve the original center position: compute which distributed item lands in center
				// using the same mid formula as if all rarities were in one list
				const total = pinnedLeft.length + distributed.length;
				const centerIdx = Math.max(0, Math.min(Math.floor(total / 2) - pinnedLeft.length, distributed.length - 1));
				// Pre-center distributed items go in left alongside the pinned stack
				for (const r of distributed.slice(0, centerIdx)) buildSection(left, r);
				if (distributed.length > 0) buildSection(center, distributed[centerIdx]);
				for (const r of distributed.slice(centerIdx + 1)) buildSection(right, r);
			} else {
				// No pinned items: original left/center/right distribution
				const mid = Math.floor(distributed.length / 2);
				for (const r of distributed.slice(0, mid)) buildSection(left, r);
				for (const r of distributed.slice(mid, mid + 1)) buildSection(center, r);
				for (const r of distributed.slice(mid + 1)) buildSection(right, r);
			}
		}
	}

	async function renderSetPage(dv) {
		const isActive = beginTrackedRender(dv.container);
		const filePath = dv.currentFilePath;

		const getFm = () => {
			const cached = app.metadataCache.getCache(filePath)?.frontmatter;
			if (cached) return { ...cached, file: app.vault.getAbstractFileByPath(filePath) };
			const live = dv.current();
			if (live) return live;
			return null;
		};

		let current = getFm();
		if (!current) {
			await new Promise((resolve) => {
				const ref = app.metadataCache.on("resolved", () => {
					app.metadataCache.offref(ref);
					resolve();
				});
				setTimeout(resolve, 2000);
			});
			current = getFm();
		}
		if (!current || !isActive()) return;

		const config = await loadConfig();
		if (!isActive()) return;

		const setName = String(current.setName || "");
		if (!setName) {
			dv.container.createDiv({ text: "Missing setName in frontmatter." });
			return;
		}

		const VALID_MODES = ["base", "play", "base-rows", "play-rows"];
		let setMode = VALID_MODES.includes(String(current.setMode)) ? String(current.setMode) : "base";
		let baseSetBinders = (Array.isArray(current.baseSetBinders) ? current.baseSetBinders : []).map(String).filter(Boolean);
		let playSetBinders = (Array.isArray(current.playSetBinders) ? current.playSetBinders : []).map(String).filter(Boolean);
		// Alignment mode for Play Rows: "none" | "normal" | "perfect".
		const ALIGN_MODES = ["none", "normal", "perfect"];
		const ALIGN_LABELS = { none: "None", normal: "Align", perfect: "No Splits" };
		let playRowsAlign = ALIGN_MODES.includes(String(current.playRowsAlign))
			? String(current.playRowsAlign)
			: "none";
		let baseSlotsPerRow = Math.max(1, parseInt(current.baseSlotsPerRow) || 4);
		let baseSpecialSlots = Math.max(0, parseInt(current.baseSpecialSlots) || 0);
		let baseRowsPerPage = Math.max(1, parseInt(current.baseRowsPerPage) || 3);
		let playSlotsPerRow = Math.max(1, parseInt(current.playSlotsPerRow) || 4);
		let playSpecialSlots = Math.max(0, parseInt(current.playSpecialSlots) || 0);
		let playRowsPerPage = Math.max(1, parseInt(current.playRowsPerPage) || 3);

		const saveFm = async (updates) => {
			const file = app.vault.getAbstractFileByPath(filePath);
			if (!file) return;
			await app.fileManager.processFrontMatter(file, (fm) => Object.assign(fm, updates));
		};

		// Ensure all per-mode keys are persisted so values survive session restarts
		const missingKeys = {};
		if (current.baseSlotsPerRow == null) missingKeys.baseSlotsPerRow = baseSlotsPerRow;
		if (current.baseSpecialSlots == null) missingKeys.baseSpecialSlots = baseSpecialSlots;
		if (current.baseRowsPerPage == null) missingKeys.baseRowsPerPage = baseRowsPerPage;
		if (current.playSlotsPerRow == null) missingKeys.playSlotsPerRow = playSlotsPerRow;
		if (current.playSpecialSlots == null) missingKeys.playSpecialSlots = playSpecialSlots;
		if (current.playRowsPerPage == null) missingKeys.playRowsPerPage = playRowsPerPage;
		if (Object.keys(missingKeys).length) saveFm(missingKeys);

		const tabBar = dv.container.createDiv({ cls: "sorcery-set-tabs" });
		const contentEl = dv.container.createDiv({ cls: "sorcery-set-content" });
		const tabBtns = {};

		const renderModeContent = async (mode) => {
			if (!isActive()) return;
			contentEl.replaceChildren();
			if (mode === "base" || mode === "play") {
				await renderSetChecklist(mode);
			} else {
				await renderSetRows(mode);
			}
		};

		async function renderSetChecklist(mode) {
			const isPlaySet = mode === "play";
			const binders = isPlaySet ? playSetBinders : baseSetBinders;
			const binderField = isPlaySet ? "playSetBinders" : "baseSetBinders";

			const manifestPath = resolvePath(config, [
				`${config.dataDir}/${config.manifestFile}`,
				`data/${config.manifestFile}`,
			]);
			if (!manifestPath) {
				contentEl.createDiv({ text: "Missing set-manifests.json" });
				return;
			}
			const manifests = JSON.parse(await app.vault.adapter.read(manifestPath));
			const tokenCardNames = new Set(config.tokenCards || []);
			const otherCardNames = new Set(config.otherCards || []);
			const cards = (manifests[setName] ?? []).filter((c) => !tokenCardNames.has(c.cardName) || otherCardNames.has(c.cardName));

			const allVariants = (await loadVariantRows(config, dv)).filter(
				(p) => p.setName === setName,
			);
			const variantsByCard = new Map();
			for (const v of allVariants) {
				if (!variantsByCard.has(v.cardName)) variantsByCard.set(v.cardName, []);
				variantsByCard.get(v.cardName).push(v);
			}
			const variantsForCard = (card) => {
				const all = variantsByCard.get(card.cardName) ?? [];
				return card.product ? all.filter((v) => v.product === card.product) : all;
			};
			const isAvatarCard = (cardName) =>
				(variantsByCard.get(cardName) ?? []).some((v) => v.type === "Avatar");
			const targetForSet = (rarity) => isPlaySet ? (config.rarityTargets[rarity] ?? 1) : 1;
			const targetForCard = (card) =>
				isAvatarCard(card.cardName) || otherCardNames.has(card.cardName)
					? 1
					: targetForSet(card.rarity);

			const binderCountForCard = (card) => {
				if (!binders.length) return null;
				let total = 0;
				for (const v of variantsForCard(card)) {
					for (const bp of Array.isArray(v.binderPlacements) ? v.binderPlacements : []) {
						if (binders.includes(String(bp.binder || "").trim()))
							total += Number(bp.count || 0);
					}
				}
				return total;
			};

			const isPlaced = (card) => variantsForCard(card).some((v) =>
				(Array.isArray(v.binderPlacements) ? v.binderPlacements : []).some(
					(bp) => (Number(bp?.count) || 0) > 0,
				)
			);

			const weightedTarget = cards.reduce((sum, c) => sum + targetForCard(c), 0);
			const weightedOwned = cards.reduce(
				(sum, c) => sum + Math.min(ownedFromVariants(variantsForCard(c)), targetForCard(c)),
				0,
			);

			const statsEl = contentEl.createDiv({ cls: "sorcery-stats" });
			const makeCompletionStar = () => {
				const star = document.createElement("span");
				star.className = "sorcery-completion-star";
				star.textContent = "★";
				return star;
			};
			const statsLabel = statsEl.createDiv({ cls: "sorcery-set-stats" });
			statsLabel.textContent = `Cards (${weightedOwned}/${weightedTarget || 1})`;
			if (weightedTarget > 0 && weightedOwned >= weightedTarget)
				statsLabel.appendChild(makeCompletionStar());
			const prog = statsEl.createEl("progress", {
				cls: "sorcery-set-progress",
				attr: { value: String(weightedOwned), max: String(weightedTarget || 1) },
			});
			prog.value = weightedOwned;
			prog.max = weightedTarget || 1;

			const outputEl = contentEl.createDiv({ cls: "sorcery-output" });
			const rarityGrid = outputEl.createDiv({ cls: "sorcery-rarity-grid" });
			const grouped = new Map();
			for (const card of cards) {
				const key = isAvatarCard(card.cardName)
					? "Avatar"
					: otherCardNames.has(card.cardName)
						? "Other"
						: card.rarity || "Unknown";
				if (!grouped.has(key)) grouped.set(key, []);
				grouped.get(key).push(card);
			}
			const visibleRarities = ["Avatar", "Other", ...sortListsFor(config).rarityOrder].filter(
				(r) => (grouped.get(r) ?? []).length,
			);
			const typeOrder = sortListsFor(config).typeOrder;
			const typeRank = (name) => { const i = typeOrder.indexOf(name); return i === -1 ? 999 : i; };

			const renderChecklistItem = (list, card) => {
				const row = list.createDiv({ cls: "sorcery-checklist-item" });
				const ownedCount = ownedFromVariants(variantsForCard(card));
				const target = targetForCard(card);
				const binderCount = binderCountForCard(card);
				const displayName = card.productLabel
					? `${card.cardName} (${card.productLabel})`
					: card.cardName;
				// Link to the card note.
				const linkPath =
					cardSummaryPathForName(config, card.cardName) ||
					cardNotePath(config, card.cardName);
				const label = row.createDiv({ cls: "sorcery-checklist-label" });
				label.appendChild(cardLink(dv, linkPath || "", displayName, card.slug));
				if (isPlaySet) {
					let cls = "sorcery-play-count-bubble";
					if (ownedCount >= target) {
						if (!isPlaced(card)) cls += " is-unbindered";
						else if (ownedCount > target) cls += " is-overcomplete";
						else cls += " is-complete";
					}
					row.createDiv({ cls }).textContent = `${ownedCount} / ${target}`;
				} else if (ownedCount >= target) {
					let cls = "sorcery-base-owned-bubble";
					if (!isPlaced(card)) cls += " is-unbindered";
					const bubble = row.createDiv({ cls });
					bubble.textContent = "✓";
				}
			};

			const buildSection = (parent, rarity) => {
				const items = grouped.get(rarity) ?? [];
				if (!items.length) return;
				let ownedSum = 0, targetSum = 0;
				for (const card of items) {
					targetSum += targetForCard(card);
					ownedSum += Math.min(ownedFromVariants(variantsForCard(card)), targetForCard(card));
				}
				const section = parent.createDiv({ cls: "sorcery-checklist-group" });
				const heading = section.createDiv({ cls: "sorcery-checklist-heading" });
				heading.textContent = `${rarity} (${ownedSum}/${targetSum})`;
				if (ownedSum >= targetSum) heading.appendChild(makeCompletionStar());
				const p = section.createEl("progress", {
					cls: "sorcery-rarity-progress",
					attr: { value: String(ownedSum), max: String(targetSum) },
				});
				p.value = ownedSum;
				p.max = targetSum;
				if (rarity === "Avatar" || rarity === "Other") {
					const list = section.createDiv({ cls: "sorcery-checklist" });
					for (const card of items) renderChecklistItem(list, card);
					return;
				}
				const typeGroups = new Map();
				for (const card of items) {
					const typeName =
						card.type ||
						(variantsByCard.get(card.cardName) ?? []).find((v) => v.type)?.type ||
						"Unknown";
					if (!typeGroups.has(typeName)) typeGroups.set(typeName, []);
					typeGroups.get(typeName).push(card);
				}
				const orderedTypes = [...typeGroups.entries()].sort(
					([a], [b]) => typeRank(a) - typeRank(b) || a.localeCompare(b),
				);
				for (const [typeName, typeItems] of orderedTypes) {
					const typeWrap = section.createDiv({ cls: "sorcery-checklist-type" });
					if (typeName !== "Avatar")
						typeWrap.createDiv({ cls: "sorcery-checklist-type-heading", text: typeName });
					const list = typeWrap.createDiv({ cls: "sorcery-checklist" });
					for (const card of typeItems) renderChecklistItem(list, card);
				}
			};

			if (visibleRarities.length === 1) {
				rarityGrid.classList.add("sorcery-rarity-grid--single");
				buildSection(rarityGrid, visibleRarities[0]);
			} else {
				const PINNED_LEFT = ["Avatar", "Other"];
				const pinnedLeft = visibleRarities.filter((r) => PINNED_LEFT.includes(r));
				const distributed = visibleRarities.filter((r) => !PINNED_LEFT.includes(r));
				const rrow = rarityGrid.createDiv({ cls: "sorcery-rarity-row" });
				const left = rrow.createDiv({ cls: "sorcery-rarity-side sorcery-rarity-side--left" });
				const center = rrow.createDiv({ cls: "sorcery-rarity-center" });
				const right = rrow.createDiv({ cls: "sorcery-rarity-side sorcery-rarity-side--right" });
				if (pinnedLeft.length > 0) {
					const stack = left.createDiv();
					stack.style.cssText = "display:flex;flex-direction:column;gap:0.45rem;width:max-content;";
					for (const r of pinnedLeft) buildSection(stack, r);
					for (const g of stack.querySelectorAll(":scope > .sorcery-checklist-group")) {
						g.style.width = "100%";
						g.style.alignSelf = "auto";
						g.style.boxSizing = "border-box";
					}
					const total = pinnedLeft.length + distributed.length;
					const centerIdx = Math.max(
						0,
						Math.min(Math.floor(total / 2) - pinnedLeft.length, distributed.length - 1),
					);
					for (const r of distributed.slice(0, centerIdx)) buildSection(left, r);
					if (distributed.length > 0) buildSection(center, distributed[centerIdx]);
					for (const r of distributed.slice(centerIdx + 1)) buildSection(right, r);
				} else {
					const mid = Math.floor(distributed.length / 2);
					for (const r of distributed.slice(0, mid)) buildSection(left, r);
					for (const r of distributed.slice(mid, mid + 1)) buildSection(center, r);
					for (const r of distributed.slice(mid + 1)) buildSection(right, r);
				}
			}
		}

		async function renderSetRows(mode) {
			const rowMode = mode === "base-rows" ? "base" : "play";
			const isPlay = rowMode === "play";

			const settingsEl = contentEl.createDiv({ cls: "sorcery-rows-settings" });
			const addNumInput = (label, val, min, onSave) => {
				const wrap = settingsEl.createDiv({ cls: "sorcery-rows-setting" });
				wrap.createEl("label", { text: label });
				const input = wrap.createEl("input", {
					attr: { type: "number", value: String(val), min: String(min) },
				});
				input.addEventListener("change", async () => {
					const v = Math.max(min, parseInt(input.value) || min);
					input.value = String(v);
					await onSave(v);
					await rebuildTable();
				});
			};
			let slotsPerRow = isPlay ? playSlotsPerRow : baseSlotsPerRow;
			let specialSlots = isPlay ? playSpecialSlots : baseSpecialSlots;
			let rowsPerPage = isPlay ? playRowsPerPage : baseRowsPerPage;
			const slotsKey = isPlay ? "playSlotsPerRow" : "baseSlotsPerRow";
			const specialKey = isPlay ? "playSpecialSlots" : "baseSpecialSlots";
			const rowsPerPageKey = isPlay ? "playRowsPerPage" : "baseRowsPerPage";

			addNumInput("Special slots:", specialSlots, 0, async (v) => {
				specialSlots = v;
				if (isPlay) playSpecialSlots = v; else baseSpecialSlots = v;
				await saveFm({ [specialKey]: v });
			});
			addNumInput("Slots per row:", slotsPerRow, 1, async (v) => {
				slotsPerRow = v;
				if (isPlay) playSlotsPerRow = v; else baseSlotsPerRow = v;
				await saveFm({ [slotsKey]: v });
			});
			addNumInput("Rows per page:", rowsPerPage, 1, async (v) => {
				rowsPerPage = v;
				if (isPlay) playRowsPerPage = v; else baseRowsPerPage = v;
				await saveFm({ [rowsPerPageKey]: v });
			});
			if (isPlay) {
				const wrap = settingsEl.createDiv({ cls: "sorcery-rows-setting" });
				wrap.createEl("label", { text: "Padding:" });
				const select = wrap.createEl("select", { cls: "sorcery-rows-align-select" });
				for (const mode of ALIGN_MODES) {
					const opt = select.createEl("option", {
						text: ALIGN_LABELS[mode],
						attr: { value: mode },
					});
					if (mode === playRowsAlign) opt.selected = true;
				}
				select.addEventListener("change", async () => {
					playRowsAlign = select.value;
					await saveFm({ playRowsAlign: playRowsAlign });
					await rebuildTable();
				});
			}

			const rowBinders = isPlay ? playSetBinders : baseSetBinders;
			const rowBinderField = isPlay ? "playSetBinders" : "baseSetBinders";
			const chipsEl = contentEl.createDiv({ cls: "sorcery-binder-chips" });
			renderBinderChipList(chipsEl, config, rowBinders, async (updated) => {
				if (isPlay) playSetBinders = updated;
				else baseSetBinders = updated;
				await saveFm({ [rowBinderField]: updated });
				await renderModeContent(mode);
			}, dv);

			const tableWrap = contentEl.createDiv({
				cls: "sorcery-rows-table-wrap sorcery-binder-order",
			});
			const rebuildTable = async () => {
				tableWrap.replaceChildren();
				await renderRowsTable(tableWrap, config, setName, rowMode, {
					slotsPerRow,
					specialSlots,
					align: playRowsAlign,
					rowBinders,
					rowsPerPage,
				}, dv);
			};
			await rebuildTable();
		}

		for (const { id, label } of [
			{ id: "base", label: "Base" },
			{ id: "play", label: "Play" },
			{ id: "base-rows", label: "Base Rows" },
			{ id: "play-rows", label: "Play Rows" },
		]) {
			const btn = tabBar.createEl("button", {
				cls: `sorcery-tab-btn${setMode === id ? " is-active" : ""}`,
				text: label,
			});
			tabBtns[id] = btn;
			btn.addEventListener("click", async () => {
				if (!isActive()) return;
				setMode = id;
				for (const [k, b] of Object.entries(tabBtns))
					b.classList.toggle("is-active", k === id);
				await saveFm({ setMode: id });
				await renderModeContent(id);
			});
		}

		await renderModeContent(setMode);
	}

	function renderBinderChipList(container, config, binders, onChange, dv) {
		container.replaceChildren();
		for (const name of binders) {
			const chip = container.createDiv({ cls: "sorcery-binder-chip" });
			chip.createSpan({ text: name });
			const removeBtn = chip.createEl("button", {
				cls: "sorcery-binder-chip-remove",
				text: "×",
				attr: { "aria-label": `Remove ${name}` },
			});
			removeBtn.addEventListener("click", () => onChange(binders.filter((b) => b !== name)));
		}
		const qa = () => app.plugins.plugins["quickadd"]?.api;
		const addBtn = container.createEl("button", {
			cls: "sorcery-binder-add-btn",
			text: "+ Storage",
		});
		addBtn.addEventListener("click", async () => {
			const bindersDir = vaultPath(config, config.bindersDir || "storage");
			const available = dv
				.pages(`"${bindersDir}"`)
				.where((p) => p.kind === "sorcery-storage")
				.array()
				.map((p) => String(p.binderName || p.file?.name || ""))
				.filter((n) => n && !binders.includes(n))
				.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
			if (!available.length) { new Notice("No storage available to add", 3000); return; }
			const api = qa();
			if (!api) { new Notice("QuickAdd not available", 3000); return; }
			const chosen = await api.suggester(available, available, "Add storage");
			if (!chosen) return;
			onChange([...binders, chosen]);
		});
	}

	async function renderRowsTable(container, config, setName, mode, opts, dv) {
		const { slotsPerRow, specialSlots, rowBinders, rowsPerPage } = opts;
		// "none" | "normal" | "perfect"
		const align = opts.align || "none";
		const registeredBinders = new Set(Array.isArray(rowBinders) ? rowBinders.map(String) : []);
		const isPlay = mode === "play";
		const rarityTargets = config.rarityTargets || {
			Unique: 1, Elite: 2, Exceptional: 3, Ordinary: 4,
		};
		const tokenNames = new Set(config.tokenCards || []);
		const otherNames = new Set(config.otherCards || []);
		const groupAnchorToMembers = new Map();
		const groupMemberSet = new Set();
		for (const group of config.cardGroups || []) {
			groupAnchorToMembers.set(group.anchor, group.members || []);
			for (const m of group.members || []) groupMemberSet.add(m);
		}

		const apiSource = await loadApiData(config);
		if (!apiSource) {
			container.createDiv({ text: "Could not load API data." });
			return;
		}

		const allCards = [];
		for (const card of apiSource.data) {
			const setEntry = (card.sets || []).find((s) => s.name === setName);
			if (!setEntry) continue;
			const meta = setEntry.metadata || card.guardian || {};
			const type = String(meta.type || "").trim();
			const rarity = String(meta.rarity || "").trim();
			if (type === "Token" || tokenNames.has(card.name)) continue;
			const stdVariants = (setEntry.variants || []).filter((v) => v.finish === "Standard");
			if (stdVariants.length > 1) {
				for (const v of stdVariants)
					allCards.push({
						cardName: card.name, type, rarity,
						productLabel: PRODUCT_LABELS[v.product] || v.product,
						product: v.product,
					});
			} else {
				allCards.push({ cardName: card.name, type, rarity });
			}
		}

		if (!allCards.length) {
			container.createDiv({ text: `No cards found for: ${setName}` });
			return;
		}

		const multiProductCardNames = new Set(
			allCards.filter((c) => c.product).map((c) => c.cardName),
		);
		const ownedMap = new Map();
		const placedMap = new Map();
		if (dv) {
			const variants = (await loadVariantRows(config, dv)).filter(
				(p) => p.setName === setName,
			);
			for (const v of variants) {
				const key = multiProductCardNames.has(String(v.cardName))
					? `${v.cardName}::${v.product}`
					: String(v.cardName);
				const n = (Number(v.normalCount) || 0) + (Number(v.foilCount) || 0);
				ownedMap.set(key, (ownedMap.get(key) ?? 0) + n);
				const bps = v.binderPlacements;
				const placed = (registeredBinders.size > 0 && bps)
					? (Array.isArray(bps) ? bps : Array.from(bps))
						.reduce((sum, bp) => {
							if (!registeredBinders.has(String(bp?.binder || ""))) return sum;
							return sum + (Number(bp?.count) || 0);
						}, 0)
					: 0;
				placedMap.set(key, (placedMap.get(key) ?? 0) + placed);
			}
		}

		// Configurable order (no set/finish dimension in a single-set row layout).
		// Members are filtered out then re-inserted after their anchor below, so the
		// comparator only orders the standalone/anchor cards.
		const rowsCmp = makeCardComparator(config, {
			dims: ["avatar", "other", "type", "rarity", "name"],
			get: (c) => ({ name: c.cardName, type: c.type, rarity: c.rarity }),
		});
		const mainCards = allCards.filter((c) => !groupMemberSet.has(c.cardName));
		mainCards.sort(rowsCmp);

		const orderedCards = [];
		for (const card of mainCards) {
			orderedCards.push(card);
			const members = groupAnchorToMembers.get(card.cardName);
			if (members)
				for (const m of members) {
					const mc = allCards.find((c) => c.cardName === m);
					if (mc) orderedCards.push(mc);
				}
		}

		const slots = [];
		for (let i = 0; i < specialSlots; i++)
			slots.push({ label: "Special card", rarity: null, alwaysOwned: true });

		for (const card of orderedCards) {
			// Avatar and Other cards (config.otherCards, e.g. Rubble) are 1-of in a
			// Play Set, so they get a single copy in Play Rows regardless of rarity.
			const copies = isPlay
				? card.type === "Avatar" || otherNames.has(card.cardName)
					? 1
					: (rarityTargets[card.rarity] ?? 1)
				: 1;
			const baseName = card.productLabel
				? `${card.cardName} (${card.productLabel})`
				: card.cardName;
			const rarity = card.type === "Avatar" || !card.rarity ? null : card.rarity;
			if (isPlay && rarity && align !== "none") {
				const padBlank = () => slots.push({ label: "", rarity: null });
				const pos = slots.length % slotsPerRow;
				if (align === "perfect") {
					// Pack as many cards per row as fit, but never split a card's set
					// across rows: if the block won't fit in the slots left on this row,
					// pad to the next row boundary. (In a 4-wide row this differs from
					// "normal" only for the 3-copy Exceptional, which gets [E E E _].)
					if (pos !== 0 && pos + copies > slotsPerRow)
						while (slots.length % slotsPerRow !== 0) padBlank();
				} else if (align === "normal") {
					// Only align counts that tile the row evenly (Unique 1, Elite 2,
					// Ordinary 4 in a 4-wide row): pad to the next multiple of `copies`
					// so they sit on clean sub-row boundaries. Counts that can't tile
					// (Exceptional 3) get no padding and just flow.
					if (slotsPerRow % copies === 0)
						while (slots.length % copies !== 0) padBlank();
				}
			}
			const ownedKey = card.product ? `${card.cardName}::${card.product}` : card.cardName;
			for (let c = 0; c < copies; c++)
				slots.push({ label: baseName, rarity, ownedKey, copyIndex: c });
		}

		const totalSlots = slots.length;
		const totalRows = Math.ceil(totalSlots / slotsPerRow) || 1;
		const filledSlots = slots.filter((s) => s.label).length;
		const blankSlots = totalSlots - filledSlots;
		const statsLine = blankSlots > 0
			? `${filledSlots} cards · ${blankSlots} blank · ${totalSlots} total slots · ${totalRows} rows`
			: `${totalSlots} slots · ${totalRows} rows`;
		container.createDiv({ cls: "sorcery-rows-stats", text: statsLine });
		const table = container.createEl("table", { cls: "sorcery-binder-table" });
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		headerRow.createEl("th", { text: "Row" });
		for (let i = 1; i <= slotsPerRow; i++) headerRow.createEl("th", { text: String(i) });
		const tbody = table.createEl("tbody");
		for (let row = 0; row < totalRows; row++) {
			if (rowsPerPage && row > 0 && row % rowsPerPage === 0) {
				const sep = tbody.createEl("tr", { cls: "sorcery-rows-page-sep" });
				for (let i = 0; i <= slotsPerRow; i++) sep.createEl("td");
			}
			const tr = tbody.createEl("tr");
			tr.createEl("td", { text: String(row + 1) });
			for (let slot = 0; slot < slotsPerRow; slot++) {
				const idx = row * slotsPerRow + slot;
				const td = tr.createEl("td");
				if (idx < slots.length) {
					const { label, rarity, alwaysOwned, ownedKey, copyIndex } = slots[idx];
					if (!label) continue;
					const owned = alwaysOwned || (ownedKey && (ownedMap.get(ownedKey) ?? 0) > copyIndex);
					if (owned) {
						const placed = alwaysOwned || (ownedKey && (placedMap.get(ownedKey) ?? 0) > copyIndex);
						td.addClass(placed ? "is-owned" : "is-unbindered");
					}
					const cell = td.createDiv({ cls: "sorcery-binder-cell" });
					cell.createEl("span", {
						cls: rarity
							? `sorcery-rarity-prefix sorcery-rarity-prefix--${rarity.toLowerCase()}`
							: "sorcery-rarity-prefix sorcery-rarity-prefix--empty",
						text: rarity ? `[${rarity}]` : "",
					});
					cell.createEl("span", { cls: "sorcery-binder-card-name", text: label });
				}
			}
		}
	}

	async function renderArtists(dv) {
		const isActive = beginTrackedRender(dv.container);
		const config = await loadConfig();
		if (!isActive()) return;

		const artistsDir = vaultPath(config, "artists");
		const cardsDir = vaultPath(config, config.cardsDir);

		const artists = dv
			.pages(`"${artistsDir}"`)
			.where((p) => p.kind === "sorcery-artist")
			.array()
			.sort((a, b) =>
				String(a.artistName || a.file?.name || "").localeCompare(
					String(b.artistName || b.file?.name || ""),
					undefined,
					{ sensitivity: "base" },
				),
			);

		const allVariants = await loadVariantRows(config, dv);

		// Deduplicate: one variant per (artist, cardName), preferring Standard over Foil.
		// This prevents 2× entries and avoids expensive standardArtSlug calls on foil variants.
		const variantsByArtist = new Map();
		const artistCardBest = new Map();
		for (const v of allVariants) {
			const artist = String(v.artist || "");
			if (!artist) continue;
			const cardName = String(v.cardName || v.slug || "");
			const key = `${artist}\x00${cardName}`;
			const isStandard = String(v.finish || "").toLowerCase() !== "foil";
			const existing = artistCardBest.get(key);
			if (!existing || (isStandard && String(existing.finish || "").toLowerCase() === "foil")) {
				artistCardBest.set(key, v);
			}
		}
		for (const [key, v] of artistCardBest) {
			const artist = key.split("\x00")[0];
			if (!variantsByArtist.has(artist)) variantsByArtist.set(artist, []);
			variantsByArtist.get(artist).push(v);
		}

		// Build art slug lookup from vault files — O(1) checks, no per-variant file scanning.
		const artSlugs = new Set();
		for (const f of app.vault.getFiles()) {
			if (/\.(jpg|png)$/i.test(f.name) && f.path.includes("/art/")) {
				artSlugs.add(f.name.replace(/\.(jpg|png)$/i, ""));
			}
		}
		const hasArtFast = (v) => {
			const slug = String(v.slug || "");
			if (!slug) return false;
			if (artSlugs.has(slug)) return true;
			// Foil slugs end in -f; check corresponding standard slug (-s)
			const stdSlug = slug.replace(/-f$/, "-s");
			return stdSlug !== slug && artSlugs.has(stdSlug);
		};

		const chosenByArtist = new Map();
		for (const p of artists) {
			const artistName = String(p.artistName || p.file?.name || "");
			const variants = variantsByArtist.get(artistName) || [];
			const withArt = variants.filter(hasArtFast);
			let chosen = withArt.length ? withArt[Math.floor(Math.random() * withArt.length)] : null;
			if (chosen && String(chosen.finish || "").toLowerCase() === "foil") {
				const stdSlug = String(chosen.slug || "").replace(/-f$/, "-s");
				if (artSlugs.has(stdSlug)) {
					chosen = { slug: stdSlug, finish: "Standard", cardName: chosen.cardName, file: chosen.file };
				}
			}
			chosenByArtist.set(artistName, chosen);
		}

		const controls = dv.container.createDiv({ cls: "sorcery-controls" });
		const { widget: searchWidget, input: search } = createSearchWidget(
			controls,
			"Search artists...",
		);
		const stats = dv.container.createDiv({ cls: "sorcery-stats" });
		const grid = dv.container.createDiv({ cls: "sorcery-card-grid" });

		const renderGrid = () => {
			const q = search.value.trim().toLowerCase();
			const filtered = q
				? artists.filter((p) =>
					String(p.artistName || p.file?.name || "").toLowerCase().includes(q),
				)
				: artists;
			stats.textContent = `Artists: ${filtered.length}`;
			grid.replaceChildren();
			for (const p of filtered) {
				const artistName = String(p.artistName || p.file?.name || "");
				const card = grid.createDiv({ cls: "sorcery-card" });

				const chosen = chosenByArtist.get(artistName);
				if (chosen) {
					renderArtFrame(card, config, chosen, { alt: artistName });
				} else {
					card.createDiv({
						cls: "sorcery-card-image sorcery-card-image--placeholder",
						text: "No art",
					});
				}

				const meta = card.createDiv({ cls: "sorcery-card-meta-row" });
				const body = meta.createDiv({ cls: "sorcery-card-body" });
				const title = body.createDiv({ cls: "sorcery-card-title" });
				title.appendChild(cardLink(dv, p.file.path, artistName));
			}
		};

		search.addEventListener("input", renderGrid);
		renderGrid();
	}

	async function renderArtist(dv) {
		const isActive = beginTrackedRender(dv.container);
		const current = await awaitCurrentFm(dv);
		if (!current || !isActive()) return;
		const artistName = current.artistName || current.file?.name;
		const config = await loadConfig();
		if (!isActive()) return;
		const apiSource = await loadApiData(config);
		if (!isActive()) return;
		const apiCards = apiSource?.data || [];
		const rows = [];
		for (const card of apiCards) {
			const guardian = card.guardian || {};
			// Ownership lives on the summary note (fm.ownership[slug]); link there too.
			const summaryPath =
				cardSummaryPathForName(config, card.name) ||
				cardNotePath(config, card.name);
			const summaryFile = app.vault.getAbstractFileByPath(summaryPath);
			const ownership = summaryFile
				? app.metadataCache.getFileCache(summaryFile)?.frontmatter?.ownership || {}
				: {};
			for (const set of card.sets || []) {
				for (const variant of set.variants || []) {
					if (variant.artist !== artistName) continue;
					const own = ownership[variant.slug] || {};
					rows.push({
						cardName: card.name,
						setName: set.name,
						finish: variant.finish,
						product: variant.product,
						slug: variant.slug,
						path: summaryPath,
						count: (Number(own.normalCount) || 0) + (Number(own.foilCount) || 0),
						type: guardian.type || "",
						rarity: set?.metadata?.rarity || card?.guardian?.rarity || "",
						cost: guardian.cost,
						costIsX: guardian.cost === null && !["Site", "Avatar"].includes(guardian.type || "") && (card.sets || []).some((s) => (s.variants || []).some((v) => v.product === "Booster")),
						elements: splitElements(card.elements),
						subTypes: splitElements(card.subTypes || ""),
						keywords: extractKeywordsFromRules(
							[guardian.rulesText || "", (set.metadata || {}).rulesText || ""]
								.filter(Boolean).join("\n")
						),
					});
				}
			}
		}
		const _initSetOrder = setOrderFor(config);
		rows.sort(
			(a, b) =>
				String(a.cardName || "").localeCompare(
					String(b.cardName || ""),
					undefined,
					{ sensitivity: "base" },
				) ||
				((_initSetOrder.indexOf(a.setName ?? "") === -1 ? 999 : _initSetOrder.indexOf(a.setName ?? "")) -
				 (_initSetOrder.indexOf(b.setName ?? "") === -1 ? 999 : _initSetOrder.indexOf(b.setName ?? ""))) ||
				finishRankFor(a.finish) - finishRankFor(b.finish) ||
				String(a.product || "").localeCompare(
					String(b.product || ""),
					undefined,
					{ sensitivity: "base" },
				) ||
				String(a.slug || "").localeCompare(String(b.slug || ""), undefined, {
					sensitivity: "base",
				}),
		);
		const controls = dv.container.createDiv({
			cls: "sorcery-controls sorcery-artist-controls",
		});
		const { widget: searchWidget, input: search } = createSearchWidget(
			controls,
			"Search cards, sets, finishes...",
		);
		let renderRows = () => {};
		const onChange = () => renderRows();
		const setFilter = createDropdownWidget(
			controls,
			"All sets",
			config,
			onChange,
		);
		const typeFilter = createDropdownWidget(
			controls,
			"All types",
			config,
			onChange,
		);
		const rarityFilter = createDropdownWidget(
			controls,
			"All rarities",
			config,
			onChange,
		);
		const costFilter = createDropdownWidget(
			controls,
			"All costs",
			config,
			onChange,
		);
		const elementFilter = createCheckboxDropdown(controls, "Elements", onChange, { modeToggle: true });
		const finishFilter = createDropdownWidget(
			controls,
			"All finishes",
			config,
			onChange,
		);
		const setOrder = setOrderFor(config);
		const sets = [...new Set(rows.map((p) => p.setName).filter(Boolean))].sort(
			(a, b) =>
				(setOrder.indexOf(a) === -1 ? 999 : setOrder.indexOf(a)) -
					(setOrder.indexOf(b) === -1 ? 999 : setOrder.indexOf(b)) ||
				a.localeCompare(b, undefined, { sensitivity: "base" }),
		);
		const TYPE_DISPLAY_ORDER = ["Avatar", "Artifact", "Aura", "Minion", "Magic", "Site"];
		const typeDisplayRank = (t) => { const i = TYPE_DISPLAY_ORDER.indexOf(String(t ?? "").trim()); return i === -1 ? 999 : i; };
		const types = [...new Set(rows.map((p) => p.type).filter(Boolean))].sort(
			(a, b) => typeDisplayRank(a) - typeDisplayRank(b),
		);
		const rarities = [
			...new Set(rows.map((p) => p.rarity).filter(Boolean)),
		].sort(
			(a, b) =>
				(config.rarityTargets[a] ?? 99) - (config.rarityTargets[b] ?? 99),
		);
		const costFor = (p) => {
			if (p.cost == null) return p.costIsX ? "X" : null;
			const num = Number(p.cost);
			return Number.isFinite(num) ? num : null;
		};
		const costValues = [...new Set(rows.map((p) => costFor(p)).filter((v) => typeof v === "number"))].sort(
			(a, b) => a - b,
		);
		const elementsFor = (p) => (Array.isArray(p.elements) ? p.elements : []);
		setFilter.addOption("All sets", "");
		typeFilter.addOption("All types", "");
		rarityFilter.addOption("All rarities", "");
		costFilter.addOption("All costs", "");
		finishFilter.addOption("All finishes", "");
		const elementValues = [
			...new Set(rows.flatMap((p) => elementsFor(p)).filter((v) => v && v !== "None")),
		].sort((a, b) => a.localeCompare(b));
		const finishOrder = { Standard: 0, Foil: 1, Rainbow: 2 };
		const finishValues = [
			...new Set([
				"Standard",
				"Foil",
				"Rainbow",
				...rows.map((p) => p.finish).filter(Boolean),
			]),
		].sort(
			(a, b) =>
				(finishOrder[a] ?? 99) - (finishOrder[b] ?? 99) || a.localeCompare(b),
		);
		for (const s of sets) setFilter.addOption(s, s);
		for (const t of types) typeFilter.addOption(t, t);
		for (const r of rarities) rarityFilter.addOption(r, r);
		for (const c of costValues) costFilter.addOption(String(c), String(c));
		if (rows.some((p) => costFor(p) === "X")) costFilter.addOption("X", "X");
		for (const e of elementValues) elementFilter.addOption(e, e, true);
		elementFilter.addOption("Neutral", "__neutral__", true);
		for (const f of finishValues) finishFilter.addOption(f, f);
		[
			setFilter,
			typeFilter,
			rarityFilter,
			costFilter,
			elementFilter,
			finishFilter,
		].forEach((widget) => widget.fitWidth());
		const subtypeFilter = createCheckboxDropdown(controls, "Subtypes", onChange, { modeToggle: true, defaultMatch: "and" });
		const keywordFilter = createCheckboxDropdown(controls, "Keywords", onChange, { modeToggle: true, defaultMatch: "and" });
		const allSubtypes = [...new Set(rows.flatMap((p) => p.subTypes || []))].sort();
		const allKeywords = [...new Set(rows.flatMap((p) => p.keywords || []))].sort();
		for (const s of allSubtypes) subtypeFilter.addOption(s, s);
		for (const k of allKeywords) keywordFilter.addOption(k, k);
		subtypeFilter.fitWidth();
		keywordFilter.fitWidth();
		const toggle = controls.createEl("button", {
			cls: "sorcery-view-toggle",
			attr: { title: "Toggle list/card view" },
		});
		let view = current.viewMode ?? "cards";
		const updateToggle = () => {
			const isList = view === "list";
			toggle.textContent = isList ? "▦" : "☰";
			toggle.setAttribute(
				"title",
				isList ? "Switch to card view" : "Switch to list view",
			);
		};
		updateToggle();
		const stats = dv.container.createDiv({ cls: "sorcery-stats" });
		const output = dv.container.createDiv({ cls: "sorcery-output" });
		const filterRows = (items) => {
			const q = String(search.value || "")
				.trim()
				.toLowerCase();
			return items.filter((p) => {
				if (setFilter.value && p.setName !== setFilter.value) return false;
				if (typeFilter.value && p.type !== typeFilter.value) return false;
				if (rarityFilter.value && p.rarity !== rarityFilter.value) return false;
				if (costFilter.value) {
					const cv = costFor(p);
					if (costFilter.value === "X" ? cv !== "X" : cv !== Number(costFilter.value)) return false;
				}
				const elemSel = elementFilter.selectedValues;
				if (elemSel.size === 0) return false;
				{
					const cardElems = elementsFor(p).filter((e) => e !== "None");
					const cardTags = cardElems.length ? cardElems : ["__neutral__"];
					const elemMatch = elementFilter.matchMode === "and"
						? [...elemSel].every((e) => cardTags.includes(e))
						: cardTags.some((e) => elemSel.has(e));
					if (!elemMatch) return false;
				}
				if (finishFilter.value && p.finish !== finishFilter.value) return false;
				if (subtypeFilter.selectedValues.size > 0) {
					const cardSubtypes = p.subTypes || [];
					const subSel = subtypeFilter.selectedValues;
					const subOk = subtypeFilter.matchMode === "and"
						? [...subSel].every((s) => cardSubtypes.includes(s))
						: [...subSel].some((s) => cardSubtypes.includes(s));
					if (!subOk) return false;
				}
				if (keywordFilter.selectedValues.size > 0) {
					const cardKeywords = p.keywords || [];
					const kwSel = keywordFilter.selectedValues;
					const kwOk = keywordFilter.matchMode === "and"
						? [...kwSel].every((k) => cardKeywords.includes(k))
						: [...kwSel].some((k) => cardKeywords.includes(k));
					if (!kwOk) return false;
				}
				if (q) {
					return (
						String(p.cardName ?? "").toLowerCase().includes(q) ||
						String(p.rules ?? "").toLowerCase().includes(q)
					);
				}
				return true;
			});
		};
		const ARTIST_TYPE_RANK = new Map([
			["Avatar", 0], ["Artifact", 1], ["Aura", 2], ["Minion", 3], ["Magic", 4], ["Site", 5],
		]);
		const artistTypeRank = (t) => ARTIST_TYPE_RANK.get(String(t ?? "").trim()) ?? 999;
		const sortRows = (items) =>
			[...items].sort((a, b) => {
				const typeDiff = artistTypeRank(a.type) - artistTypeRank(b.type);
				if (typeDiff) return typeDiff;
				const nameDiff = String(a.cardName || a.slug || "").localeCompare(
					String(b.cardName || b.slug || ""),
					undefined,
					{ sensitivity: "base" },
				);
				if (nameDiff) return nameDiff;
				const aSetRank = setOrder.indexOf(a.setName ?? "");
				const bSetRank = setOrder.indexOf(b.setName ?? "");
				const setDiff = (aSetRank === -1 ? 999 : aSetRank) - (bSetRank === -1 ? 999 : bSetRank);
				if (setDiff) return setDiff;
				return finishRankFor(a.finish) - finishRankFor(b.finish);
			});

		const artistCount = (p) => Number(p.count ?? 0);
		const subtitleFor = (p) => {
			const suffix =
				p.finish === "Foil"
					? " - Foil"
					: p.finish === "Rainbow"
						? " - Rainbow"
						: "";
			return `${p.setName ?? ""}${suffix}`.trim();
		};
		renderRows = () => {
			const sourceRows = rows;
			const filtered = sortRows(filterRows(sourceRows));
			const totalCards = filtered.reduce((sum, p) => sum + artistCount(p), 0);
			stats.textContent = `Cards: ${totalCards} / ${filtered.length}`;
			output.replaceChildren();
			if (view === "cards") {
				const data = output.createDiv({ cls: "sorcery-card-grid" });
				for (const p of filtered) {
					const card = data.createDiv({ cls: "sorcery-card" });
					renderArtFrame(card, config, p, { alt: p.cardName ?? p.slug });
					const meta = card.createDiv({ cls: "sorcery-card-meta-row" });
					const body = meta.createDiv({ cls: "sorcery-card-body" });
					const title = body.createDiv({ cls: "sorcery-card-title" });
					title.appendChild(cardLink(dv, p.path, p.cardName ?? p.slug, p.slug));
					body.createDiv({
						cls: "sorcery-card-subtitle",
						text: subtitleFor(p),
					});
					meta.createDiv({
						cls: "sorcery-collection-count",
						text: String(artistCount(p)),
					});
				}
			} else {
				const list = output.createDiv({ cls: "sorcery-collection-grid" });
				for (const p of filtered) {
					const item = list.createDiv({ cls: "sorcery-collection-item" });
					const body = item.createDiv({ cls: "sorcery-collection-item-body" });
					const title = body.createDiv({ cls: "sorcery-card-title" });
					title.appendChild(cardLink(dv, p.path, p.cardName ?? p.slug, p.slug));
					body.createDiv({
						cls: "sorcery-card-subtitle sorcery-collection-item-subtitle",
						text: subtitleFor(p),
					});
					item.createDiv({
						cls: "sorcery-collection-count",
						text: String(artistCount(p)),
					});
				}
			}
		};
		search.addEventListener("input", renderRows);
		toggle.onclick = () => {
			view = view === "list" ? "cards" : "list";
			updateToggle();
			renderRows();
		};
		renderRows();
	}

	async function renderBinder(dv) {
		const isActive = beginTrackedRender(dv.container);
		const current = await awaitCurrentFm(dv);
		if (!current || !isActive()) return;
		const config = await loadConfig();
		if (!isActive()) return;
		const binderName = current.binderName || current.file?.name;
		const apiSource = await loadApiData(config);
		if (!isActive()) return;
		const costByCard = new Map();
		const costIsXByCard = new Set();
		for (const card of apiSource?.data || []) {
			if (card.name && card.guardian?.cost !== undefined) {
				costByCard.set(card.name, card.guardian.cost);
				const hasBooster = (card.sets || []).some((s) => (s.variants || []).some((v) => v.product === "Booster"));
				if (card.guardian.cost === null && !["Site", "Avatar"].includes(card.guardian.type || "") && hasBooster)
					costIsXByCard.add(card.name);
			}
		}
		const costFor = (p) => {
			const raw = costByCard.has(p.cardName) ? costByCard.get(p.cardName) : p.cost;
			if (raw == null) return costIsXByCard.has(p.cardName) ? "X" : null;
			const num = Number(raw);
			return Number.isFinite(num) ? num : null;
		};
		const variants = (await loadVariantRows(config, dv)).filter((x) =>
			(Array.isArray(x.binderPlacements) ? x.binderPlacements : []).some(
				(bp) => bp.binder === binderName,
			),
		);
		const fireStorageMode = (mode) => {
			globalThis.__sorceryStoragePreselect = { name: binderName, mode };
			app.commands.executeCommandById("quickadd:choice:sorcery-edit-binder");
		};

		const cardActionsRow = dv.container.createDiv({ cls: "sorcery-deck-actions" });
		[
			{ label: "Add Cards",    mode: "add" },
			{ label: "Remove Cards", mode: "remove" },
			{ label: "Move Card",    mode: "move" },
		].forEach(({ label, mode }) => {
			const btn = cardActionsRow.createEl("button", {
				cls: "sorcery-action-btn",
				text: label,
				attr: { type: "button" },
			});
			btn.addEventListener("click", () => fireStorageMode(mode));
		});

		const storageActionsRow = dv.container.createDiv({ cls: "sorcery-deck-actions" });
		[
			{ label: "Edit Storage" , mode: "edit" },
		].forEach(({ label, mode }) => {
			const btn = storageActionsRow.createEl("button", {
				cls: "sorcery-action-btn",
				text: label,
				attr: { type: "button" },
			});
			btn.addEventListener("click", () => fireStorageMode(mode));
		});

		const exportStorageBtn = storageActionsRow.createEl("button", {
			cls: "sorcery-action-btn",
			text: "Export Storage",
			attr: { type: "button" },
		});
		exportStorageBtn.addEventListener("click", () => {
			globalThis.__sorceryExportPreselect = { name: binderName, type: "storage" };
			app.commands.executeCommandById("quickadd:choice:sorcery-export-collection");
		});

		[
			{ label: "Move All",       mode: "moveall" },
			{ label: "Clear Storage",  mode: "clear" },
			{ label: "Delete Storage", mode: "delete" },
		].forEach(({ label, mode }) => {
			const btn = storageActionsRow.createEl("button", {
				cls: "sorcery-action-btn is-danger",
				text: label,
				attr: { type: "button" },
			});
			btn.addEventListener("click", () => fireStorageMode(mode));
		});

		dv.container.createEl("hr", { cls: "sorcery-deck-divider" });

		const binderHeader = dv.container.createDiv({
			cls: "sorcery-binder-header",
		});
		binderHeader.createDiv({
			cls: "sorcery-title sorcery-binder-title",
			text: binderName,
		});
		const totalSlots = Number(
			current.totalSlots ??
				Number(current.slotsPerPage ?? 0) * Number(current.pages ?? 0),
		);
		if (binderName !== "Tokens" && totalSlots > 0) {
			binderHeader.createDiv({
				cls: "sorcery-binder-slots",
				text: `Slots: ${totalSlots}`,
			});
		}
		const controls = dv.container.createDiv({ cls: "sorcery-controls" });
		const { widget: searchWidget, input: search } = createSearchWidget(
			controls,
			"Search cards...",
		);
		let renderRows = () => {};
		const onChange = () => renderRows();
		const setFilter = createDropdownWidget(
			controls,
			"All sets",
			config,
			onChange,
		);
		const typeFilter = createDropdownWidget(
			controls,
			"All types",
			config,
			onChange,
		);
		const rarityFilter = createDropdownWidget(
			controls,
			"All rarities",
			config,
			onChange,
		);
		const costFilter = createDropdownWidget(
			controls,
			"All costs",
			config,
			onChange,
		);
		const elementFilter = createCheckboxDropdown(controls, "Elements", onChange, { modeToggle: true });
		const finishFilter = createDropdownWidget(
			controls,
			"All finishes",
			config,
			onChange,
		);
		const setOrder = setOrderFor(config);
		const sets = [
			...new Set(variants.map((p) => p.setName).filter(Boolean)),
		].sort(
			(a, b) =>
				(setOrder.indexOf(a) === -1 ? 999 : setOrder.indexOf(a)) -
					(setOrder.indexOf(b) === -1 ? 999 : setOrder.indexOf(b)) ||
				a.localeCompare(b, undefined, { sensitivity: "base" }),
		);
		const TYPE_DISPLAY_ORDER = ["Avatar", "Artifact", "Aura", "Minion", "Magic", "Site"];
		const typeDisplayRank = (t) => { const i = TYPE_DISPLAY_ORDER.indexOf(String(t ?? "").trim()); return i === -1 ? 999 : i; };
		const types = [
			...new Set(variants.map((p) => p.type).filter(Boolean)),
		].sort((a, b) => typeDisplayRank(a) - typeDisplayRank(b));
		const rarities = [
			...new Set(variants.map((p) => p.rarity).filter(Boolean)),
		].sort(
			(a, b) =>
				(config.rarityTargets[a] ?? 99) - (config.rarityTargets[b] ?? 99),
		);
		const elementsFor = (p) => (Array.isArray(p.elements) ? p.elements : []);
		const finishOrder = { Standard: 0, Foil: 1, Rainbow: 2 };
		const finishValues = [
			...new Set([
				"Standard",
				"Foil",
				"Rainbow",
				...variants.map((p) => p.finish).filter(Boolean),
			]),
		].sort(
			(a, b) =>
				(finishOrder[a] ?? 99) - (finishOrder[b] ?? 99) || a.localeCompare(b),
		);
		setFilter.addOption("All sets", "");
		typeFilter.addOption("All types", "");
		rarityFilter.addOption("All rarities", "");
		costFilter.addOption("All costs", "");
		finishFilter.addOption("All finishes", "");
		for (const s of sets) setFilter.addOption(s, s);
		for (const t of types) typeFilter.addOption(t, t);
		for (const r of rarities) rarityFilter.addOption(r, r);
		for (const c of [...new Set(variants.map((p) => costFor(p)).filter((v) => v !== null))].sort((a, b) => a - b))
			costFilter.addOption(String(c), String(c));
		if (variants.some((p) => costFor(p) === "X")) costFilter.addOption("X", "X");
		const elementValues = [
			...new Set(variants.flatMap((p) => elementsFor(p)).filter((v) => v && v !== "None")),
		].sort((a, b) => a.localeCompare(b));
		for (const e of elementValues) elementFilter.addOption(e, e, true);
		elementFilter.addOption("Neutral", "__neutral__", true);
		for (const f of finishValues) finishFilter.addOption(f, f);
		[setFilter, typeFilter, rarityFilter, costFilter, elementFilter, finishFilter].forEach(
			(widget) => widget.fitWidth(),
		);
		const subtypeFilter = createCheckboxDropdown(controls, "Subtypes", onChange, { modeToggle: true, defaultMatch: "and" });
		const keywordFilter = createCheckboxDropdown(controls, "Keywords", onChange, { modeToggle: true, defaultMatch: "and" });
		const allSubtypes = [
			...new Set(variants.flatMap((p) => {
				const st = p.subTypes;
				return Array.isArray(st) ? st : splitElements(st || "");
			})),
		].sort();
		const allKeywords = [
			...new Set(variants.flatMap((p) => {
				const kw = p.keywords;
				return Array.isArray(kw) ? kw : [];
			})),
		].sort();
		for (const s of allSubtypes) subtypeFilter.addOption(s, s);
		for (const k of allKeywords) keywordFilter.addOption(k, k);
		subtypeFilter.fitWidth();
		keywordFilter.fitWidth();
		const toggle = controls.createEl("button", {
			cls: "sorcery-view-toggle",
			attr: { title: "Toggle list/card view" },
		});
		let view = current.viewMode ?? "cards";
		const updateToggle = () => {
			const isList = view === "list";
			toggle.textContent = isList ? "▦" : "☰";
			toggle.setAttribute(
				"title",
				isList ? "Switch to card view" : "Switch to list view",
			);
		};
		updateToggle();
		const stats = dv.container.createDiv({ cls: "sorcery-stats" });
		const output = dv.container.createDiv({ cls: "sorcery-output" });
		const binderCount = (p) => {
			const placements = Array.isArray(p.binderPlacements)
				? p.binderPlacements
				: [];
			return placements
				.filter((bp) => bp.binder === binderName)
				.reduce((sum, bp) => sum + Number(bp.count || 0), 0);
		};
		const isBox = lowerTrim(current.storageType) === "box";
		// Configurable order — Avatar and Other resolved inside the type dim.
		// Members trail their anchor (handled inside makeCardComparator);
		// `variants` is the unfiltered seed for that inheritance.
		const binderCmp = makeCardComparator(config, {
			dims: ["avatar", "other", "type", "rarity", "name", "set", "finish"],
			allItems: variants,
			identityPerPrinting: true,
			get: (p) => ({
				name: p.cardName,
				type: p.type,
				rarity: p.rarity,
				setName: p.setName,
				finish: p.finish,
			}),
		});
		const sortRows = (rows) => [...rows].sort(binderCmp);
		const filterRows = (rows) => {
			const q = String(search.value || "")
				.trim()
				.toLowerCase();
			return rows.filter((p) => {
				if (setFilter.value && p.setName !== setFilter.value) return false;
				if (typeFilter.value && p.type !== typeFilter.value) return false;
				if (rarityFilter.value && p.rarity !== rarityFilter.value) return false;
				if (costFilter.value) {
					const cv = costFor(p);
					if (costFilter.value === "X" ? cv !== "X" : cv !== Number(costFilter.value)) return false;
				}
				const elemSel = elementFilter.selectedValues;
				if (elemSel.size === 0) return false;
				{
					const cardElems = elementsFor(p).filter((e) => e !== "None");
					const cardTags = cardElems.length ? cardElems : ["__neutral__"];
					const elemMatch = elementFilter.matchMode === "and"
						? [...elemSel].every((e) => cardTags.includes(e))
						: cardTags.some((e) => elemSel.has(e));
					if (!elemMatch) return false;
				}
				if (finishFilter.value && p.finish !== finishFilter.value) return false;
				if (subtypeFilter.selectedValues.size > 0) {
					const cardSubtypes = Array.isArray(p.subTypes) ? p.subTypes : splitElements(p.subTypes || "");
					const subSel = subtypeFilter.selectedValues;
					const subOk = subtypeFilter.matchMode === "and"
						? [...subSel].every((s) => cardSubtypes.includes(s))
						: [...subSel].some((s) => cardSubtypes.includes(s));
					if (!subOk) return false;
				}
				if (keywordFilter.selectedValues.size > 0) {
					const cardKeywords = Array.isArray(p.keywords) ? p.keywords : [];
					const kwSel = keywordFilter.selectedValues;
					const kwOk = keywordFilter.matchMode === "and"
						? [...kwSel].every((k) => cardKeywords.includes(k))
						: [...kwSel].some((k) => cardKeywords.includes(k));
					if (!kwOk) return false;
				}
				if (!q) return true;
				return (
					String(p.cardName ?? "").toLowerCase().includes(q) ||
					String(p.rules ?? "").toLowerCase().includes(q)
				);
			});
		};
		const subtitleFor = (p) => {
			const suffix =
				p.finish === "Foil"
					? " - Foil"
					: p.finish === "Rainbow"
						? " - Rainbow"
						: "";
			return `${p.setName ?? ""}${suffix}`.trim();
		};
		renderRows = () => {
			const sourceRows = variants;
			const rows = sortRows(filterRows(sourceRows));
			const totalCards = rows.reduce((sum, p) => sum + binderCount(p), 0);
			stats.textContent = `Cards: ${totalCards} / ${rows.length}`;
			output.replaceChildren();
			if (view === "cards") {
				const data = output.createDiv({ cls: "sorcery-card-grid" });
				for (const p of rows) {
					const card = data.createDiv({ cls: "sorcery-card" });
					renderArtFrame(card, config, p, { alt: p.cardName ?? p.slug });
					const meta = card.createDiv({ cls: "sorcery-card-meta-row" });
					const body = meta.createDiv({ cls: "sorcery-card-body" });
					const title = body.createDiv({ cls: "sorcery-card-title" });
					title.appendChild(
						cardLink(dv, p.file.path, p.cardName ?? p.slug ?? p.file.name, p.slug),
					);
					body.createDiv({
						cls: "sorcery-card-subtitle",
						text: subtitleFor(p),
					});
					meta.createDiv({
						cls: "sorcery-collection-count",
						text: String(binderCount(p)),
					});
				}
			} else {
				const list = output.createDiv({ cls: "sorcery-collection-grid" });
				for (const p of rows) {
					const item = list.createDiv({ cls: "sorcery-collection-item" });
					const body = item.createDiv({ cls: "sorcery-collection-item-body" });
					const title = body.createDiv({ cls: "sorcery-card-title" });
					title.appendChild(
						cardLink(dv, p.file.path, p.cardName ?? p.slug ?? p.file.name, p.slug),
					);
					body.createDiv({
						cls: "sorcery-card-subtitle sorcery-collection-item-subtitle",
						text: subtitleFor(p),
					});
					item.createDiv({
						cls: "sorcery-collection-count",
						text: String(binderCount(p)),
					});
				}
			}
		};
		search.addEventListener("input", renderRows);
		toggle.onclick = () => {
			view = view === "list" ? "cards" : "list";
			updateToggle();
			renderRows();
		};
		renderRows();
	}

	async function renderDeck(dv) {
		const isActive = beginTrackedRender(dv.container);
		const current = await awaitCurrentFm(dv);
		if (!current || !isActive()) return;
		const config = await loadConfig();
		if (!isActive()) return;

		const apiSource = await loadApiData(config);
		if (!isActive()) return;

		const apiCards = apiSource?.data || [];
		const guardianByName = new Map();
		for (const card of apiCards) {
			if (card.name) guardianByName.set(card.name, card.guardian || {});
		}

		// Owned-per-card: sum every printing's counts from each summary note's
		// fm.ownership[slug]. Hero art: the first Standard printing's slug (from API).
		const ownedByName = new Map();
		const artFileByName = new Map();
		const cardsPrefix = vaultPath(config, config.cardsDir) + "/";
		for (const file of app.vault.getMarkdownFiles()) {
			if (!file.path.startsWith(cardsPrefix) && !file.path.startsWith(`${config.cardsDir}/`)) continue;
			const fm = app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm || fm.kind !== "sorcery-card-summary") continue;
			const name = String(fm.cardName || "");
			if (!name) continue;
			const ownership = fm.ownership && typeof fm.ownership === "object" ? fm.ownership : {};
			let total = 0;
			for (const e of Object.values(ownership))
				total += (Number(e?.normalCount) || 0) + (Number(e?.foilCount) || 0);
			ownedByName.set(name, total);
		}
		for (const card of apiCards) {
			if (artFileByName.has(card.name)) continue;
			let stdSlug = null;
			for (const set of card.sets || []) {
				for (const v of set.variants || []) {
					if (String(v.finish || "").toLowerCase() === "standard") { stdSlug = v.slug; break; }
				}
				if (stdSlug) break;
			}
			if (!stdSlug) continue;
			const artPath = artPathForVariant(config, { slug: stdSlug, finish: "Standard" });
			if (artPath) {
				const artFile = app.vault.getAbstractFileByPath(artPath);
				if (artFile) artFileByName.set(card.name, artFile);
			}
		}

		const deckName = String(current.deckName || current.file?.name || "");
		const avatar = String(current.avatar || "");

		const normalizeEntries = (arr) => {
			if (!Array.isArray(arr)) return [];
			return arr
				.map((e) => ({ cardName: String(e?.cardName ?? ""), count: Number(e?.count ?? 0) }))
				.filter((e) => e.cardName);
		};

		const deckSpells = normalizeEntries(current.deckSpells);
		const deckSites = normalizeEntries(current.deckSites);
		const deckCollection = normalizeEntries(current.deckCollection);
		const maybeSpells = normalizeEntries(current.deckMaybeSpells);
		const maybeSites = normalizeEntries(current.deckMaybeSites);
		const maybeCollection = normalizeEntries(current.deckMaybeCollection);

		const ALL_ELEMENTS = ["Air", "Fire", "Water", "Earth"];
		const deckElements = ALL_ELEMENTS.filter((el) => {
			const elLow = el.toLowerCase();
			return deckSpells.some((e) => {
				const g = guardianByName.get(e.cardName);
				return g?.thresholds && Number(g.thresholds[elLow] || 0) > 0;
			});
		});
		const comboLabel = elementComboName(deckElements);
		const descriptor = [comboLabel, avatar].filter(Boolean).join(" ");

		const copyLimitFor = (cardName) => {
			const g = guardianByName.get(cardName);
			return Number(config.rarityTargets?.[g?.rarity] ?? 4);
		};

		const spellTotal = deckSpells.reduce((s, e) => s + e.count, 0);
		const siteTotal = deckSites.reduce((s, e) => s + e.count, 0);
		const collTotal = deckCollection.reduce((s, e) => s + e.count, 0);

		const spellsOk = spellTotal >= 60;
		const sitesOk = siteTotal >= 30;
		const collOk = collTotal <= 10;

		const copyViolators = [];
		for (const entry of [...deckSpells, ...deckSites, ...deckCollection]) {
			const limit = copyLimitFor(entry.cardName);
			if (entry.count > limit) copyViolators.push({ cardName: entry.cardName, count: entry.count, limit });
		}

		const deckValid = spellsOk && sitesOk && collOk && copyViolators.length === 0;

		const deckFilePath = current.file.path;
		const fireMode = (mode) => {
			globalThis.__sorceryDeckPreselect = { path: deckFilePath, mode };
			app.commands.executeCommandById("quickadd:choice:sorcery-edit-deck");
		};

		const cardActionsRow = dv.container.createDiv({ cls: "sorcery-deck-actions" });
		[
			{ label: "Add Card",          mode: "add" },
			{ label: "Remove Card",       mode: "remove" },
			{ label: "Add Maybeboard",    mode: "maybeboard-add" },
			{ label: "Remove Maybeboard", mode: "maybeboard-remove" },
		].forEach(({ label, mode }) => {
			const btn = cardActionsRow.createEl("button", {
				cls: "sorcery-action-btn",
				text: label,
				attr: { type: "button" },
			});
			btn.addEventListener("click", () => fireMode(mode));
		});

		const deckActionsRow = dv.container.createDiv({ cls: "sorcery-deck-actions" });
		[
			{ label: "Edit Deck",   mode: "edit" },
		].forEach(({ label, mode }) => {
			const btn = deckActionsRow.createEl("button", {
				cls: "sorcery-action-btn",
				text: label,
				attr: { type: "button" },
			});
			btn.addEventListener("click", () => fireMode(mode));
		});

		const exportBtn = deckActionsRow.createEl("button", {
			cls: "sorcery-action-btn",
			text: "Export Deck",
			attr: { type: "button" },
		});
		exportBtn.addEventListener("click", () => {
			globalThis.__sorceryExportPreselect = { path: deckFilePath, type: "deck" };
			app.commands.executeCommandById("quickadd:choice:sorcery-export-collection");
		});

		[
			{ label: "Clear Deck",  mode: "clear",  danger: true },
			{ label: "Delete Deck", mode: "delete", danger: true },
		].forEach(({ label, mode }) => {
			const btn = deckActionsRow.createEl("button", {
				cls: "sorcery-action-btn is-danger",
				text: label,
				attr: { type: "button" },
			});
			btn.addEventListener("click", () => fireMode(mode));
		});

		dv.container.createEl("hr", { cls: "sorcery-deck-divider" });

		const header = dv.container.createDiv({ cls: "sorcery-deck-header" });
		header.createDiv({ cls: "sorcery-title sorcery-deck-title", text: deckName });
		if (descriptor) header.createDiv({ cls: "sorcery-deck-descriptor", text: descriptor });
		if (deckElements.length) {
			const iconRow = header.createDiv({ cls: "sorcery-deck-elements" });
			for (const el of deckElements) {
				const src = iconPath(config, el);
				if (src) iconRow.createEl("img", { cls: "sorcery-element-icon sorcery-deck-element-icon", attr: { src, alt: el } });
			}
		}

		const validPanel = dv.container.createDiv({ cls: "sorcery-deck-validity" });
		const makeValRow = (label, value, ok) => {
			const row = validPanel.createDiv({ cls: `sorcery-deck-validity-row${ok ? "" : " is-invalid"}` });
			row.createSpan({ cls: "sorcery-deck-validity-label", text: label });
			row.createSpan({ cls: "sorcery-deck-validity-value", text: value });
		};
		makeValRow("Spellbook", `${spellTotal} / 60`, spellsOk);
		makeValRow("Atlas", `${siteTotal} / 30`, sitesOk);
		makeValRow("Collection", `${collTotal} / 10`, collOk);
		if (copyViolators.length) {
			const row = validPanel.createDiv({ cls: "sorcery-deck-validity-row is-invalid" });
			row.createSpan({ cls: "sorcery-deck-validity-label", text: "Copy limits" });
			const val = row.createDiv({ cls: "sorcery-deck-validity-value sorcery-deck-copy-violations" });
			for (const v of copyViolators) {
				val.createDiv({ cls: "sorcery-deck-copy-violation", text: `${v.cardName}: ${v.count}/${v.limit}` });
			}
		}

		const badgeRow = dv.container.createDiv({ cls: "sorcery-deck-badge-row" });
		badgeRow.createDiv({
			cls: `sorcery-deck-validity-badge${deckValid ? " is-valid" : " is-invalid"}`,
			text: deckValid ? "✓ Valid" : "✗ Invalid",
		});
		let showOwned = false;
		const ownedToggle = badgeRow.createEl("button", {
			cls: "sorcery-deck-owned-toggle",
			text: "Show Owned",
			attr: { type: "button" },
		});

		const bubbles = [];
		const makeBubble = (parent, cardName, deckCount) => {
			const limit = copyLimitFor(cardName);
			const el = parent.createDiv({
				cls: `sorcery-deck-count-bubble${deckCount > limit ? " is-over-limit" : ""}`,
				text: `${deckCount}x`,
			});
			bubbles.push({ el, cardName, deckCount, limit });
			return el;
		};
		const updateBubbles = () => {
			for (const { el, cardName, deckCount, limit } of bubbles) {
				if (showOwned) {
					const ownedCount = ownedByName.get(cardName) || 0;
					el.className = `sorcery-deck-count-bubble is-owned-mode${ownedCount < deckCount ? " is-shortage" : " is-sufficient"}`;
					el.textContent = `${ownedCount} / ${deckCount}`;
				} else {
					el.className = `sorcery-deck-count-bubble${deckCount > limit ? " is-over-limit" : ""}`;
					el.textContent = `${deckCount}x`;
				}
			}
			ownedToggle.textContent = showOwned ? "Show Deck Count" : "Show Owned";
			ownedToggle.classList.toggle("is-active", showOwned);
		};
		ownedToggle.addEventListener("click", () => { showOwned = !showOwned; updateBubbles(); });

		const sortedEntries = (entries) =>
			[...entries].sort((a, b) => {
				const costA = Number(guardianByName.get(a.cardName)?.cost ?? Infinity);
				const costB = Number(guardianByName.get(b.cardName)?.cost ?? Infinity);
				if (costA !== costB) return costA - costB;
				return a.cardName.localeCompare(b.cardName, undefined, { sensitivity: "base" });
			});

		// Shared hover art tooltip — one per render, cleaned up on navigation
		document.querySelectorAll(".sorcery-deck-art-hover").forEach((el) => el.remove());
		const hoverEl = document.createElement("div");
		hoverEl.className = "sorcery-deck-art-hover";
		const hoverImg = document.createElement("img");
		hoverEl.appendChild(hoverImg);
		document.body.appendChild(hoverEl);
		const hoverObs = new MutationObserver(() => {
			if (!dv.container.isConnected) { clearTimeout(hoverTimer); hoverTimer = null; hoverEl.remove(); hoverObs.disconnect(); }
		});
		hoverObs.observe(document.body, { childList: true, subtree: true });
		let hoverWidth = 250;
		const moveHover = (e) => {
			const TW = hoverWidth, TH = Math.round(TW * 1.4);
			const x = e.clientX + 20 + TW > window.innerWidth ? e.clientX - TW - 10 : e.clientX + 20;
			const y = Math.max(8, Math.min(e.clientY - TH / 2, window.innerHeight - TH - 8));
			hoverEl.style.left = x + "px";
			hoverEl.style.top = y + "px";
		};
		let hoverTimer = null;
		const showHover = (e, src, width = 250) => {
			if (!hoverEl.isConnected) document.body.appendChild(hoverEl);
			hoverWidth = width;
			hoverImg.style.width = width + "px";
			hoverImg.src = src;
			hoverEl.style.display = "block";
			moveHover(e);
		};
		const hideHover = () => { clearTimeout(hoverTimer); hoverTimer = null; hoverEl.style.display = "none"; };

		const THRESH_MAP = [["air", "Air"], ["fire", "Fire"], ["water", "Water"], ["earth", "Earth"]];

		const renderEntry = (parent, entry, showThresholds = false, isMaybe = false) => {
			const row = parent.createDiv({ cls: `sorcery-deck-entry${isMaybe ? " sorcery-deck-entry--maybe" : ""}` });

			const entryGuardian = guardianByName.get(entry.cardName);

			makeBubble(row, entry.cardName, entry.count);

			const nameEl = row.createDiv({ cls: "sorcery-deck-entry-name" });
			const cardPath = cardSummaryPathForName(config, entry.cardName);
			nameEl.appendChild(cardLink(dv, cardPath || `${config.cardsDir}/${entry.cardName}/${entry.cardName}.md`, entry.cardName));

			const artFile = artFileByName.get(entry.cardName);
			if (artFile) {
				const isSite = String(entryGuardian?.type || "") === "Site";
				nameEl.addEventListener("mouseenter", (e) => {
					// Pre-fetch concurrently so it's ready when the timer fires
					const srcPromise = isSite
						? getSiteImageSrc(artFile)
						: Promise.resolve(app.vault.getResourcePath(artFile));
					hoverTimer = setTimeout(async () => {
						const src = await srcPromise;
						if (src) showHover(e, src, isSite ? 375 : 275);
					}, 750);
				});
				nameEl.addEventListener("mousemove", moveHover);
				nameEl.addEventListener("mouseleave", hideHover);
				nameEl.addEventListener("click", hideHover);
			}

			if (showThresholds) {
				const thresholds = entryGuardian?.thresholds || {};
				if (THRESH_MAP.some(([k]) => Number(thresholds[k]) > 0)) {
					const iconsEl = row.createDiv({ cls: "sorcery-deck-threshold-icons" });
					for (const [key, label] of THRESH_MAP) {
						const n = Number(thresholds[key] || 0);
						for (let i = 0; i < n; i++) {
							const src = iconPath(config, label);
							if (src) iconsEl.createEl("img", { cls: "sorcery-element-icon", attr: { src, alt: label } });
						}
					}
				}
			}

			const isSiteEntry = String(entryGuardian?.type || "") === "Site";
			if (!isSiteEntry) {
				const entryCost = entryGuardian?.cost;
				row.createDiv({
					cls: "sorcery-deck-cost-bubble",
					text: entryCost != null ? String(entryCost) : "X",
				});
			}
		};

		const deckTopRow = dv.container.createDiv({ cls: "sorcery-deck-top-row" });

		if (deckSpells.length > 0 || maybeSpells.length > 0) {
			const SPELL_TYPE_ORDER = ["Minion", "Magic", "Artifact", "Aura"];
			const byType = new Map();
			for (const entry of deckSpells) {
				const t = String(guardianByName.get(entry.cardName)?.type || "Other");
				if (!byType.has(t)) byType.set(t, []);
				byType.get(t).push(entry);
			}
			const byMaybeType = new Map();
			for (const entry of maybeSpells) {
				const t = String(guardianByName.get(entry.cardName)?.type || "Other");
				if (!byMaybeType.has(t)) byMaybeType.set(t, []);
				byMaybeType.get(t).push(entry);
			}
			const zone = deckTopRow.createDiv({ cls: "sorcery-deck-zone sorcery-deck-zone--spellbook" });
			zone.createDiv({ cls: "sorcery-deck-zone-title", text: `Spellbook (${spellTotal})` });
			const cols = zone.createDiv({ cls: "sorcery-deck-spell-columns" });
			const allTypeKeys = new Set([...byType.keys(), ...byMaybeType.keys()]);
			const typeOrder = [
				...SPELL_TYPE_ORDER.filter((t) => allTypeKeys.has(t)),
				...[...allTypeKeys].filter((t) => !SPELL_TYPE_ORDER.includes(t)),
			];
			for (const typeName of typeOrder) {
				const entries = sortedEntries(byType.get(typeName) || []);
				const maybeEntries = sortedEntries(byMaybeType.get(typeName) || []);
				if (!entries.length && !maybeEntries.length) continue;
				const typeTotal = entries.reduce((s, e) => s + e.count, 0);
				const col = cols.createDiv({ cls: "sorcery-deck-spell-column" });
				col.createDiv({ cls: "sorcery-deck-type-heading", text: `${typeName} (${typeTotal})` });
				for (const entry of entries) renderEntry(col, entry, true);
				if (maybeEntries.length) {
					const maybeTotal = maybeEntries.reduce((s, e) => s + e.count, 0);
					col.createDiv({ cls: "sorcery-deck-maybe-separator", text: `Maybeboard (${maybeTotal})` });
					for (const entry of maybeEntries) renderEntry(col, entry, true, true);
				}
			}
		}

		if (deckSites.length > 0 || maybeSites.length > 0) {
			const zone = deckTopRow.createDiv({ cls: "sorcery-deck-zone sorcery-deck-zone--atlas" });
			zone.createDiv({ cls: "sorcery-deck-zone-title", text: `Atlas (${siteTotal})` });
			const siteCol = zone.createDiv({ cls: "sorcery-deck-spell-column" });
			siteCol.createDiv({ cls: "sorcery-deck-type-heading", text: `Site (${siteTotal})` });
			for (const entry of sortedEntries(deckSites)) renderEntry(siteCol, entry, true);
			if (maybeSites.length) {
				const maybeSiteTotal = sortedEntries(maybeSites).reduce((s, e) => s + e.count, 0);
				siteCol.createDiv({ cls: "sorcery-deck-maybe-separator", text: `Maybeboard (${maybeSiteTotal})` });
				for (const entry of sortedEntries(maybeSites)) renderEntry(siteCol, entry, true, true);
			}
		}

		if (deckCollection.length > 0 || maybeCollection.length > 0) {
			const zone = deckTopRow.createDiv({ cls: "sorcery-deck-zone sorcery-deck-zone--collection" });
			zone.createDiv({ cls: "sorcery-deck-zone-title", text: `Collection (${collTotal})` });
			const col = zone.createDiv({ cls: "sorcery-deck-spell-column" });
			for (const entry of sortedEntries(deckCollection)) renderEntry(col, entry, true);
			if (maybeCollection.length) {
				const maybeCollTotal = sortedEntries(maybeCollection).reduce((s, e) => s + e.count, 0);
				col.createDiv({ cls: "sorcery-deck-maybe-separator", text: `Maybeboard (${maybeCollTotal})` });
				for (const entry of sortedEntries(maybeCollection)) renderEntry(col, entry, true, true);
			}
		}

		const statsSection = dv.container.createDiv({ cls: "sorcery-deck-stats" });
		const statsTitleRow = statsSection.createDiv({ cls: "sorcery-deck-stats-title-row" });
		statsTitleRow.createDiv({ cls: "sorcery-deck-stats-title", text: "Stats" });
		let includeCollection = false;
		let statsSpells = deckSpells;

		const curveSection = statsSection.createDiv({ cls: "sorcery-deck-stat-section" });
		curveSection.createDiv({ cls: "sorcery-deck-stat-heading", text: "Spellbook Cost Curve" });
		const CURVE_TYPES = ["Minion", "Magic", "Artifact", "Aura"];
		const activeTypes = new Set(CURVE_TYPES);
		const activeElements = new Set(deckElements);
		const activeNeutral = new Set(["neutral"]);
		const filterBar = curveSection.createDiv({ cls: "sorcery-deck-curve-filters" });
		const curveWrap = curveSection.createDiv({ cls: "sorcery-deck-curve-wrap" });

		const renderCostCurve = () => {
			curveWrap.replaceChildren();
			const filteredForCurve = statsSpells.flatMap((entry) => {
				const g = guardianByName.get(entry.cardName);
				if (!g) return [];
				if (!activeTypes.has(g.type)) return [];
				const isNeutral = ["fire","water","air","earth"].every(k => !Number(g.thresholds?.[k]));
				if (isNeutral && !activeNeutral.has("neutral")) return [];
				if (!isNeutral) {
					const hasAnyActiveEl = deckElements.some(
						(el) => activeElements.has(el) && Number(g.thresholds?.[el.toLowerCase()] || 0) > 0
					);
					if (!hasAnyActiveEl) return [];
				}
				const cost = Number(g.cost);
				if (!Number.isFinite(cost)) return [];
				return [{ cost: Math.floor(cost), count: entry.count }];
			});
			const maxCost = Math.max(0, ...filteredForCurve.map((e) => e.cost));
			const buckets = new Array(maxCost + 1).fill(0);
			for (const { cost, count } of filteredForCurve) buckets[cost] += count;
			const total = buckets.reduce((s, n) => s + n, 0);
			curveWrap.createDiv({ cls: "sorcery-deck-chart-total", text: `Total: ${total}` });
			const maxB = Math.max(...buckets, 1);
			const chart = curveWrap.createDiv({ cls: "sorcery-deck-cost-chart" });
			for (let i = 0; i <= maxCost; i++) {
				const count = buckets[i];
				const pct = count > 0 ? Math.max(4, Math.round((count / maxB) * 100)) : 0;
				const bar = chart.createDiv({ cls: "sorcery-deck-cost-bar" });
				const slot = bar.createDiv({ cls: "sorcery-deck-cost-bar-slot" });
				if (count > 0) slot.createDiv({ cls: "sorcery-deck-cost-bar-count", text: String(count) });
				const fill = slot.createDiv({ cls: "sorcery-deck-cost-bar-fill" });
				fill.style.height = `${pct}%`;
				bar.createDiv({ cls: "sorcery-deck-cost-bar-label", text: String(i) });
			}
		};

		const makeToggle = (parent, key, set, label, iconEl) => {
			const btn = parent.createEl("button", {
				cls: "sorcery-deck-filter-btn is-active",
				attr: { type: "button" },
			});
			if (iconEl) btn.appendChild(iconEl);
			else btn.textContent = label;
			btn.addEventListener("click", () => {
				if (set.has(key)) set.delete(key); else set.add(key);
				btn.classList.toggle("is-active", set.has(key));
				renderCostCurve();
			});
		};

		const typeRow = filterBar.createDiv({ cls: "sorcery-deck-curve-filter-row" });
		for (const t of CURVE_TYPES) makeToggle(typeRow, t, activeTypes, t, null);

		if (deckElements.length > 0) {
			const elemRow = filterBar.createDiv({ cls: "sorcery-deck-curve-filter-row" });
			for (const el of deckElements) {
				const src = iconPath(config, el);
				let img = null;
				if (src) {
					img = document.createElement("img");
					img.className = "sorcery-element-icon";
					img.src = src;
					img.alt = el;
				}
				makeToggle(elemRow, el, activeElements, el, img);
			}
			makeToggle(elemRow, "neutral", activeNeutral, "Neutral", null);
		}

		renderCostCurve();

		const THRESH_ELEM_COLORS = {
			Air:   "rgba(170, 215, 245, 0.8)",
			Water: "rgba(40,  175, 200, 0.8)",
			Fire:  "rgba(225, 95,  35,  0.8)",
			Earth: "rgba(160, 125, 55,  0.8)",
		};
		let threshGrid = null;
		const renderThresholds = () => {
			if (!threshGrid) return;
			threshGrid.replaceChildren();
			const grid = threshGrid;
			// Find shared max threshold across all elements
			let maxThresh = 1;
			for (const el of deckElements) {
				const elLow = el.toLowerCase();
				for (const entry of statsSpells) {
					const g = guardianByName.get(entry.cardName);
					if (!g?.thresholds) continue;
					const t = Number(g.thresholds[elLow] || 0);
					if (t > maxThresh) maxThresh = t;
				}
			}
			for (const el of deckElements) {
				const elLow = el.toLowerCase();
				const buckets = new Array(maxThresh + 1).fill(0);
				for (const entry of statsSpells) {
					const g = guardianByName.get(entry.cardName);
					if (!g?.thresholds) continue;
					const t = Math.min(Number(g.thresholds[elLow] || 0), maxThresh);
					buckets[t] += entry.count;
				}
				const elTotal = buckets.slice(1).reduce((s, n) => s + n, 0);
				const maxB = Math.max(...buckets, 1);
				const chart = grid.createDiv({ cls: "sorcery-deck-threshold-chart" });
				const titleEl = chart.createDiv({ cls: "sorcery-deck-threshold-title" });
				const src = iconPath(config, el);
				if (src) {
					const iconSpan = titleEl.createSpan({ cls: "sorcery-thresh-icon" });
					iconSpan.style.backgroundImage = `url("${src}")`;
				}
				titleEl.createSpan({ cls: "sorcery-deck-threshold-count", text: src ? `: ${elTotal}` : `${el}: ${elTotal}` });
				const bars = chart.createDiv({ cls: "sorcery-deck-cost-chart sorcery-deck-cost-chart--threshold" });
				for (let i = 1; i <= maxThresh; i++) {
					const count = buckets[i];
					const pct = count > 0 ? Math.max(4, Math.round((count / maxB) * 100)) : 0;
					const bar = bars.createDiv({ cls: "sorcery-deck-cost-bar" });
					const slot = bar.createDiv({ cls: "sorcery-deck-cost-bar-slot" });
					if (count > 0) slot.createDiv({ cls: "sorcery-deck-cost-bar-count", text: String(count) });
					const fill = slot.createDiv({ cls: "sorcery-deck-cost-bar-fill" });
					fill.style.height = `${pct}%`;
					if (THRESH_ELEM_COLORS[el]) fill.style.background = THRESH_ELEM_COLORS[el];
					bar.createDiv({ cls: "sorcery-deck-cost-bar-label", text: String(i) });
				}
			}
		};
		if (deckElements.length > 0) {
			const histSection = statsSection.createDiv({ cls: "sorcery-deck-stat-section" });
			histSection.createDiv({ cls: "sorcery-deck-stat-heading", text: "Spellbook Threshold Requirements" });
			threshGrid = histSection.createDiv({ cls: "sorcery-deck-threshold-grid" });
			renderThresholds();
		}

		if (deckSites.length > 0) {
			const ELEM_KEYS = ["fire", "water", "air", "earth"];
			const ELEM_LABELS = { fire: "Fire", water: "Water", air: "Air", earth: "Earth" };
			const siteCount = {}, totalProvided = {};
			for (const k of ELEM_KEYS) { siteCount[k] = 0; totalProvided[k] = 0; }
			const totalSites = deckSites.reduce((s, e) => s + e.count, 0);
			for (const entry of deckSites) {
				const g = guardianByName.get(entry.cardName);
				if (!g?.thresholds) continue;
				for (const k of ELEM_KEYS) {
					const val = Number(g.thresholds[k] || 0);
					if (val > 0) {
						siteCount[k] += entry.count;
						totalProvided[k] += val * entry.count;
					}
				}
			}
			const coverSection = statsSection.createDiv({ cls: "sorcery-deck-stat-section" });
			coverSection.createDiv({ cls: "sorcery-deck-stat-heading", text: "Atlas Coverage" });
			coverSection.createDiv({ cls: "sorcery-deck-site-total", text: `Total: ${totalSites} / 30 sites` });
			if (ELEM_KEYS.some((k) => siteCount[k] > 0)) {
				const table = coverSection.createEl("table", { cls: "sorcery-deck-elem-table" });
				const thead = table.createEl("thead");
				const totalProvidedAll = ELEM_KEYS.reduce((s, k) => s + totalProvided[k], 0);
				const tbody = table.createEl("tbody");
				if (app.isMobile) {
					for (const k of ELEM_KEYS) {
						if (!siteCount[k]) continue;
						const sitePct = Math.round((siteCount[k] / totalSites) * 100);
						const provPct = totalProvidedAll > 0 ? Math.round((totalProvided[k] / totalProvidedAll) * 100) : 0;
						const trLabel1 = tbody.createEl("tr", { cls: "sorcery-elem-label-row" });
						const iconCell = trLabel1.createEl("td", { attr: { rowspan: "4" } });
						const src = iconPath(config, ELEM_LABELS[k]);
						if (src) iconCell.createEl("img", { cls: "sorcery-element-icon", attr: { src, alt: ELEM_LABELS[k] } });
						trLabel1.createEl("td", { text: "Sites" });
						trLabel1.createEl("td", { text: "Sites %" });
						const trVal1 = tbody.createEl("tr", { cls: "sorcery-elem-site-row" });
						trVal1.createEl("td", { text: String(siteCount[k]) });
						trVal1.createEl("td", { text: `${sitePct}%` });
						const trLabel2 = tbody.createEl("tr", { cls: "sorcery-elem-label-row sorcery-elem-provided-label" });
						trLabel2.createEl("td", { text: "Provided" });
						trLabel2.createEl("td", { text: "Provided %" });
						const trVal2 = tbody.createEl("tr", { cls: "sorcery-elem-sub-row" });
						trVal2.createEl("td", { text: String(totalProvided[k]) });
						trVal2.createEl("td", { text: `${provPct}%` });
					}
				} else {
					const hr = thead.createEl("tr");
					hr.createEl("th", { text: "Element" });
					hr.createEl("th", { text: "Sites" });
					hr.createEl("th", { text: "Sites %" });
					hr.createEl("th", { text: "Provided" });
					hr.createEl("th", { text: "Provided %" });
					for (const k of ELEM_KEYS) {
						if (!siteCount[k]) continue;
						const tr = tbody.createEl("tr");
						const labelCell = tr.createEl("td");
						const src = iconPath(config, ELEM_LABELS[k]);
						if (src) labelCell.createEl("img", { cls: "sorcery-element-icon", attr: { src, alt: ELEM_LABELS[k] } });
						const sitePct = Math.round((siteCount[k] / totalSites) * 100);
						const provPct = totalProvidedAll > 0 ? Math.round((totalProvided[k] / totalProvidedAll) * 100) : 0;
						tr.createEl("td", { text: String(siteCount[k]) });
						tr.createEl("td", { text: `${sitePct}%` });
						tr.createEl("td", { text: String(totalProvided[k]) });
						tr.createEl("td", { text: `${provPct}%` });
					}
				}
			}
		}
		const collBtn = statsTitleRow.createEl("button", {
			cls: "sorcery-deck-filter-btn",
			attr: { type: "button" },
			text: "Collection",
		});
		collBtn.addEventListener("click", () => {
			includeCollection = !includeCollection;
			statsSpells = includeCollection ? [...deckSpells, ...deckCollection] : deckSpells;
			collBtn.classList.toggle("is-active", includeCollection);
			renderCostCurve();
			renderThresholds();
		});
	}

	async function renderDecks(dv) {
		const isActive = beginTrackedRender(dv.container);
		const config = await loadConfig();
		if (!isActive()) return;

		const apiSource = await loadApiData(config);
		if (!isActive()) return;

		const apiCards = apiSource?.data || [];
		const guardianByName = new Map();
		for (const card of apiCards) {
			if (card.name) guardianByName.set(card.name, card.guardian || {});
		}

		const decksDir = config.decksDir || "decks";
		const deckNotes = dv
			.pages(`"${vaultPath(config, decksDir)}"`)
			.where((p) => p.kind === "sorcery-deck")
			.array();

		const normalizeEntries = (arr) => {
			if (!Array.isArray(arr)) return [];
			return arr
				.map((e) => ({ cardName: String(e?.cardName ?? ""), count: Number(e?.count ?? 0) }))
				.filter((e) => e.cardName);
		};

		const decks = deckNotes
			.map((p) => {
				const deckName = String(p.deckName || p.file?.name || "");
				const avatar = String(p.avatar || "");
				const spells = normalizeEntries(p.deckSpells);
				const sites = normalizeEntries(p.deckSites);
				const collection = normalizeEntries(p.deckCollection);
				const ALL_ELEMENTS = ["Air", "Fire", "Water", "Earth"];
				const elements = ALL_ELEMENTS.filter((el) => {
					const elLow = el.toLowerCase();
					return spells.some((e) => {
						const g = guardianByName.get(e.cardName);
						return g?.thresholds && Number(g.thresholds[elLow] || 0) > 0;
					});
				});
				const comboLabel = elementComboName(elements);
				const descriptor = [comboLabel, avatar].filter(Boolean).join(" ");
				const spellTotal = spells.reduce((s, e) => s + e.count, 0);
				const siteTotal = sites.reduce((s, e) => s + e.count, 0);
				const collTotal = collection.reduce((s, e) => s + e.count, 0);
				let copyOk = true;
				for (const entry of [...spells, ...sites, ...collection]) {
					const rarity = guardianByName.get(entry.cardName)?.rarity || "";
					const limit = Number(config.rarityTargets?.[rarity] ?? 4);
					if (entry.count > limit) { copyOk = false; break; }
				}
				const valid = spellTotal >= 60 && siteTotal >= 30 && collTotal <= 10 && copyOk;
				return { p, deckName, elements, avatar, comboLabel, descriptor, spellTotal, siteTotal, collTotal, valid };
			})
			.sort((a, b) => a.deckName.localeCompare(b.deckName, undefined, { sensitivity: "base" }));

		const ELEMENT_AFFECTS = {
			Fire: ["Fire", "Steam", "Smoke", "Lava"],
			Water: ["Water", "Steam", "Mist", "Mud"],
			Air: ["Air", "Smoke", "Mist", "Dust"],
			Earth: ["Earth", "Lava", "Mud", "Dust"],
		};

		const topbar = dv.container.createDiv({ cls: "sorcery-decks-topbar" });
		const addBtn = topbar.createEl("button", { cls: "sorcery-action-btn", text: "+ New Deck" });
		addBtn.addEventListener("click", () =>
			app.commands.executeCommandById("quickadd:choice:sorcery-add-deck-entry"),
		);
		const importBtn = topbar.createEl("button", { cls: "sorcery-action-btn", text: "Import Deck" });
		importBtn.addEventListener("click", () =>
			app.commands.executeCommandById("quickadd:choice:sorcery-import-deck"),
		);
		const deleteBtn = topbar.createEl("button", { cls: "sorcery-action-btn is-danger", text: "Delete Deck" });
		deleteBtn.addEventListener("click", () => {
			globalThis.__sorceryDeckPreselect = { mode: "delete" };
			app.commands.executeCommandById("quickadd:choice:sorcery-edit-deck");
		});

		const controls = dv.container.createDiv({ cls: "sorcery-controls" });
		const { input: search } = createSearchWidget(controls, "Search decks...");

		let renderRows = () => {};
		const onChange = () => renderRows();

		const avatars = [...new Set(decks.map((d) => d.avatar).filter(Boolean))].sort();
		const avatarFilter = createDropdownWidget(controls, "All avatars", config, onChange);
		avatarFilter.addOption("All avatars", "");
		for (const a of avatars) avatarFilter.addOption(a, a);
		avatarFilter.fitWidth();

		const usedEls = new Set();
		for (const d of decks) for (const el of d.elements) usedEls.add(el);
		const hasNeutral = decks.some((d) => d.elements.length === 0);
		const elementFilter = createDropdownWidget(controls, "All elements", config, onChange);
		elementFilter.addOption("All elements", "");
		for (const el of ["Air", "Earth", "Fire", "Water"]) {
			if (usedEls.has(el)) elementFilter.addOption(el, el, el);
		}
		if (hasNeutral) elementFilter.addOption("Neutral", "__neutral__");
		elementFilter.fitWidth();

		const stats = dv.container.createDiv({ cls: "sorcery-stats" });
		const output = dv.container.createDiv({ cls: "sorcery-output" });

		renderRows = () => {
			const q = String(search.value || "").trim().toLowerCase();
			const filtered = decks.filter((d) => {
				if (avatarFilter.value && d.avatar !== avatarFilter.value) return false;
				if (elementFilter.value === "__neutral__") {
					if (d.elements.length > 0) return false;
				} else if (elementFilter.value) {
					const validLabels = ELEMENT_AFFECTS[elementFilter.value] || [];
					if (!validLabels.includes(d.comboLabel)) return false;
				}
				if (q) {
					return [d.deckName, d.descriptor, d.avatar, ...d.elements]
						.join(" ")
						.toLowerCase()
						.includes(q);
				}
				return true;
			});

			stats.textContent = `Decks: ${filtered.length}`;
			output.replaceChildren();

			if (!filtered.length) {
				output.createDiv({ cls: "sorcery-deck-empty", text: "No decks found." });
				return;
			}

			const list = output.createDiv({ cls: "sorcery-deck-overview-list" });
			for (const deck of filtered) {
				const item = list.createDiv({ cls: "sorcery-deck-overview-item" });
				const nameEl = item.createDiv({ cls: "sorcery-deck-overview-name" });
				nameEl.appendChild(cardLink(dv, deck.p.file.path, deck.deckName));
				const subtitleRow = item.createDiv({ cls: "sorcery-deck-overview-subtitle-row" });
				subtitleRow.createDiv({ cls: "sorcery-deck-overview-descriptor", text: deck.descriptor || deck.comboLabel || "" });
				if (deck.elements.length) {
					const iconRow = subtitleRow.createDiv({ cls: "sorcery-deck-overview-icons" });
					for (const el of deck.elements) {
						const src = iconPath(config, el);
						if (src) iconRow.createEl("img", { cls: "sorcery-element-icon", attr: { src, alt: el } });
					}
				}
			}
		};

		search.addEventListener("input", renderRows);
		renderRows();
	}
	async function renderCodex(dv) {
		const isActive = beginTrackedRender(dv.container);
		const config = await loadConfig();
		if (!isActive()) return;

		const codexDir = vaultPath(config, "codex");
		const pages = dv
			.pages(`"${codexDir}"`)
			.where((p) => p.kind === "sorcery-codex")
			.sort((p) => p.title, "asc")
			.array();

		const controls = dv.container.createDiv({ cls: "sorcery-controls" });
		const { input: search } = createSearchWidget(controls, "Search codex…");

		const countEl = controls.createDiv({ cls: "sorcery-codex-count", attr: { hidden: true } });

		const listEl = dv.container.createDiv({ cls: "sorcery-codex-list" });

		// Build body-text map in background; cache in globalThis so repeat visits are instant.
		if (!(globalThis.__sorceryCodexTextMap instanceof Promise)) {
			globalThis.__sorceryCodexTextMap = (async () => {
				const map = new Map();
				await Promise.all(pages.map(async (p) => {
					try {
						const raw = await app.vault.adapter.read(p.file.path);
						const body = raw.replace(/^---[\s\S]*?---\n/, "");
						const text = body
							.replace(/!\[\[[^\]]*\]\]/g, "")
							.replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, "$1")
							.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
							.replace(/^#{1,6}\s+/gm, "")
							.replace(/^\s*[-*\d.]+\s+/gm, "")
							.replace(/<[^>]+>/g, "")
							.toLowerCase();
						map.set(p.file.path, text);
					} catch {}
				}));
				return map;
			})();
		}
		let pageTextMap = new Map();
		globalThis.__sorceryCodexTextMap.then((map) => { pageTextMap = map; });

		function makeBubble(parent, page) {
			const bubble = parent.createEl("a", {
				cls: "sorcery-codex-bubble",
				text: page.title || page.file?.name,
				href: page.file?.path,
			});
			bubble.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				app.workspace.openLinkText(page.file.path, "", e.ctrlKey || e.metaKey);
			});
		}

		function renderRows() {
			if (!isActive()) return;
			listEl.empty();
			const q = search.value.toLowerCase().trim();
			const score = (p) => {
				const title = p.title?.toLowerCase() || "";
				if (title === q) return 0;
				if (title.startsWith(q)) return 1;
				if (title.includes(q)) return 2;
				if (p.finder?.toLowerCase().includes(q)) return 3;
				return 4;
			};
			const filtered = pages
				.filter((p) => {
					if (!q) return true;
					if (p.title?.toLowerCase().includes(q)) return true;
					if (p.finder?.toLowerCase().includes(q)) return true;
					if (pageTextMap.get(p.file.path)?.includes(q)) return true;
					return false;
				})
				.sort((a, b) => score(a) - score(b) || a.title?.localeCompare(b.title));
			countEl.setText(`${filtered.length} / ${pages.length}`);

			if (!filtered.length) {
				listEl.createDiv({ cls: "sorcery-codex-empty", text: "No entries found." });
				return;
			}

			if (q) {
				listEl.removeClass("sorcery-codex-list--flat");
				listEl.addClass("sorcery-codex-list--search");
				const direct = filtered.filter((p) => score(p) <= 3);
				const body   = filtered.filter((p) => score(p) >  3);
				const col = listEl.createDiv({ cls: "sorcery-codex-column" });
				for (const page of direct) makeBubble(col, page);
				if (body.length) {
					if (direct.length) col.createDiv({ cls: "sorcery-codex-result-divider" });
					for (const page of body) {
						const b = col.createEl("a", {
							cls: "sorcery-codex-bubble sorcery-codex-bubble--dim",
							text: page.title || page.file?.name,
							href: page.file?.path,
						});
						b.addEventListener("click", (e) => {
							e.preventDefault();
							e.stopPropagation();
							app.workspace.openLinkText(page.file.path, "", e.ctrlKey || e.metaKey);
						});
					}
				}
			} else {
				// Default: one column per letter
				listEl.removeClass("sorcery-codex-list--flat");
				listEl.removeClass("sorcery-codex-list--search");
				const byLetter = new Map();
				for (const page of filtered) {
					const letter = (page.title?.[0] || "#").toUpperCase();
					if (!byLetter.has(letter)) byLetter.set(letter, []);
					byLetter.get(letter).push(page);
				}
				for (const [letter, group] of byLetter) {
					const col = listEl.createDiv({ cls: "sorcery-codex-column" });
					col.createDiv({ cls: "sorcery-codex-letter", text: letter });
					for (const page of group) makeBubble(col, page);
				}
			}
		}

		search.addEventListener("input", async () => {
			pageTextMap = await globalThis.__sorceryCodexTextMap;
			renderRows();
		});
		renderRows();
	}

	async function renderStorage(dv) {
		const isActive = beginTrackedRender(dv.container);
		const config = await loadConfig();
		if (!isActive()) return;

		const bindersDir = config.bindersDir || "storage";
		const notes = dv
			.pages(`"${vaultPath(config, bindersDir)}"`)
			.where((p) => p.kind === "sorcery-storage")
			.array()
			.sort((a, b) =>
				String(a.binderName || a.file?.name || "").localeCompare(
					String(b.binderName || b.file?.name || ""),
					undefined,
					{ sensitivity: "base" },
				),
			);

		const binders = notes.filter((p) => String(p.storageType || "binder") !== "box");
		const boxes = notes.filter((p) => String(p.storageType || "") === "box");

		const setsSection = dv.container.createDiv({ cls: "sorcery-set-cards-section" });
		const sets = setOrderFor(config);
		setsSection.createDiv({ cls: "sorcery-storage-section-heading", text: `Sets — ${sets.length}` });
		const setsEl = setsSection.createDiv({ cls: "sorcery-set-cards" });
		for (const setName of sets) {
			const setPath = vaultPath(config, `sets/${setName}.md`);
			const card = setsEl.createDiv({ cls: "sorcery-set-card" });
			card.setAttribute("role", "button");
			card.addEventListener("click", (e) => {
				const file = app.vault.getAbstractFileByPath(setPath);
				if (file) app.workspace.getLeaf(e.ctrlKey || e.metaKey ? "tab" : false).openFile(file);
			});

			const imgWrap = card.createDiv({ cls: "sorcery-set-card-image" });
			const imgRelPath = config.setImages?.[setName] ?? null;
			if (imgRelPath) {
				const absPath = vaultPath(config, imgRelPath);
				const resourceUrl = app.vault.adapter.getResourcePath(absPath);
				const img = imgWrap.createEl("img", { attr: { src: resourceUrl, alt: setName } });
				img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:inherit;pointer-events:none;";
			}

			card.createDiv({ cls: "sorcery-set-card-name", text: setName });
		}

		const topbar = dv.container.createDiv({ cls: "sorcery-decks-topbar" });
		const addBtn = topbar.createEl("button", { cls: "sorcery-action-btn", text: "+ Add Storage" });
		addBtn.addEventListener("click", () =>
			app.commands.executeCommandById("quickadd:choice:sorcery-add-binder-entry"),
		);
		const importStorageBtn = topbar.createEl("button", { cls: "sorcery-action-btn", text: "Import Storage" });
		importStorageBtn.addEventListener("click", () =>
			app.commands.executeCommandById("quickadd:choice:sorcery-import-storage"),
		);
		const deleteStorageBtn = topbar.createEl("button", { cls: "sorcery-action-btn is-danger", text: "Delete Storage" });
		deleteStorageBtn.addEventListener("click", () => {
			globalThis.__sorceryStoragePreselect = { mode: "delete" };
			app.commands.executeCommandById("quickadd:choice:sorcery-edit-binder");
		});

		const overview = dv.container.createDiv({ cls: "sorcery-storage-overview" });

		function renderSection(title, items, renderItem) {
			const section = overview.createDiv({ cls: "sorcery-storage-section" });
			section.createDiv({ cls: "sorcery-storage-section-heading", text: `${title} — ${items.length}` });
			if (!items.length) {
				section.createDiv({ cls: "sorcery-deck-empty", text: `No ${title.toLowerCase()} yet.` });
				return;
			}
			const list = section.createDiv({ cls: "sorcery-deck-overview-list" });
			for (const p of items) renderItem(list, p);
		}

		renderSection("Binders", binders, (list, p) => {
			const name = String(p.binderName || p.file?.name || "");
			const item = list.createDiv({ cls: "sorcery-deck-overview-item" });
			const nameEl = item.createDiv({ cls: "sorcery-deck-overview-name" });
			nameEl.appendChild(cardLink(dv, p.file.path, name));
			if (p.totalSlots)
				item.createDiv({ cls: "sorcery-deck-overview-descriptor", text: `${p.totalSlots} slots` });
		});

		renderSection("Boxes", boxes, (list, p) => {
			const name = String(p.binderName || p.file?.name || "");
			const item = list.createDiv({ cls: "sorcery-deck-overview-item" });
			const nameEl = item.createDiv({ cls: "sorcery-deck-overview-name" });
			nameEl.appendChild(cardLink(dv, p.file.path, name));
		});

	}

	// CSV + import/export helpers, shared by the import/export QuickAdd scripts.
	function splitCsvLine(line) {
		const cols = [];
		let cur = "", inQ = false;
		for (const c of line) {
			if (c === '"') { inQ = !inQ; continue; }
			if (c === "," && !inQ) { cols.push(cur); cur = ""; continue; }
			cur += c;
		}
		cols.push(cur);
		return cols;
	}

	function normalizeProduct(raw) {
		return String(raw || "").trim().replace(/\s+/g, "_");
	}

	// Parses a storage/collection export CSV into { storageName, rows }. storageName
	// is "" when no row is tagged "Storage" (e.g. a Curiosa export has no such row).
	function parseStorageCsv(content) {
		const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
		if (lines.length < 2) return { storageName: "", rows: [] };
		let storageName = "";
		const rows = [];
		for (let i = 1; i < lines.length; i++) {
			const cols = splitCsvLine(lines[i]);
			if (cols[5]?.trim() === "Storage") { storageName = cols[0]?.trim() || ""; continue; }
			if (cols.length < 5) continue;
			const qty = parseInt(cols[4], 10);
			if (!Number.isInteger(qty) || qty <= 0) continue;
			rows.push({
				cardName: cols[0].trim(),
				setName: cols[1].trim(),
				finish: cols[2].trim(),
				product: normalizeProduct(cols[3]),
				quantity: qty,
			});
		}
		return { storageName, rows };
	}

	// cardName|setName|finish -> [{ summaryFile, slug, product }], from the API.
	async function buildVariantIndex(config) {
		const api = await loadApiData(config);
		const index = new Map();
		for (const card of api?.data || []) {
			const summaryFile = app.vault.getAbstractFileByPath(
				cardSummaryPathForName(config, card.name) || cardNotePath(config, card.name),
			);
			for (const set of card.sets || []) {
				for (const v of set.variants || []) {
					const key = [
						String(card.name).trim().toLowerCase(),
						String(set.name).trim().toLowerCase(),
						String(v.finish || "").trim().toLowerCase(),
					].join("|");
					if (!index.has(key)) index.set(key, []);
					index.get(key).push({ summaryFile, slug: v.slug, product: String(v.product || "").trim() });
				}
			}
		}
		return index;
	}

	function findVariant(index, row) {
		const key = [row.cardName.toLowerCase(), row.setName.toLowerCase(), row.finish.toLowerCase()].join("|");
		const candidates = index.get(key);
		if (!candidates?.length) return null;
		if (candidates.length === 1) return candidates[0];
		return candidates.find((c) => c.product === row.product) ?? candidates[0];
	}

	// Creates a "box" storage note (returns the existing file if one is already there).
	async function ensureStorageBox(config, boxName) {
		const safeName = boxName.replace(/[\\/:*?"<>|]+/g, " - ").trim();
		const filePath = vaultPath(config, `${config.bindersDir}/${safeName}.md`);
		const existing = app.vault.getAbstractFileByPath(filePath);
		if (existing) return existing;
		const content = [
			"---",
			"kind: sorcery-storage",
			"cssclasses:",
			"  - sorcery-flat-meta",
			`binderName: ${JSON.stringify(boxName)}`,
			"storageType: box",
			"---",
			"",
			"```dataviewjs",
			"async function loadSorceryShared() {",
			"  if (globalThis.SorceryTrackerShared) return globalThis.SorceryTrackerShared;",
			"  const candidates = ['Sorcery Tracker/scripts/sorcery-shared.js', 'scripts/sorcery-shared.js'];",
			"  const p = candidates.find(c => app.vault.getAbstractFileByPath(c));",
			"  if (!p) throw new Error('Missing sorcery-shared.js');",
			"  const raw = await app.vault.adapter.read(p);",
			"  (0, eval)(raw);",
			"  return globalThis.SorceryTrackerShared;",
			"}",
			"const S = await loadSorceryShared();",
			"await S.renderBinder(dv);",
			"```",
			"",
		].join("\n");
		return await app.vault.create(filePath, content);
	}

	// First free note name under `dir`: "<base>", then "<base>1", "<base>2", …
	function nextAvailableNoteName(config, dir, baseName) {
		let name = baseName;
		let n = 1;
		while (true) {
			const safe = name.replace(/[\\/:*?"<>|]+/g, " - ").trim();
			if (!app.vault.getAbstractFileByPath(vaultPath(config, `${dir}/${safe}.md`))) return name;
			name = `${baseName}${n++}`;
		}
	}

	return {
		DEFAULT_CONFIG,
		loadConfig,
		invalidateConfigCache,
		resolvePath,
		vaultPath,
		ensureFolder,
		owned,
		ownedFromVariants,
		logAction,
		refreshDataview,
		addPlacementToOwnership,
		removePlacementFromOwnership,
		ownershipEntry,
		loadVariantRows,
		cardSummaryPathForName,
		cardNotePath,
		targetFor,
		complete,
		iconPath,
		elementComboName,
		addRow,
		addListRow,
		kvBlock,
		cardLink,
		readJsonByCandidates,
		loadApiData,
		buildSetManifests,
		displayProduct,
		padColumn,
		maxStringLength,
		splitCsvLine,
		parseStorageCsv,
		buildVariantIndex,
		findVariant,
		ensureStorageBox,
		nextAvailableNoteName,
		renderSummary,
		renderCollection,
		renderSet,
		renderSetPage,
		renderArtists,
		renderArtist,
		styleSuggestionModal,
		withStyledSuggestions,
		chooseVariant,
		renderBinder,
		renderDeck,
		renderDecks,
		renderStorage,
		renderCodex,
	};
})();

if (typeof globalThis !== "undefined")
	globalThis.SorceryTrackerShared = SorceryTrackerShared;
if (typeof module !== "undefined" && module.exports)
	module.exports = SorceryTrackerShared;

// Pre-warm the API data cache so it's ready before the first page renders.
if (typeof app !== "undefined" && !globalThis.__sorceryApiData) {
	const _S = globalThis.SorceryTrackerShared;
	_S.loadConfig().then(cfg => _S.loadApiData(cfg)).catch(() => {});
}

if (typeof window !== "undefined" && !globalThis.__sorceryMobileDoubleTapFixed) {
	globalThis.__sorceryMobileDoubleTapFixed = true;
	// Override pointerType → "mouse" on the reading view so Obsidian doesn't
	// trigger touch-specific behaviours (double-tap zoom, sidebar swipe, etc.)
	window.addEventListener("pointerdown", (e) => {
		const isReader = e.target.closest(".markdown-reading-view");
		if (!isReader || e.pointerType !== "touch") return;
		Object.defineProperty(e, "pointerType", { get: () => "mouse", configurable: true });
	}, { capture: true });
	// Also block touchstart so Obsidian's swipe-open-sidebar gesture never fires
	window.addEventListener("touchstart", (e) => {
		if (e.target.closest(".markdown-reading-view")) e.stopPropagation();
	}, { capture: true });
}
