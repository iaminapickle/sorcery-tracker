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
		name: "Scrape Curiosa",
		options: {},
	},
};

function blocksToText(blocks) {
	if (!Array.isArray(blocks)) return '';
	return blocks.map(block => {
		if (block._type !== 'block') return '';
		// Markers (((Title)) cross-refs and ))word(( visual markers) are left intact;
		// the summary FAQ renderer resolves refs to links and strips stray markers.
		const text = (block.children || []).map(c => c.text || '').join('');
		if (block.listItem === 'bullet') {
			const indent = '  '.repeat((block.level || 1) - 1);
			return `${indent}• ${text}`;
		}
		return text;
	}).filter(Boolean).join('\n');
}

// Convert Sanity portable-text blocks to a simplified renderable format.
// Handles 'block' (text) and 'damageGrid' (grid diagram) types.
function parseContent(blocks, resolveLink) {
	if (!Array.isArray(blocks)) return [];
	const resolve = resolveLink || (t => `[[${t}]]`);
	const result = [];
	for (const block of blocks) {
		if (block._type === 'block') {
			// Build mark definitions lookup (links, etc.)
			const markDefs = {};
			for (const def of (block.markDefs || [])) {
				markDefs[def._key] = def;
			}
			// Join child spans, applying inline formatting marks
			let text = (block.children || []).map(c => {
				let t = c.text || '';
				if (!t) return '';
				for (const mark of (c.marks || [])) {
					if (mark === 'em') t = `*${t}*`;
					else if (mark === 'strong') t = `**${t}**`;
					// external links: render plain text only
				}
				return t;
			}).join('');
			// ))word(( = curiosa visual marker → plain word (must run before the ((...)) pass)
			text = text.replace(/\)\)([^(]+)\(\(/g, '$1');
			// ((Title)) = codex cross-reference → resolved wikilink
			text = text.replace(/\(\(([^)]+)\)\)/g, (_, t) => resolve(t));
			if (!text.trim()) continue;
			const item = { type: 'text', text };
			if (block.listItem === 'bullet') {
				item.bullet = true;
				item.level = block.level || 1;
			} else if (block.listItem === 'number') {
				item.ordered = true;
				item.level = block.level || 1;
			}
			result.push(item);
		} else if (block._type === 'damageGrid') {
			const rows = (block.grid?.rows || []).map(r => r.cells || []);
			result.push({ type: 'grid', rows });
		}
	}
	return result;
}

async function scrapeFaqs(config) {
	const res = await fetch('https://curiosa.io/faqs');
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const html = await res.text();
	const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
	if (!match) throw new Error('__NEXT_DATA__ not found on FAQs page — site structure may have changed');
	const nextData = JSON.parse(match[1]);
	const raw = nextData?.props?.pageProps?.faqs;
	if (!Array.isArray(raw)) throw new Error('FAQs array missing from page data');

	const byCard = {};
	for (const entry of raw) {
		const question = blocksToText(entry.question);
		const answer   = blocksToText(entry.answer);
		if (!question && !answer) continue;
		for (const name of (entry.cardNames || [])) {
			if (!byCard[name]) byCard[name] = [];
			byCard[name].push({ question, answer });
		}
	}

	const sorted = Object.fromEntries(
		Object.entries(byCard).sort(([a], [b]) => a.localeCompare(b))
	);

	const outPath = S.vaultPath(config, `${config.dataDir}/faq-scraped.json`);
	await app.vault.adapter.write(outPath, JSON.stringify(sorted, null, 2) + '\n');
	globalThis.__sorceryFaqData = null;

	const cardCount = Object.keys(sorted).length;
	const faqCount  = Object.values(sorted).reduce((n, arr) => n + arr.length, 0);
	return { cardCount, faqCount };
}

const ELEM_ICONS = { E: 'earth', A: 'wind', F: 'fire', W: 'water' };
function applyElementIcons(text) {
	return text.replace(/\(([EAFW])\)/g, (_, k) => `![[assets/${ELEM_ICONS[k]}.png|16]]`);
}

