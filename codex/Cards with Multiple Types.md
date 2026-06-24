---
kind: sorcery-codex
cssclasses: [sorcery-codex]
title: "Cards with Multiple Types"
finder: ""
---

It's possible for cards to have multiple types. For example, automatons are minions and artifacts.

It's also possible for cards to gain types during the game. For example, [[Enchantress]] can cause auras to gain the minion type for a turn.

When a card has multiple types, apply the following rules regarding characteristics:

- The **default size remains unchanged**.

   - If the card was already occupying multiple locations (e.g. an aura) and becomes a minion (e.g. via [[Enchantress]]), it continues to occupy multiple locations even though minions default to a single location.

- For everything other than size, the **characteristics of a minion take precedence**. For example:

   - Artifacts can be carried, while minions cannot be carried by default. Therefore, artifact minions cannot be carried as an artifact would be, since we give preference to the minion rules.

      - Note that artifact minions *can* be carried as a minion would be carried (e.g. [[War Horse]]).

   - Auras cannot carry artifacts. Minions can carry artifacts. Therefore, Aura minions can carry artifacts, since we give preference to the minion rules.
