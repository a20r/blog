---
topics: [quant, prediction-markets, kalshi, soccer, optimal-stopping, trading]
# Part 1 of the Kalshi basket series — timestamped before the momentum-field
# post so it sorts as the earlier entry.
date: 2026-07-27T09:00:00Z
---

# Late-Game Capitulation Basket Conversion: A Protocol for Three-Outcome Soccer Markets

*Part 1 of 2. This post documents the trading strategy I run on Kalshi's three-outcome soccer markets — the market model, the behavioral thesis, the payoff optimization, the entry gates, the optimal-stopping rule for when to lock, and the accounting protocol that keeps me honest about whether any of it works. It's synthesized from the project's internal design docs and a season of building tooling around them. [Part 2](/posts/a-momentum-field-for-soccer/) covers the momentum-field model that computes the one input this framework currently has to fake.*

---

## 1. The strategy is not a prediction

Kalshi lists three-outcome contracts on soccer matches: $\{A, D, B\}$ — Team A wins, draw, Team B wins — each YES paying \$1 on its outcome. The obvious way to trade these is to have an opinion about who wins. I don't do that, and the entire framework is built around *not* doing that.

The strategy in one sentence, the canonical framing from the design doc:

> **Wait for a late-game score-state shock to invalidate directional traders' original thesis, then use late time decay and slow emotional repricing to convert accumulated current-state carry into a bounded three-outcome payoff surface or subsidized late-goal upside.**

Every word is load-bearing. *Late-game*: the edge only exists in a narrow terminal window. *Shock*: an equalizer or red card that breaks somebody's thesis. *Slow emotional repricing*: the edge is behavioral, in the market's timing, not its direction. *Bounded*: the end state is a basket that profits in **every** outcome, not a bet that needs one. And the design principle that governs the tooling: **the correct output is usually NO TRADE.** This is an opportunistic structure that appears a few times a week across all listed matches, not a strategy you can force onto a game.

## 2. The market model

Contracts $i \in \{A, D, B\}$, quantities $q_i \ge 0$, and — critically — **executable** costs, not midpoints. Buying $q_i$ walks the visible ask book $(p_{i,1}, n_{i,1}), (p_{i,2}, n_{i,2}), \dots$:

$$
G_i(q_i) = \sum_\ell x_{i,\ell}\, p_{i,\ell}, \qquad \sum_\ell x_{i,\ell} = q_i,\; x_{i,\ell} \le n_{i,\ell},
$$

plus a fee function $F_i(q_i)$ (labeled *estimated* unless it comes from actual fills — fabricating precision about fees is a small lie that compounds). Total basis $C = \sum_i c_i(q_i)$. Terminal profit under outcome $j$ is $\Pi_j = q_j - C$, and the object the whole strategy optimizes is the **payoff floor**:

$$
\Pi_{\min} = \min(\Pi_A, \Pi_D, \Pi_B), \qquad
\begin{cases}
\Pi_{\min} \ge 0 & \text{fully bounded basket} \\
\Pi_{\min} > 0 & \text{strictly positive basket.}
\end{cases}
$$

Could you just buy all three at once? If $q_A = q_D = q_B = q$, the payout is $q$ in every state, so static arbitrage exists iff $q > c_A(q) + c_D(q) + c_B(q)$. After spread, depth, and fees, it essentially never does — markets aren't that broken. **The strategy is not static arbitrage.** The positive basket has to be *manufactured*, and the manufacturing input is time.

## 3. The dynamic edge: one leg bought in the past

The trick is that the three legs are not bought at the same time. Buy the draw at $t_0$ while the game is tied: $q_D = D$ at cost $C_D$. Wait. If the tie survives, two things happen to the price vector: the draw appreciates (with less time remaining, the current score-state is more likely to be the final one — $\partial d_t / \partial t > 0$ while tied), and the win tails compress. At $t_1$, buy the tails $q_A, q_B$ at the *compressed* prices. The basis is

