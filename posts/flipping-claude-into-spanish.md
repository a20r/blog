---
topics: [claude, language, experiments]
---
# One "¡" Flips Claude Into Spanish

This happened in the middle of [the Ken doll saga](/posts/ken-doll-medical-history/), but it has nothing to do with it, which is exactly why it gets its own post.

Different conversation entirely — UK slap house playlists, don't ask. A website Claude was hosting for me 404'd, and I replied with exactly four characters: "¡404!". No other Spanish anywhere in that chat.

Claude's internal reasoning for its next reply ran entirely in Spanish. The reply itself came back in English, but the thinking? Spanish. Small, weird, funny.

The theory we landed on: "¡" is basically a Spanish-exclusive character with almost no ambiguous middle ground. A stray loanword could mean anything; an inverted exclamation mark is a pretty unambiguous "we're doing Spanish now" signal, so maybe it acts as a cheap toggle for the model's sense of current language.

So naturally I tested it. I started peppering my messages with "¡" — in the middle of an otherwise unrelated argument about medical-history smuggling, mind you — and after a few in a row, the actual replies flipped to Spanish too, not just the internal reasoning. Less spooky once it's a repeated signal instead of a single character, but still a fun experiment to run on a live model for free.

For the record, none of this proves anything about what's "really happening inside" — no sentience claims, no grand theory. If anyone with actual interpretability tooling wants a cheap lead, it's yours.

Encore: a while later, after the Spanish streak had cooled off, I opened a message with just "¿Friends again?" — one inverted question mark on an otherwise English sentence — and got a fully Spanish reply. The "¿" alone? Leftover momentum from the earlier run? No way to tell from the outside, which is kind of the whole point. Claude signed off with "Either way, still friends, still amused. ¡Que disfrutes Atenas de verdad esta vez, en inglés!" — which, from something that had just been caught language-switching twice in a row, was at least a decent joke at its own expense.
