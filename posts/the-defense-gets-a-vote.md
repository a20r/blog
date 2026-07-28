---
topics: [quant, soccer, prediction-markets, stochastic-processes, rust, calibration]
# Part 3 of the Kalshi basket series — sorts after the momentum-field post.
date: 2026-07-28T15:00:00Z
series: Kalshi basket
seriesPart: 3
summary: "The momentum field's four roadmap items, delivered: a defender decision model that chooses what to deny, per-player skill fitted from tracking alone, a multi-goal outcome law that prices matches before the 80th minute, and the C.6 calibration gate — which still, correctly, says no."
---

# The Defense Gets a Vote: Defender Decisions, Player Skill, the Multi-Goal Law, and a Gate That Can Say No

*Part 3 of 3. [Part 1](/posts/capitulation-basket/) is the trading strategy; [Part 2](/posts/a-momentum-field-for-soccer/) is the momentum-field model that computes the strategy's one missing input. Part 2 ended with a four-item roadmap — the defender decision model, per-player skill estimation, the multi-goal convolution, and C.6 calibration. This post is the delivery report: all four are now implemented in the kalshi-basket repo, with the tests that pin them and the honest accounting of what each one can and cannot yet claim. One of the four ends the only way it truthfully could, and that ending is the point of the whole framework.*

---

## 1. The debt list

Part 2 closed with a roadmap, and each item on it was a named hole in the model — not an aspiration, a documented defect:

1. **The defender decision model.** §7 of Part 2 made attacking play a *discrete decision process* — passes as value-steered jumps — and then §8 admitted that the defense still ran on a fixed script: man-mark your assigned attacker, goal-side, on a leash. The attack chooses; the defense obeys. That asymmetry is wrong, and it biases everything the evolved player configurations feed (jump tables, lane races, the game-view PDF).
2. **Per-player skill.** The pass-completion model carries $s_{\text{passer}} \cdot s_{\text{receiver}}$ multipliers — "some players suck at passing or trapping" as a first-class parameter — that have defaulted to $1$ since the day they were written, because nothing estimated them.
3. **The multi-goal convolution.** The fair-value three-vector $\{P(A), P(D), P(B)\}$ was *next-goal-decisive*: it treats the next goal as settling the match. Good late, wrong early, and the post said so explicitly — "the rigorous fix is the full multi-goal convolution, which is on the roadmap, not in v1."
4. **C.6 calibration.** The gate that decides whether any of this may price a dollar. Every output in the pipeline ships stamped `calibrated: false`, and Part 2 was blunt that the *statistical* claim — "these intensities are calibrated goal probabilities" — was not yet earned.

Four debts. Here is how each was paid, in the order they compound.

## 2. The defense gets a vote

The attacker's decision layer chooses **where the ball goes**: a softmax over pass options, each weighted by completion probability and the *value gained* at the target. The defensive mirror, now in `defend.rs`, chooses **what each defender denies**. Every defender holds a discrete option set:

- **Man-mark** — deny the assigned attacker's receiving spot (their lead position, goal-side).
- **Zone** — hold the shape. This is the softmax *anchor*: a fixed utility $\theta_{\text{zone}}$ that any specialised action must beat before a defender abandons position.
- **Lane-block** — interpose on the carrier's most valuable pass option.
- **Press** — close down the carrier and deny the ball itself.
- **Cover** — drop goal-side and deny the space in front of goal. The goalkeeper *is* this action, permanently — goal-defense is the keeper's decision.

The choice policy is the same functional form as the attack's, because the units are the same: **threat denied**, measured on the attack's own value surface $V(x)$ (the Bellman surface from Part 2 §7; positional finishing danger as the surface-free fallback). The utilities are worth writing out, because each one is a small modeling statement:

$$
\begin{aligned}
u_{\text{mark}} &= \theta_{\text{mark}} \cdot \tfrac{V(x_{\text{lead}})}{v^*} \cdot R(t_{\text{reach}}), \qquad
u_{\text{zone}} = \theta_{\text{zone}}, \\
u_{\text{lane}} &= \theta_{\text{lane}} \cdot \tfrac{q_r\, c_r\, V(x_r^\star)}{v^*} \cdot R(t_{\text{reach}}) \cdot \kappa_{\text{claim}}, \\
u_{\text{press}} &= \theta_{\text{press}} \cdot \tfrac{V(x_{\text{ball}}) + \tfrac12 \sum_r q_r c_r V(x_r^\star)}{v^*} \cdot R(t_{\text{reach}}) \cdot \kappa_{\text{claim}}, \\
u_{\text{cover}} &= \theta_{\text{cover}} \cdot \tfrac{V(x_{\text{cover}})}{v^*} \cdot \tfrac{R(t_{\text{reach}})}{1 + \text{occupied}} \cdot \kappa_{\text{claim}}.
\end{aligned}
$$