$$
C = \underbrace{C_D}_{\text{historical}} + c_A(q_A) + c_B(q_B),
$$

and the historical part is the whole game. In one-contract terms: today's prices always satisfy $d_1 + a_1 + b_1 \approx 1$ (plus vig), so

$$
d_0 + a_1 + b_1 \;\approx\; 1 - (d_1 - d_0).
$$

If my draw basis is $d_0$ but the tails are priced against $d_1$, the full basket costs $1 - (d_1 - d_0)$ per contract against a guaranteed \$1 payout. **The surplus is exactly the draw carry $d_1 - d_0$**, net of spread, slippage, and fees. Nothing here requires being right about the match — it requires the tie to *survive from $t_0$ to $t_1$*. That reframing, from "who wins" to "does this state survive a window," is what makes the whole thing quantifiable, and it's why Part 2 of this series is an entire physics model of goal hazard.

![Idealized capitulation price paths](/images/capitulation-basket/capitulation-carry.svg)
*The anatomy of the trade. An equalizer at 71′ shocks the leader's win-share; anchored holders bleed it down slowly rather than repricing at once (§5); the draw carries upward while tied; the conversion window is where compressed tails + accumulated carry close a bounded basket.*

## 4. The geometry: what "converting" means

At conversion time, with draw position $(D, C_D)$ held, choose the win hedges by **worst-case optimization**:

$$
\max_{q_A,\, q_B} \;\; \min(D,\, q_A,\, q_B) - \big(C_D + c_A(q_A) + c_B(q_B)\big),
$$

