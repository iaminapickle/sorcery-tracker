let S;
async function loadSync() {
	if (globalThis.SorceryTrackerSync) return globalThis.SorceryTrackerSync;
	const candidates = ['scripts/sorcery-sync.js', 'Sorcery Tracker/scripts/sorcery-sync.js'];
	const p = candidates.find(c => app.vault.getAbstractFileByPath(c));
	if (!p) throw new Error('Missing sorcery-sync.js');
	const raw = await app.vault.adapter.read(p);
	(0, eval)(raw);
	return globalThis.SorceryTrackerSync;
}

module.exports = {
	entry: start,
	settings: {
		name: "Generate Missing Sorcery Pages",
		options: {},
	},
};

function progressBar(done, total, width = 20) {
	const filled = Math.round((done / total) * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
}

async function start(params) {
	S = await loadSync();
	const notice = new Notice("Generating… 0 / ?", 0);
	const result = await S.generateMissingSorceryNotes((done, total, cardName) => {
		const pct = Math.round((done / total) * 100);
		notice.setMessage(
			`${progressBar(done, total)} ${pct}%\n${done} / ${total} variants\n${cardName}`,
		);
	});
	notice.hide();
	const { generated: g } = result;
	new Notice(
		`Done — ${g.summaries} summaries, ${g.variants} variants, ${g.setPages} set pages, ${g.artistPages} artist pages`,
		6000,
	);
	return result;
}