The pieces: $R(t) = e^{-(t - t_{\text{react}})/\theta_{\text{replan}}}$ is the **reach discount** — a threat you cannot arrive at in time is not a threat you can deny, and the reaction time is subtracted because it is common to every option (the discount contrasts *chases*, not reflexes). The lane utility is the ball model's own accounting of a lane — $q_r c_r V(x_r^\star)$ is exactly the expected threat a release moves through it, with $q_r$ and $c_r$ the same choice and completion probabilities the transport model jumps along. The press utility carries the on-ball threat *plus half the optioned threat*, because pressing degrades the whole tree behind the ball — the pass model's own pressure terms say precisely this. And the softmax over these utilities, at temperature $\theta_{\text{temp}}$, is the policy.

$\kappa_{\text{claim}}$ is the piece I did not plan and the simulation demanded. Decisions were initially simultaneous and independent, and the very first smoke test produced a defense in which **all six defenders chose cover at once** — each one independently discovering that the box was the most valuable empty space on the pitch, none of them knowing the other five had discovered it too. It is the same stampede the marking assignment solved in Part 2 (naive nearest-marking sent the whole defense to one striker), and it gets the same medicine: decisions are **sequential, nearest-to-ball first**, and every decided target becomes a *claim* that discounts later utilities on the same ground, $\kappa_{\text{claim}} = 1/(1 + \sum_j e^{-d_j^2/2\sigma^2})$. The keeper's anchor is a standing claim, which is why nobody else ever decides to stand in the six-yard box. Coordination failures in multi-agent softmaxes are not exotic; they are the default, and the greedy-sequential fix is three lines.

![The defender decision layer under the prior θ](/images/the-defense-gets-a-vote/decisions_prior.svg)
*One broken-shape state (a runner has beaten the line, cyan dashed lanes are the carrier's options), decided under the prior θ: the on-ball defender presses (pink), a near back makes the long recovery run to cover (violet), two defenders man-mark (red), the far back holds zone, the keeper anchors.*

![The same state under a lane-denying θ](/images/the-defense-gets-a-vote/decisions_lane.svg)
*The same state, decided under a lane-denying scheme ($\theta_{\text{lane}}$ raised, cover cheapened): two bodies collapse onto the carrier→runner diagonal (yellow). The defensive scheme is a parameter vector now — same machinery, different team.*

Two findings from building it, both of which I believe more than I expected to:

**Marked receivers are dead lanes.** I spent a while constructing a scenario where lane-blocking would be the obvious choice, and the model kept refusing — because the moment a defender stands goal-side of a runner, the lane race collapses that option's completion $c_r$, which collapses its choice probability $q_r$, which collapses the lane's value $q_r c_r V$. The model was telling me something true: you don't block the lane to a marked man, because *the mark already blocked it*. Lane-blocking earns its place in broken shapes — a runner nobody owns, a recovering defender who can reach the diagonal — which is exactly where real defenses spring offside traps and covering interceptions. Under the prior θ it is correctly the *rare* choice.

**Pressing beats lane-blocking for the on-ball defender because of the option tree, not the ball.** The threat *at* the ball 27 metres out is small. What makes pressing dominant for the nearest defender is the $\tfrac12 \sum q c V$ term — closing down the carrier degrades every downstream option at once. Without that term the model produced defenders who ball-watched from two metres away while "blocking" lanes that ran right through their feet.

The layer is wired into the shared forward player simulation (`simulate.rs` — extracted from the browser-only code and natively tested now), re-planned every $\theta_{\text{replan}}$ seconds, with the acceptance A/B pinned as a unit test: against a shape-pinned defense, the decided defense **closes down the carrier and the interaction model prices it** — pressure at the ball up, clean shot generation down, finishing down. The θ grew from 49 to 56 entries, appended so a fitted 49-value file from the old build stages as a prefix and the new entries keep their defaults. The seven `def_*` weights ship as priors: the decision layer is *fittable by construction* — every weight is a named scalar, the same inverse-game coordinate descent that recovered the marking weight applies — but no defensive-scheme fit has run yet, and I am not going to pretend otherwise.

## 3. Names on the skill hooks

The pass model multiplies completion by $s_{\text{passer}} \cdot s_{\text{receiver}}$, clamped to $[0.2, 1.5]$, defaulting to $1$. The estimator that fills them in, `skill.rs`, needed two things: **events** and **identity**. It gets both from tracking alone.

**Events.** A pass is harvested as: an upward crossing of the ball's speed through the kick threshold (the same 9 m/s detector as Part 2's release-rate fit, on raw consecutive step velocities — the glitch-cap lesson from §6 still applies); a flight chased until the speed settles or the possession run dies; and the run structure itself as the outcome label. A run that dies inside the flight window *is* a failed pass — that is what a turnover-by-pass looks like in this export. Passer = nearest in-possession player at release; receiver = nearest at settle. No event feed, no labels bought.

