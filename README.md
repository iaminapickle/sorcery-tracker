

# Sorcery Tracker

An Obsidian vault for tracking a [Sorcery: Contested Realm](https://sorcerytcg.com) collection. This vault features tracking your collection split up into different storage (binders & boxes), a deck builder, a set completion page, artist pages and Curiosa FAQ + Codex rulings.

## Disclaimer

There are several drawbacks to using this as your Sorcery collection.
- Obsidian is mainly a local note-taking application. There is a paid subscription to sync between devices but if you want to use this, I recommend setting up [Syncthing](https://syncthing.net/) to sync. 

- All card art is stored locally, making this vault relatively large (roughly ~700Mb). This makes the initial load a bit slower than I'd like on mobile (and possibly very old computers). This also makes using Git with it a huge pain, even with LFS.
    - There is a script `/scripts/recompress-art.py` that will recompress the images into a desired quality. By default, they are Q80 JPGs.

- The mobile experience may not be perfect.

- I am an Android/Windows/Linux user and so support for other platforms or form factors may be limited.

- There is no Curio support. This is mainly because I could not find standardised high resolution images for them.

## Sources of Truth

This entire vault draws from three offical sources of truth. 
1. The official [Sorcery API](https://api.sorcerytcg.com/), which provides all the raw metadata about the cards.
2. The official [Sorcery Image Drive](https://drive.google.com/drive/folders/17IrJkRGmIU9fDSTU2JQEU9JlFzb5liLJ?usp=drive_link), which provides all the images.
3. The official [Curiosa.io](https://curiosa.io/), which provide the Codex and FAQ entries.
    - Compared to the other two, this is scraped data from site endpoints.
---

## Setup

1. Open the vault in Obsidian.
2. Trust and enable the plugins when prompted (all plugins, settings, and data are already committed).

### Optional:
If you want to use this vault, I suggest making your own branch from main and storing your collection there. When it comes time to update, you can pull from `main` and then rebase.

If you want to import your existing collection from [Curiosa.io](https://curiosa.io/), download the `csv` and run `Cmd/Ctrl+P` → `Import Curiosa Collection`

> If there are any bugs, the first thing to try is to reopen or reload with (`Cmd/Ctrl+P` → `Reload app without saving`).

> If cards render blank, check that `data/config.json` has the correct `vaultRoot` (leave empty if the vault is opened directly, not as a subfolder).

### Optional: tame git churn from Manual Sorting

The Manual Sorting plugin stores a custom order for **every** folder in `.obsidian/plugins/manual-sorting/data.json`, so re-sorts and normal use rewrite thousands of lines you don't care about. Only the top-level page order matters for the repo. A one-time, per-clone git config keeps just that and ignores the rest:

```sh
git config filter.sortorder.clean "python3 scripts/filter-sort-order.py"
```

The `filter=sortorder` rule is already committed in `.gitattributes`. After setting the config, the script strips the per-folder orderings before git sees the file, so plugin churn produces no diffs. Your working copy keeps full data; the plugin regenerates per-folder order on launch.

---

## Main pages

| Page | Description |
|---|---|
| `Collection.md` | Dashboard to manage your entire collection |
| `Decks.md` | Dashboard to manage your decks |
| `Storage.md` | Dashboard to manage individual storage & set progress |
| `Artists.md` | Dashboard to view artist cards |
| `Codex.md` | Rulings from [Curiosa.io Codex](https://curiosa.io/codex) |

---

## Collection

This page is the dashboard for viewing your entire collection. By default, it is set to only show Standard cards that you own but with the search widget, you can filter it as you please. The search bar will search through both name and card text. There are filters for; sets, types, rarities, costs, elements, finish, subtypes and keywords.

> For all of these display pages, the order of sorting is Avatar -> Artifact -> Aura -> Minion -> Magic -> Site, then by rarity and then alphabetical. "Other" cards (tokens + Rubble) are appended to the very end. Some cards ignore this sorting and are purposefully grouped together. Currently only {Druid, Bruin and Tawny} have this behaviour.

![Collections Page](/assets/readme/Collection-readme.png)

## Storage

This page is the dashboard for managing your collection. A collection is a set of storage, either binders or boxes. There's no functional difference between the two except that binders have a limited number of slots. Here is also where you access the Set pages.
    - Storage can be exported to a `csv` and also imported.

> The images for the Set pages can be easily changed in `assets/sets` as long as they maintain their name. They should be cropped square but you can choose any artwork you like if you are disatisfied with my personal favourites. I suggest [Collector Arthouse](https://www.collectorarthouse.com/sorcery-art) for images.

<img src="/assets/readme/Storage-readme.png" width="49%"> <img src="/assets/readme/Storage-individual-readme.png" width="49%">

## Set 

These pages are for tracking your progress for your collection in regards to set. There are several toggles. 
- The Base Set will track if you have at least 1 copy of each card in a set. 
- The Play Set will track if you have at least `playable` copy of each card (e.g. 4 for Ordinary).
- The Base Rows will display the order you should put cards in for a Base Set binder. 
    - You add a binder to track this. If a card is in this binder, the cell will turn green. If a card is owned but not in a tracked binder, the cell will turn yellow.
    - Special cards are unnamed cards prepended to the front. For me, these are the artist credit and rule cards.
- The Play Rows are the same as the Base Rows but following Play Set counts instead. There is an extra toggle for `Padding`, which can try to keep neat rows in exchange for having blank slots.
    - `Align` will try to keep rows neat but only for clean numbers (i.e. with 4 slots per row, 1x4 Uniques, 2x2 Elites or 1x4 Ordinary)
    - `No Splits` will ensure all copies of a card are on the same row.
    - Same binder tracking behaviour as Base Rows.

<img src="/assets/readme/Set-Play-readme.png" width="49%"> <img src="/assets/readme/Set-Play-Rows-readme.png" width="49%">

## Individual Cards

There is a separate page for every indvidual card in the game that you can access by clicking card names. There is a dropdown to allow you to view every variant of a card. A variant is a different copy of the same card; for example, `Persecutor` has two artworks and while they are overall still `Persecutor`, you could own copies of one but not the other. The card page will contain the card FAQs from [Curiosa.io](https://curiosa.io).

![FotFO Overall](/assets/readme/Card-readme.png)

## Decks

This is a dashboard for managing your decks. The individual deck page will display all the cards sorted by cost then alphabetical. It will also have some simple statistics related to curve, threshold requirements and Atlas coverage.
    - Decks can be exported to a `csv` and also imported.

![Deck Individual](/assets/readme/Deck-readme.png)

## Artists

This is a dashboard for seeing the bodies of work that an artist has contributed. The images shown are picked randomly from a card they have made.

![Artists Dashboard](/assets/readme/Artists-readme.png)

## Codex

This is an offline version of all the [Curiosa.io Codex](https://curiosa.io/codex) pages. Searching will return exact title matches first and then matches in the body of text.

![Codex](/assets/readme/Codex-readme.png)

## Optional: Updating when a new set releases

> Generally, a commit will be made on `main` when a new set is released so this is optional.

When a new set comes out, run the **Sync New Set** macro (`Cmd/Ctrl+P` → `Sync New Set`). It pulls the latest data from the official Sorcery API and regenerates everything in one go, showing a single progress notice through five steps:

1. **Fetch** the latest card data from the Sorcery API
2. **Rebuild** the set checklists (`set-manifests.json`)
3. **Scrape** the latest FAQs and Codex from [Curiosa.io](https://curiosa.io)
4. **Generate** any missing card, set, and artist pages
5. **Re-alphabetise** the `cards/` and `artists/` folders

Each step is independent — if one fails, the rest still run and all errors are reported together at the end.

> **Card art is the only manual step.** From a terminal, run `python3 scripts/download-art.py` to pull new art from the official Google Drive (requires [`gdown`](https://github.com/wkentaro/gdown) and ImageMagick). It skips any art you already have.

If you only need one piece of the above, the individual macros still exist — e.g. **Refresh Sorcery API** (just re-fetch the card data), **Refresh Set Manifests**, **Scrape Curiosa**, or **Generate Missing Sorcery Notes**.

## Debug QuickAdd macros

Triggered from the command palette (`Cmd/Ctrl+P` and Search). These are intended to be debug commands that you should not have to interact with much. The only one that may be useful outside of strenous circumstances is `Print Log`, which will display the last 10 events (the latest 200 events are also in `data/logs.md`). If you forgot what the last card you added to your collection was, the logs will show you.

| Macro | What it does |
|---|---|
| **Import Curiosa Collection** | Import a CSV export from [Curiosa.io](https://curiosa.io/collection) into a box |
| **Export** | Export a storage, deck, or full collection to CSV |
| **Refresh Sorcery API** | Fetch the latest card data from the [Sorcery API](https://api.sorcerytcg.com/) |
| **Scrape Curiosa** | Refresh FAQ and Codex data from [Curiosa.io](https://curiosa.io) |
| **Refresh Set Manifests** | Rebuild set checklists after an API update |
| **Validate Sorcery API Sync** | Check all notes match the master card data |
| **Generate Missing Sorcery Notes** | Create any notes missing from the master data |
| **Sort Cards and Artists** | Re-alphabetise the `cards/` and `artists/` folders |
| **Print Log** | Show the last 10 actions in a popup |
