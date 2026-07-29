---
permalink: false
eleventyExcludeFromCollections: true
---
# The civilization gradient — essay changelog

The essay's single source of truth is the post beside this file,
`posts/the-civilization-gradient.md` (migrated from a20r/civgrad's
`essay/` on 2026-07-28; the civgrad repo hosts the model, data, and audits,
and its site links here). The essay stays versioned like civgrad's
METHODOLOGY.md: bump the version in the post intro, add a line here, and
keep the essay's claims consistent with the scorecard and audits at that
version. This file is not rendered on the site.

- **v0.1** — scaffold: eight section stubs (2–4 sentences each, sources named,
  no prose), demo embedded between §5 and §6, scorecard mirror in §7,
  design-history footer with the interim transcript link.
- **v0.2** — first full draft: all eight sections written to the v0.1 stub
  contracts; numbers sourced from validation/baseline_outputs.txt and
  SCORECARD.md (shipping gradient −2.68/−1.63, boneyard 0.85 vs 0.70,
  Sumitomo v1 57.6%/never, α=0.06); Hunt–Lipo caveat, busy-futility
  livelock, five-failures narrative, and pessimism-bias caveat included.
- **v0.2.x (blog-side, unversioned at the time)** — the essay's canonical
  home moved to the blog (a20r/blog PRs #5–#9): §2 citations added, Anasazi
  framing dropped, a formal machinery section (§3) and a method reflection
  (§9) added there, and sensitivity/price-experiment numbers quoted from an
  analysis whose repo artifacts had not yet landed. Recorded here
  retroactively; the repo copy stayed at the 8-section structure.
- **v0.3** — audited numbers + the policy section, both copies: the §5
  sensitivity parenthetical and boneyard passage now quote the committed,
  reproducible audit (SENSITIVITY.md: big negative signs 85–92% under
  parameter fog, 100% under prior fog; partition 91–99%; worn-on-top a
  minority); the §7 Sumitomo passage corrected to the *measured* trap
  anatomy (input-masking in the restoration signal, not tool-fleet wear;
  KNOWN_ISSUES #10) and now cites the structural-miss result (95% of 500
  draws) and the price experiment (margin restoration → ~10 mo recovery;
  gradient-as-price → total collapse); new §8 "The marginal dollar, cashed
  out" condensing POLICY.md; old §8 renumbered §9 with its scope line
  updated. Header notes the blog as the canonical fullest copy.
- **v0.4** — the audit and the conclusion, in full: the essay absorbs the
  evidence it previously linked out to — the 500-draw audit summary, the
  buffer-rule table, both robust marginal-value tables, the mean-vs-tail
  comparison, and the price experiment's two result tables now sit inline
  in §8/§9, styled on the site theme. Includes the sign-label fix (strict
  directional fractions; exactly-zero gradients support neither sign) and
  the Tōhoku deficit correction (measured 1.0/0.6 month-equivalents, not
  the design-session "~0.3"). The generated POLICY.md / SENSITIVITY.md /
  PRICE_EXPERIMENT.md in civgrad remain the regenerable sources of every
  number.
- **v0.4 (addendum)** — source of truth moved to this repo: a20r/civgrad
  dropped its `essay/` copy (its renderer could not carry the tables and
  the two-copy setup had already produced one real drift bug — the ~0.3
  Tōhoku deficit), its project site now hosts the live model only and
  links here, and this changelog moved alongside the post.
- **v0.5** — flow and editorial revision, on Alex's notes: §5 no longer leans on
  machinery the reader hasn't met (the dead-end check is grounded in §4's
  discrete net, the Zeiss discovery tied back to §2's tour) and closes by
  signposting that everything downstream is fog-conditional; §6's audit
  parenthetical shrinks to a plain promise, with the numbers and the full
  protocol moved to §9 where the table lives; §3 plants the confidence-C
  grading early; §8's structural-miss result is labeled as §9's
  machinery; §11's origin line reframed. A fresh-reader review pass then
  caught three more: §6 no longer re-derives §3's relaxation as if new,
  photoresist 2019 gets its one-clause introduction in §8 (the only
  scored event that had none), and §9's "honest caveat" hedging label is
  gone. A full editorial pass in The Economist's register followed, at
  Alex's direction: throat-clears out ("Here's the thing", "I should
  state it honestly", "Worth savoring"), questions stated plainly (the
  §11 origin line asks the essay's actual question), emphasis carried by
  construction rather than typography (pure-stress bolds dropped; coined
  terms keep theirs), the un-introduced "SPOFs" jargon replaced, the
  §3/§11 confidence-C statements reconciled, and sentences shortened
  throughout. No number, table, or result changed.