function contentToMarkdown(content) {
	const parts = [];
	for (const block of content) {
		if (block.type === 'text') {
			const text = applyElementIcons(block.text);
			if (block.bullet) {
				const indent = '   '.repeat((block.level || 1) - 1);
				parts.push(`${indent}- ${text}`);
			} else if (block.ordered) {
				const indent = '   '.repeat((block.level || 1) - 1);
				parts.push(`${indent}1. ${text}`);
			} else {
				parts.push(text);
			}
		} else if (block.type === 'grid') {
			const rows = block.rows.map(r =>
				'<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>'
			).join('');
			parts.push(`<table class="sorcery-codex-grid">\n${rows}\n</table>`);
		}
	}
	return parts.join('\n\n');
}

function entryToNote(entry) {
	const safeTitle = entry.title.replace(/"/g, '\\"');
	const fm = `---\nkind: sorcery-codex\ncssclasses: [sorcery-codex]\ntitle: "${safeTitle}"\nfinder: "${entry.finder}"\n---`;
	let body = contentToMarkdown(entry.content);
	for (const sub of (entry.subcodexes || [])) {
		body += `\n\n## ${sub.title}\n\n${contentToMarkdown(sub.content)}`;
	}
	return `${fm}\n\n${body}\n`;
}

async function scrapeCodex(config) {
	const res = await fetch('https://curiosa.io/codex');
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const html = await res.text();
	const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
	if (!match) throw new Error('__NEXT_DATA__ not found on Codex page — site structure may have changed');
	const nextData = JSON.parse(match[1]);
	const raw = nextData?.props?.pageProps?.trpcState?.json?.queries?.[0]?.state?.data;
	if (!Array.isArray(raw)) throw new Error('Codex entries missing from page data');

	// Build subcodex lookup: lowercased title → { parentTitle, subTitle }
	const subcodexMap = new Map();
	for (const e of raw) {
		for (const s of (e.subcodexes || [])) {
			if (s.title) subcodexMap.set(s.title.toLowerCase(), { parentTitle: e.title, subTitle: s.title });
		}
	}

	// Also track all top-level titles for link resolution
	const topLevelTitles = new Set(raw.map(e => e.title.toLowerCase()));

	function resolveLink(title) {
		const lower = title.toLowerCase();
		const sub = subcodexMap.get(lower);
		if (sub) return `[[${sub.parentTitle}#${sub.subTitle}|${title}]]`;
		return `[[${title}]]`;
	}

	const entries = raw.map(e => {
		const entry = {
			title: e.title,
			finder: e.finder || '',
			content: parseContent(e.content, resolveLink),
		};
		if (e.subcodexes?.length) {
			entry.subcodexes = e.subcodexes.map(s => ({
				title: s.title || '',
				content: parseContent(s.content, resolveLink),
			}));
		}
		return entry;
	}).sort((a, b) => a.title.localeCompare(b.title));

	// Write codex-scraped.json
	const jsonPath = S.vaultPath(config, `${config.dataDir}/codex-scraped.json`);
	await app.vault.adapter.write(jsonPath, JSON.stringify(entries, null, 2) + '\n');
	globalThis.__sorceryCodexData = null;
	globalThis.__sorceryCodexTextMap = null;
	globalThis.__sorceryCodexLookup = null;

	// Write individual codex/*.md files
	const codexDir = S.vaultPath(config, 'codex');
	try { await app.vault.adapter.mkdir(codexDir); } catch {}

	for (const entry of entries) {
		const safeName = entry.title.replace(/[\\/:*?"<>|]/g, '-');
		const filePath = `${codexDir}/${safeName}.md`;
		await app.vault.adapter.write(filePath, entryToNote(entry));
	}

	return { entryCount: entries.length };
}

async function start(_params) {
	S = await loadShared();
	const config = await S.loadConfig();

	new Notice('Scraping curiosa.io…', 3000);

	let faqResult, codexResult;
	const errors = [];

	try {
		faqResult = await scrapeFaqs(config);
	} catch (err) {
		errors.push(`FAQs: ${err.message}`);
	}

	try {
		codexResult = await scrapeCodex(config);
	} catch (err) {
		errors.push(`Codex: ${err.message}`);
	}

	if (errors.length) {
		new Notice(`Scrape errors:\n${errors.join('\n')}`, 10000);
	}

	const parts = [];
	if (faqResult)   parts.push(`${faqResult.faqCount} FAQs across ${faqResult.cardCount} cards`);
	if (codexResult) parts.push(`${codexResult.entryCount} codex entries`);

	if (parts.length) {
		const msg = `Scraped: ${parts.join(', ')}`;
		await S.logAction(config, msg);
		new Notice(msg, 5000);
	}
}