**Identity.** The subtle one. The crate's CSV schema labels players by *role* — team 0 is whoever possesses — and the DFL export flips that per possession run, so "team 0, third player" is not a person. But the export's entity labels (`p0`…`p21`) *are* stable physical ids; the loader just used to throw them away. `frame::Player` now carries a `pid`, and the whole estimation keys on it. Exports without identity yield zero events, loudly, rather than a table of confident nonsense about nobody in particular.

**The estimator** is a shrunk method-of-moments fixed point on the model the transport already uses. With $\hat c_e$ the *model's own* lane-race completion for event $e$ at skills $\equiv 1$:

$$
s_i \;\leftarrow\; \frac{n_0 + \sum_{e \ni i} y_e}{\,n_0 + \sum_{e \ni i} \hat c_e \, s_{\text{other}(e)}\,},
$$

alternated over players until stable — observed completions over expected completions, with $n_0$ pseudo-events of prior mass so a player with no data sits at exactly $1$ and data moves them only as far as it earns. The final table is pinned so the **median** well-sampled player is $1.0$: a mean pin lets one genuinely bad player drag the whole squad's scale (found immediately by the recovery test — the butcher pulled everyone else up to 1.27), and a median doesn't move. Model-level completion bias also cannot leak in: if $\hat c$ is globally miscalibrated, the pin absorbs it instead of the players.

![Skill recovery on scripted tracking](/images/the-defense-gets-a-vote/skills_recovery.svg)
*The recovery test the CLI runs end-to-end: five identified passers, 30 passes each, outcomes scripted (the estimator sees only tracking). The 40%-completion butcher lands lowest, the 95% metronome highest, the three identical mid players cluster near 1. The scale is compressed — shrinkage plus pooled pass/trap roles — and that is the honest resolution: one match of data earns an ordering, not a magnitude.*

`fit --skills skills.json` writes the table; `mu --coupled --skills skills.json` stamps it onto the live state, where it flows into lane races, jump tables, turnover hazards — everywhere completion matters. On thirty passes a player the shrinkage keeps every multiplier close to 1, which is correct: the hook exists so that a *season* of a player's passes means something, not so that one bad half convicts anyone.

## 4. Beyond the next goal

The three-vector from Parts 1–2 is next-goal-decisive: $P(A) \approx \int \lambda_A S$, $P(D) \approx S(T)$, treating the next goal as final. From a tied 85th minute that is nearly true. From the 55th it is badly false — an equaliser conceded is not a loss — and the strategy's own §10 skew inequality was quietly consuming a window-unconditional 18.7% because nothing minute-conditional and *score-state-aware* existed.

The convolution, `convolve.rs`, composes the full terminal law with a structure that matches exactly what the model knows:

- **While no goal has arrived**, goals hazard at the state-conditioned conditional intensities $\lambda_g(s)$ — the coupled propagation's first-goal law, used precisely as computed (those λ's are conditional on no goal yet; that *is* the DP's no-goal branch).
- **After any goal**, the current configuration is dead information — the match restarts from a kickoff we know nothing about — so subsequent goals arrive at the **neutral marginal rates**: the same coupled pipeline run with the configuration-memory weight collapsed to zero. This is not a new assumption; it is the τ_state relaxation the field already commits to, applied at the goal boundary.

Mechanically it is an exact dynamic program on the (score difference, any-goal flag) lattice: mass is conserved to machine precision, the cap is irrelevant to the outcome probabilities (edge mass keeps its sign), and both regime claims are unit tests — agreement with next-goal-decisive within 1% at 88′, material divergence at 55′.

![Multi-goal vs next-goal-decisive across entry minutes](/images/the-defense-gets-a-vote/multigoal_vs_minute.svg)
*The same tied live state and the same conditional intensities, composed both ways, for every entry minute from 45′ to 88′. Next-goal-decisive (dashed) overprices the favoured side by 15.5 points at 45′ — it books the first goal as final and never gives the equaliser its channel — while the draw is symmetrically underpriced (a draw is not just 0–0; it is 1–1 and 2–2). By 88′ the two laws agree to a couple of points, which is why Part 1's late-game math was never wrong to use the simple form.*

What this buys the strategy is concrete. Part 1's §10 subsidised-upside engine prices a tail iff $P(\text{side wins from here}) > p$, and flagged its own input as "asserted, not proven" — window-unconditional, score-blind. The convolution gives that inequality a minute-conditional, score-state-conditional left-hand side *with the correct structure*: from $-1$ down at 70′, from level at 55′, from $+1$ up at 85′, each its own law. Class B and Class C setups — leads and deficits — become priceable objects instead of footnotes. Structure, not yet calibrated truth: the numbers inherit `calibrated: false` from the intensities underneath, and the post-goal rates are score-blind (no parked bus, no desperation surge) until a real corpus exists to fit those effects. The DP is exact; its inputs are still the model's.

