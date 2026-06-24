---
kind: sorcery-codex
cssclasses: [sorcery-codex]
title: "Moves Freely"
finder: "move freely,moves freely,moving freely"
---

A unit with Moves Freely spends no steps moving via the Move and Attack or Defend basic abilities, as long as the *starting and ending locations* of the step satisfy the Moves Freely condition.

*Moves Freely only applies to basic movement*, which is movement from the Move and Attack basic ability and the Defend basic ability.

A unit can combine free steps with regular steps, up to its movement limit. See the examples below for more details.

## Examples of Moves Freely

**Example 1**

<table class="sorcery-codex-grid">
<tr><td>w1</td><td>w2</td><td>A</td></tr><tr><td>B</td><td></td><td>w3</td></tr>
</table>

w1, w2, and w3 are water sites. A and B are land sites. [[Sir Pelleas]] starts underwater at w1. He can take 1 step normally with the Move and Attack ability, so he declares the following movement path:

1. w1 underwater -> w1 surface (0 steps, Moves Freely between water locations)

1. w1 surface -> w2 surface (still 0 steps)

1. w2 surface -> A surface (1 step)

Note that [[Sir Pelleas]] cannot simply teleport to w3; Moves Freely requires the unit to declare a movement path, and some of the steps in that path might be free.

**Example 2**

Same as above, but [[Sir Pelleas]] starts on the surface of B. He can declare this path:

1. B surface -> w1 surface (1 step)

1. w1 surface -> w1 underwater (0 steps)

1. w1 underwater -> w2 underwater (0 steps)

1. w2 underwater -> w2 surface (0 steps)

The last three steps are all free, because they are between two water locations, per the Moves Freely ability of [[Sir Pelleas]]. Note that [[Sir Pelleas]] couldn't then continue from w2 surface to A surface, because that's not a free step, and [[Sir Pelleas]] already used up his 1 step for his Move and Attack basic ability.