searched over the actual book (asymmetric prices and depth mean the optimum isn't always $q_A = q_B$). The worked example from the design doc: hold $D = 100$ at $C_D = \$55$; late asks let you buy $q_A = 100$ for \$18 and $q_B = 100$ for \$17. Total basis \$90 against a certain \$100 payout:

$$
\Pi_A = \Pi_D = \Pi_B = 100 - 90 = +\$10, \qquad \Pi_{\min} = +\$10.
$$

Ten dollars in every world. The match can do whatever it wants now.

![Basket geometry before and after conversion](/images/capitulation-basket/basket-geometry.svg)
*The conversion in payoff space: a naked draw leg (left) has catastrophic outcome risk; buying the compressed tails (right) lifts the floor above zero in all three outcomes.*

There's a second mode. Once a floor exists, §7.2 of the framework generalizes the objective to **floor-constrained upside**: maximize $\mathbb{E}[\Pi] = \pi_A \Pi_A + \pi_D \Pi_D + \pi_B \Pi_B$ subject to $\Pi_{\min} \ge L$ — spend some carry on *skew* instead of floor. That's Section 8. With no trustworthy probability vector $\pi$, the default is pure floor maximization; honesty about where $\pi$ comes from is Section 10's job.

## 5. The behavioral thesis: sticky to the mean, twitchy to the noise

Why should the carry + compression window exist at all? The hypothesized edge is a specific, coherent *timing* mispricing in how directional holders respond to a shock:

- **Sticky to the mean.** After an equalizer, the traders who bought "Team A wins" at 65–80¢ do not instantly mark their position to the new reality. The original thesis dies slowly — first denial ("we'll score again"), then, as the clock strips away the time needed for that story, capitulation. The win-share decays slowly at first, then rapidly. The strategy harvests the market *slowly conceding a level it should have marked immediately*.
- **Twitchy to the noise.** The same market *over*-reacts to transient pressure — a corner, ninety seconds of sustained attack — that usually resolves to nothing.

"The market holds too long and gets scared too soon at the same time" sounds like a contradiction; it isn't. Both are timing errors around a state the market agrees on. And that's the honest scope of the claimed edge: **mispriced timing, not mispriced direction.** I am not claiming to know who wins better than the market. I'm claiming that immediately after a thesis-breaking shock, the *path* by which prices reach their new fair level is slow, human, and harvestable — and that late in the game, terminal time decay turns that path into basket geometry.

The discipline this implies: **enter when capitulation and geometry are already emerging, never because they might.** The evidence, not the forecast.

## 6. Setup classes and the gate system

Not every late game state is this trade. The framework enumerates classes, and most exist to be refused:

| Class | State | Structure | Verdict |
|---|---|---|---|
| **A** | tied, late | draw carry → bounded basket | the strategy; primary |
| **B** | leader +1, late | leader-win carry → bound with draw/tail | allowed, stricter gates |
| **C** | down two | cheap draw as next-goal option | experimental, tiny only |
| **X** | leader, *early* | "the curve looks good" | **banned** |

Class B carries a structural warning worth spelling out because it's a general lesson about carry trades: at a leader-win price of $p_L = 0.82$, the maximum gross upside is $1 - p_L = 18$¢ while an equalizer collapses the price toward the floor — **risk 82 to make 18, before fees**. Small carry upside, large jump downside: bad convexity. Hence the hard rules: no leader-win entry above 75¢ before 80′, none above 80¢ unless the hedge path is visible and near-lockable. Class X — buying an early leader because the price path "looks likely to rise" — isn't a variant of the strategy at all; it's a directional bet wearing the strategy's clothes, and the tool rejects it outright (if already held: salvage only).

Entries then pass four gates, in order:

1. **Time gate.** Match minute $m \ge 75$ default, $m \ge 80$ preferred. Section 7 is the math of why this isn't a style preference.
2. **State gate.** The score state must map to a valid class; no class, no trade.
3. **Geometry gate.** Compute $\Pi^*_{\min} = \max_{q_A, q_B} \Pi_{\min}$ from the live book. Positive → **LOCK** available. Within $-\varepsilon$ of zero → WATCH. Below → NO TRADE.
4. **Hazard gate.** A read $h \in \{\text{low}, \text{med}, \text{high}\}$ of adverse-goal intensity — sustained pressure, repeated corners, shot volume, red card, a trapped defense. High hazard demands stronger geometry ($\Pi^*_{\min} \ge L_{\text{high}} > 0$).

Two hard rules in the hazard gate deserve emphasis because they encode a worldview: **absent or stale hazard input resolves to HIGH** — absence of information is adverse, not neutral (this rule exists because of a real loss; see Section 9). And **a live corner or dangerous free kick forces HIGH** regardless of any fresh tempo read — the most dangerous moment of a match arrives faster than a human's read updates.

The decision system's outputs are deliberately blunt: **PASS, NO TRADE, HOLD/WATCH, HEDGE, LOCK, SALVAGE ONLY.** A position entered in violation of the gates gets exactly one service — damage-control math — and one label: not a valid sample. The tool computes; it never places orders.

## 7. The hazard window: why early entry breaks everything

Between entering the draw leg and completing the hedge, I am naked: any goal by either side breaks the tie and collapses the leg. Let $\tau$ be time-to-conversion and $\lambda(t)$ the instantaneous adverse-goal hazard. Survival and EV:

$$
S(\tau) = \exp\!\left(-\int_0^\tau \lambda(t)\,dt\right), \qquad
\mathrm{EV} = S(\tau)\, G - (1 - S(\tau))\, L,
$$

with break-even survival $S^* = \frac{L + c}{G + L}$ including cost drag $c$. Every term punishes early entry twice over: entering early lengthens $\tau$, which decays $S(\tau)$ exponentially — *and* the carry hasn't accumulated yet, so $G$ is small. The strategy's core mechanic is **shortening the hazard window**, which is why the time gate is a gate and not a guideline, and why the design doc gives the rule its own section: *do not enter because the setup might become good; enter only when the regime is already present.*

How big is the hazard? From league-wide late-goal distributions (the 81–90′ bin carries ≈19% of all goals, with the rate still *rising* past 87′), any-goal hazard in a tied 80′+ state runs $\lambda \approx 0.04/\text{min}$. Over a 10-minute hold that's $1 - e^{-0.4} \approx 33\%$: **the strategy structurally rides a one-in-three chance of forfeiting the entire premium on every trade.** That number is not a flaw to engineer away — it's the price of the carry, and the reason the accounting in Section 9 refuses to let a good-looking win rate stand in for EV.

## 8. When to lock: the conversion-timing crossover

Given a held draw leg and a lockable book, *when* do you convert? Early → small margin, little hazard. Late → fat margin, cumulative risk. This is an optimal-stopping problem, and it has a clean closed-form answer.

Let $M(t) = \Pi^*_{\min}(t)$ be the best achievable lock margin at minute $t$ (the geometry-gate optimum against the live book) and $L \approx C_D$ the at-risk premium. Choosing conversion time $T$:

$$
\mathrm{EV}(T) = S(T)\,M(T) - (1 - S(T))\,L = S(T)\big(M(T) + L\big) - L.
$$

Differentiate with $S'(T) = -\lambda(T)\,S(T)$ and set to zero:

$$
\frac{d\,\mathrm{EV}}{dT} = S(T)\,M'(T) - \lambda(T)\,S(T)\,\big(M(T) + L\big) = 0
\quad\Longrightarrow\quad
\boxed{\;M'(t) = \lambda(t)\,\big(M(t) + L\big).\;}
$$

**Hold while the margin fattens faster than the hazard-weighted exposure cost; convert the instant the carry curve flattens to that line.** It's a genuine maximum when $M$ is concave (carry accrual decelerates late) and $\lambda$ is flat-or-rising — both hold empirically.

![The conversion-timing crossover](/images/capitulation-basket/crossover.svg)
*The stopping rule. $M'(t)$ falls as the carry curve flattens; $\lambda(t)(M(t)+L)$ rises as late-game hazard climbs and the margin itself grows. Convert at the crossing — with base-rate numbers, ≈ 89–91′.*

Three consequences worth internalizing:

**"First positive lock" is wrong.** The naive policy — convert the instant $M$ crosses zero — discards the steep part of the carry curve. The observed good locks (worst-case ≈ +49% on cost) are *produced by the wait*; they're unreachable if you grab the first +1% basket. The crossover formalizes exactly how much wait the hazard justifies.

**The scale check lands on the trader's instinct.** With demo numbers — $L \approx \$25$, margin running from +5% at 82′ to +45% at 90′, i.e. $M' \approx \$1.25/\text{min}$ — the hazard cost is $\lambda(M+L) \approx 0.04 \times \$28 \approx \$1.1/\text{min}$. Accrual ≈ cost ⟹ crossover ≈ 89–91′. My empirical habit before deriving any of this was "hold about ten minutes, convert near 90′." The math says: defensible, possibly a hair late. It's genuinely satisfying when a closed form recovers a habit — and immediately more useful than the habit, because the crossover *moves* with $\lambda(t)$, which a flat base rate cannot do.

**The tail lands *inside* the optimal zone by construction.** The policy holds through ~33% cumulative adverse-goal probability because the margin growth pays for it. That means the losses, when they come, arrive during optimal play — see the next section, because this exact scenario has a name in my ledger.

## 9. The accounting protocol: two ledgers, and losses with names

The most important part of the whole framework is bookkeeping discipline. Two records exist for every trade:

- The **financial ledger** — every fill, including mistakes and salvage. Bankroll truth.
- The **strategy-valid sample** — only trades that passed every gate. **This is the only sample EV statistics may be computed from.** A gate-violating loss is R&D spend; folding it into the strategy's loss statistics would contaminate the estimate with trades the system would never have placed. (Symmetrically: a gate-violating *win* doesn't validate anything either.)

From the valid sample with mean win $\bar{g}$ and mean loss $\bar{\ell}$:

$$
p^* = \frac{\bar{\ell}}{\bar{g} + \bar{\ell}}, \qquad
\mathrm{EV} = p\,\bar{g} - (1 - p)\,\bar{\ell},
$$

with a Beta posterior on the win rate ($p \mid \text{data} \sim \mathrm{Beta}(1+W,\, 1+L)$) tracked but explicitly not over-read — a bounded basket is *engineered* to win, so the win rate is nearly meaningless; the ratio $\bar{g}/\bar{\ell}$ carries the signal. One further anti-contamination rule: losses enter in **return space** (a full loss is −100% on premium regardless of stake), because averaging dollar losses across a sizing ramp corrupts $\bar{\ell}$ with position-size history.

The current state of that ledger, honestly: roughly 13–14 valid wins against **two** strategy-valid losses, on capital deliberately kept at unit sizes of 0.5–1% of bankroll ($212 risked → $490 over the sample, with a hard ruin floor held aside untouched). A sample this size is **model discovery, not a validated edge** — the doc's own words — and the two losses teach more than the wins:

- **Germany/Ecuador** — a valid late tied entry; Ecuador scored inside the hazard window *before any lock existed*. Pre-lock regime: irreducible strategy risk. The premium was the bet, and the ~1/3 tail landed. Class A, strategy-valid, in $\bar{\ell}$.
- **Canada** — the sharper lesson. Draw bought ~80′, a **positive lock was available**, the crossover said the carry still beat the hazard — and the adverse goal landed at 92′, before conversion. Post-lock regime, *inside optimal play*. Not a process error; not avoidable without surrendering the carry that makes the strategy pay. Also Class A, also in $\bar{\ell}$. The conversion-timing doc was written by deriving the rule this trade was implicitly tested against.
- **Algeria/Jordan** — the loss that is *not* in the sample, and why the protocol has teeth: a naked draw held with no lock, **while not watching the match**, through a live corner. Double gate violation. It's excluded from $\bar{\ell}$, logged as R&D, and — my favorite institutional response — its exact book state was frozen into the tooling as a **permanent regression fixture**, so the software now refuses that trade forever. The default-HIGH-on-stale-input rule in §6 exists because of this trade.

## 10. The subsidized upside engine

Once a lock exists, the floor becomes a funding source. A tail at price $p$ converts a dollar of locked floor into $1/p$ contracts, each netting $(1-p)/p$ on a hit — at 7¢, ~13:1. The engine:

- **The +EV condition is brutally simple:** buy the tail iff $P(\text{that side wins from here}) > p$, with EV per dollar $= P/p - 1$. Reference numbers: prior Poisson work puts a given side's win probability from a late tied state around 18.7% over the 76′–end window; at $p = 0.07$ that's ≈ +167% EV per stake. But that 18.7% is *window-unconditional* — the same 7¢ tail at 88′ is a very different trade than at 78′, so the inequality needs a minute-conditional probability. Until that exists (Part 2…), every specific skew's +EV is **asserted, not proven**, and is logged with its assumed input.
- **The post-hazard extension** — the part I find genuinely novel. After the basket is locked, a goal *can't hurt you* — and it **mints a fresh shocked-cheap leg**. A scores at 85′ → the draw collapses to single digits → that draw is now a cheap late-equalizer option, fundable from locked profit at the same convex ratio. Every post-lock shock recreates the capitulation setup in miniature. It's not one skew bet; it's a *repeated* engine: recycle slivers of floor into whichever leg the match just shocked, as many times as it shocks.
- **The guardrail:** a giveback budget $\varphi$ (default 0.15) caps cumulative skew spend at $\varphi \times$ locked floor, so guaranteed profit can never be gambled back into a coin flip. And skew P&L logs in its own field — it never touches $\bar{g}$, $\bar{\ell}$, or sample validity.

## 11. The number everything needs

Look back at what every section quietly consumed:

- §7's survival gate needs $\lambda(t)$ over the conversion window.
- §8's crossover *is* a function $M'(t) \lessgtr \lambda(t)(M(t)+L)$ — with a flat base rate it's static; with a real $\lambda(t)$ it moves with the match.
- §6's hazard gate is a human typing low/med/high — an unfalsifiable stand-in for $\int \lambda$.
- §10's skew inequality needs $P(\text{side wins from here, now})$ — minute-conditional, not window-averaged.
- And the basket's fair value from a tied state is, in competing-risks form, exactly:

$$
P(A) \approx \int_t^T \lambda_A S\,ds, \quad
P(B) \approx \int_t^T \lambda_B S\,ds, \quad
P(D) \approx S(T), \qquad
S(s) = e^{-\int_t^s (\lambda_A + \lambda_B)\,du},
$$

which sums to one by construction — the model's native support is exactly $\{A, D, B\}$.

One pair of functions — the cause-specific goal intensities $\lambda_A(t), \lambda_B(t)$ — feeds the fair value at the long horizon and the conversion gate at the short one. The framework currently fakes this pair three different ways (a 0.04 base rate, a manual tempo read, a window-unconditional 18.7%), and it does so *knowingly*, with each fake labeled.

Two rules govern the model that replaces the fakes, and they're the difference between measurement and self-deception:

- **The non-circularity firewall.** The hazard must be trained on **realized play only** — tracking, possession, goals. Never on market prices. A model that eats odds learns to reproduce the price, and the edge inequality $P > p$ collapses to a tautology that "confirms" whatever the market says. (A price-aware sibling — a convexity-*timing* feature — is allowed to exist, but it lives on the other side of a one-way wall and may never enter the fair-value inequality. Its own validation is a price-controlled residual test: raw correlation with the market proves nothing, because model and price both watch the same game.)
- **The calibration gate.** Before the computed λ prices a dollar: out-of-sample reliability (predicted 18% must hit ~18%), proper scoring (Brier/log-loss), and it must **at least match the de-vigged market** on held-out matches. A confident miscalibrated hazard is worse than the manual read, because it fires triggers with authority. Until the gate passes, every model output ships stamped `calibrated: false` and the manual gates stand.

Building that model — a Fokker–Planck momentum field over live player tracking, with pitch-control races, a 49-parameter learnable θ, and passes as value-steered jumps — is [**Part 2**](/posts/a-momentum-field-for-soccer/). It ends with the λ(t) strip below computing live in the browser.

![λ(t) from the momentum-field model](/images/capitulation-basket/lambda-strip.png)
*Where this is heading: per-side conditional goal intensities λ(t) and survival S(τ) over the 80′→90′ hazard window, computed from live tracking by the model in Part 2 — the input that turns every static rule in this post into a dynamic one.*

## 12. Closing: a system designed to say no

Strip away the math and the strategy is a small set of refusals. Refuse to predict. Refuse to enter early, no matter how good the curve looks. Refuse to average violations into the evidence. Refuse to let a 13-win streak mean more than a two-loss denominator allows. Refuse to spend the floor once it's locked, beyond a budgeted sliver. Refuse to let the model trade until it beats the market on paper, out of sample.

What's left after all the refusals is narrow but real: a repeatable structure where human capitulation timing, terminal time decay, and a worst-case optimizer occasionally align into a payoff surface that cannot lose — bought at a ~1/3 risk of losing the premium on the way in, priced by a crossover rule, and accounted for in a ledger that treats every loss as either a named tuition payment or a named statistic.

The tool's best output is NO TRADE. The season's most important outputs were two losses. Both are working as designed.

---

*The framework, addenda (subsidized upside, the Φ convexity feature, the μ pipeline, conversion timing), the trade ledger, and all the tooling (Rust workspace, wasm trading deck — which computes and never places orders) live in the kalshi-basket repo. Part 2, on the momentum-field model, is [here](/posts/a-momentum-field-for-soccer/), with a live in-browser demo.*