## 5. The gate that can say no

The last roadmap item is the one that cannot be finessed. C.6 says: before the computed λ prices a dollar, it must — out-of-sample, at match level, pre-registered — be reliable, score well on proper rules, and at least match the de-vigged market on held-out matches. `calibrate.rs` is that judge, implemented so it can actually rule:

- **The corpus format** is one CSV row per evaluated snapshot — `match_id, minute, model three-vector, de-vigged market three-vector, realised outcome` — and **matches are the independent unit** everywhere: per-match score aggregation, match-level bootstrap. Snapshots within a match share an outcome; treating them as independent is how you fake significance.
- **Reliability** is pooled over all three outcome probabilities into ten bins with an ECE threshold; **proper scores** are multiclass Brier and log-loss, required to beat the corpus base-rate reference (predicting the outcome frequencies is the floor below which no model deserves a verdict).
- **The market benchmark** is an *equivalence test*, and this took actual thought: "at least match the market" cannot mean "bootstrap CI of (model − market) strictly below zero," because a model exactly as good as the market straddles zero half the time and would fail forever. The criterion is that the upper CI limit sit within a practical-equivalence band (0.002 Brier — far below any tradeable edge). Demonstrably not-worse, with the burden of proof on the model, small samples widening the CI and making the bar *harder* — the statistics lean the safe way.
- **A PASS emits a certificate** bound to a hash of the exact corpus it was earned on, and `mu --certificate` is the *only* code path in the repo that flips `calibrated: true`. A FAIL certificate never certifies. There is no argument to a function anywhere that sets the flag by assertion.

You cannot validate a model without a corpus, but you *can* validate the judge, and that is what ships: `calibrate --selftest` generates synthetic corpora where the verdict is known by construction — a truth-reporting model that deserves to pass, an overconfident model, a noisy model that loses to the market — and requires the gate to rule correctly on all three, with the right reasons on the failures.

![Reliability of the model that deserves to pass](/images/the-defense-gets-a-vote/reliability_pass.svg)
*The self-test's truth-reporting model: pooled reliability hugs the diagonal (bubble area = bin mass), ECE 0.022, and the gate passes it.*

![Reliability of the overconfident model](/images/the-defense-gets-a-vote/reliability_overconfident.svg)
*The same judge on the sharpened model: the classic overconfidence rotation off the diagonal, ECE 0.167, failed for reliability, the base-rate floor, and the market bar at once — each failure named in the report.*

And the verdict on the real model, which is the ending Part 2 promised in advance: **there is no verdict, because there is no corpus.** One tracked match fits transport physics — drift, volatility, release rates, even a skill ordering — but it cannot calibrate a hazard, and no amount of machinery changes that. So the gate stands built and armed, the certificate file does not exist, every output still says `calibrated: false`, the manual hazard gate keeps its override, and the crossover rule runs on the base rate. The framework's first design principle is that the best output is often *no trade*; the calibration gate's first output is *no verdict*. Both are the system working.

## 6. The scoreboard

Where the four debts stand, in the ledger's own style:

| roadmap item | delivered | still owed |
|---|---|---|
| defender decisions | the five-action softmax over threat denied; sequential claims; sim integration; A/B-tested hazard coupling | fitting the `def_*` scheme weights to real tracking (they ship as priors) |
| per-player skill | tracking-only pass harvesting; pid identity through the schema; shrunk fixed-point fit; recovery-tested | a multi-match corpus before the multipliers mean people, not noise |
| multi-goal law | exact score-lattice DP; both regime claims unit-tested; wired to the CLI, core, and deck | score-state-conditioned post-goal rates (bus-parking is real and unmodelled) |
| C.6 gate | the full judge: reliability, proper scores, market equivalence, certificates; self-tested in both directions | the corpus. Everything is the corpus. |

The through-line is the same discipline the series started with. Part 1 was a strategy built out of refusals; Part 2 was a model that labeled every uncalibrated number as uncalibrated; Part 3's biggest deliverable is a piece of software whose entire job is to keep saying *no* until the data says otherwise — and which, on the day it can finally rule, will already know exactly what evidence would change its mind. The defense gets a vote now. So does the judge.

---

*All four implementations, their tests (33 new; the workspace suite and the wasm build stay green), the CLI subcommands (`decisions`, `calibrate`, `fit --skills`, `mu --multigoal`), and the figures in this post live in the kalshi-basket repo's `momentum-field` crate. [Part 1](/posts/capitulation-basket/) covers the trading framework, [Part 2](/posts/a-momentum-field-for-soccer/) the field model both of these posts stand on.*
