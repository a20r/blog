---
topics: [quant, soccer, prediction-markets, stochastic-processes, rust, wasm]
date: 2026-07-27
---

# A Momentum Field for Soccer: Pricing Late-Game Goal Risk with Fokker–Planck, Decision Jumps, and a 49-Parameter Learnable θ

*This post documents the `momentum-field` engine inside my Kalshi basket project: a parametric, learnable model of soccer "game momentum" that turns live player tracking into a time-varying goal intensity $\lambda_g(t)$ — the number a late-game trading strategy actually needs. It starts from a trading problem, detours through Fokker–Planck equations, pitch-control races, and piecewise-deterministic jump processes, and ends with a fitted model running entirely in the browser. All of it is open in the repo; none of it is calibrated enough to bet on yet, and the post is explicit about where that line is.*

---

## 1. The trading problem, and why it reduces to one function

Kalshi lists three-outcome soccer markets: contracts $\{A, D, B\}$ (team A wins / draw / team B wins), each YES paying \$1. The strategy I trade — *late-game capitulation basket conversion* — is not a prediction strategy. It waits for a late score-state shock, rides the slow emotional repricing of directional traders, and converts an accumulated one-leg carry (usually the draw) into a **bounded basket**: quantities $q_A, q_D, q_B$ whose worst-case terminal profit

$$
\Pi_{\min} = \min(\Pi_A, \Pi_D, \Pi_B), \qquad \Pi_j = q_j - C
$$

is non-negative regardless of the final result. The draw leg is bought early at cost basis $C_D$; the win tails are bought later, compressed by time decay. The surplus comes from the carry $d_1 - d_0$, and the existential risk is simple: **a goal lands before the hedge completes**, the tie breaks, and the draw leg collapses to roughly zero.

Everything about managing that risk reduces to one function. Let $\lambda(t)$ be the instantaneous adverse-goal hazard. The probability the tied state survives a conversion window $\tau$ is

$$
S(\tau) = \exp\left(-\int_t^{t+\tau} \lambda(s)\, ds\right),
$$

the naked-carry EV is $\mathrm{EV} = S(\tau)\,G - (1 - S(\tau))\,L$, and — the result I care most about — the **optimal moment to lock the basket** is an optimal-stopping problem whose first-order condition is a crossover rule. With $M(t)$ the best achievable lock margin at minute $t$ and $L$ the at-risk premium, the expected value of converting at $T$ is

$$
\mathrm{EV}(T) = S(T)\,M(T) - (1 - S(T))\,L = S(T)\,(M(T) + L) - L,
$$

and differentiating with $S'(T) = -\lambda(T) S(T)$ gives the interior optimum

$$
\boxed{\;M'(t) = \lambda(t)\,\big(M(t) + L\big)\;}
$$

Hold while the margin fattens faster than the hazard-weighted exposure cost; lock the instant the carry curve flattens to that line. $M'(t)$ is observable from the order book. $\lambda(t)$ is not observable from anything the market gives you — and a flat late-game base rate ($\lambda \approx 0.04/\text{min}$ in the 80'+ window, from league-wide late-goal distributions) is exactly the kind of number that's right on average and wrong in every specific match. A match with a trapped defense and repeated corners is not a $0.04$ match. The strategy's hazard gate used to handle this with a *manually typed* low/medium/high tempo read, which is embarrassing for a quantitative framework and, worse, unfalsifiable.

So the goal of the momentum-field project, stated precisely:

> **Estimate $\lambda_A(t)$ and $\lambda_B(t)$ — the cause-specific goal intensities of each side — as a function of the live, continuous state of play, from a model whose parameters are fit to realized play and never to market prices.**

The same two intensities also produce the fair-value outcome distribution. From a tied state at time $t$, with no-goal survival $S(s) = \exp(-\int_t^s [\lambda_A + \lambda_B]\,du)$, competing-risks theory gives the next-goal-decisive three-vector

$$
P(A) \approx \int_t^T \lambda_A(s)\,S(s)\,ds, \qquad
P(B) \approx \int_t^T \lambda_B(s)\,S(s)\,ds, \qquad
P(D) \approx S(T),
$$

which **sums to one by construction** — since $\frac{d}{ds}[-S] = (\lambda_A + \lambda_B) S$, the integrals telescope. The model's native support is exactly $\{A, D, B\}$: no leftover "none of the above" mass. Compute the vector, de-vig the market, and the edge reads off directly. (The approximation is *next-goal-decisive* — it treats the next goal as settling the result. That's good late and degrades early, which is fine: the strategy only operates late. The rigorous fix is the full multi-goal convolution, which is on the roadmap, not in v1.)

One model, two horizons: the long integral $t \to T$ is fair value; the short integral $t \to t+\tau$ is the conversion gate. That's the demand side. The rest of this post is the supply side.

## 2. The model object: play as a drift–diffusion field

The core representational commitment: model the **ball-state probability density** $p(x, t)$ over the pitch, and let "momentum" be a *field*, not a scalar mood. Two primitives:

- **Drift** $b(x) \in \mathbb{R}^2$ — the conditional expected ball velocity at pitch location $x$. This is "momentum of play" made into a clean object: where does play *flow* from here?
- **Diffusion** $D(x) \in \mathbb{S}^2_{+}$ — the anisotropic covariance of ball motion. Play out of a central midfield spreads differently along the pitch axis than across it, and the tensor earns its place precisely by being anisotropic.

These aren't two separate modeling choices; they're dual views of one stochastic process. The ball-state SDE $dx = b(x)\,dt + \sigma(x)\,dW$ (with $D = \sigma\sigma^\top$) has as its density evolution the **Fokker–Planck equation with a sink**:

$$
\frac{\partial p}{\partial t}
= -\nabla \cdot (b\, p)
+ \tfrac{1}{2} \partial_i \partial_j \left( D_{ij}\, p \right)
- \lambda(x)\, p,
$$

where $\lambda(x)$ is the total hazard of the possession ending at $x$. A quick honesty note on the physics framing, because it's easy to cargo-cult: the principled connection here is *classical* stochastic field theory — the Martin–Siggia–Rose / Onsager–Machlup machinery for Langevin dynamics — not quantum anything. The useful consequence is concrete: fitting the drift field is equivalent to minimizing the Onsager–Machlup path action $\int \lVert \dot{x} - b \rVert^2_{D^{-1}}\,dt$, which at leading order **reduces to a binned velocity regression**. The heavy formalism certifies that $b$ and $D$ are the right primitives; you don't need it to compute anything on day one.

The abstract form of the readout, as it appears in my design docs, is the hazard operator

$$
\lambda_g(t) = \langle \rho_t,\, K \cdot V \rangle_g = \int \rho_t(x)\,[K V](x)\,dx,
$$

with $\rho_t$ the propagated momentum density, $V$ the xG value surface, and $K$ a learned coupling kernel. Concretely, in the code, that inner product is the future-xG accrual

$$
\lambda_g(t) = \int \lambda_{\text{shot}}(x, g)\; p(x, t)\; g_{\text{fin}}(x, g)\; dx,
$$

where $\lambda_{\text{shot}}$ is the cause-specific shot-generation hazard toward goal $g$ and $g_{\text{fin}}(x) = P(\text{goal} \mid \text{shot from } x)$ is a logistic finishing surface. Same object, two framings — the operator notation is what the trading docs consume, the integral is what the Rust computes.

## 3. v1: learning the field and propagating it

### 3.1 Estimation: the cheap fit that the theory says is right

The v1 estimator is deliberately the leading-order Onsager–Machlup fit: bin consecutive-frame ball displacements $\Delta x$ by starting grid cell, then

$$
\hat{b}(\text{cell}) = \frac{\mathbb{E}[\Delta x]}{\Delta t}, \qquad
\hat{D}(\text{cell}) = \frac{\mathrm{Cov}[\Delta x]}{\Delta t}.
$$

On synthetic tracking with known ground truth, the estimator recovers midfield drift $\approx +2.8$ m/s goalward against a true $2.8$, and diffusion $D_{xx} \approx 0.78$ vs $D_{yy} \approx 0.31$ against true $0.81 / 0.25$ — the anisotropy, which is the whole point of carrying a tensor, comes through. (Two real bugs were caught by this validation loop and kept on record: the synthetic generator initially didn't insert frame-ID gaps between possessions, so the estimator differenced across resets and produced garbage drift; and the SVG renderer once drew a filled pitch over the density. Ground-truth recovery tests are worth their weight.)

![Empirical drift field and diffusion ellipses estimated from tracking](/images/momentum-field-soccer/field_empirical.svg)
*The v1 empirical field: drift quiver and anisotropic diffusion ellipses, estimated by binned displacement regression.*

### 3.2 Propagation: operator splitting with a mass-conservation discipline

The Fokker–Planck integrator splits each step into:

1. **Semi-Lagrangian advection** — trace each cell center backward along $b$ and interpolate. Unconditionally stable.
2. **Explicit anisotropic diffusion stencil** for $\tfrac12 \partial_i \partial_j (D_{ij} p)$, with the timestep CFL-limited by $h^2 / 2\,\mathrm{tr}\,D$.
3. **Exponential hazard sink** — $p \leftarrow p\,e^{-\lambda(x)\tau}$, with the shot channel accruing xG as it removes mass.

Semi-Lagrangian advection is not mass-conserving, so transport is **renormalized every step**: only the hazards are allowed to remove probability. This discipline matters more than it looks — it's what makes the survival curve $S(t)$ *mean something*. If numerical leakage can delete probability, your "survival" confounds physics with discretization error, and everything downstream (the three-vector, the crossover rule) inherits the confusion.

![Propagated density at three times](/images/momentum-field-soccer/density_1.svg)
*The ball-state PDF mid-propagation: mass streams along the drift and spreads anisotropically while hazards drain it.*

### 3.3 What v1 honestly was

A validated field estimator and propagator with three big limitations, all documented at the time: the field was **match-averaged** (it marginalized over the player configuration — the single most informative thing about the next ten seconds); the **hazards were closed-form placeholders**, not fitted; and possession was a single decaying density — the readout's mass just died, so $\lambda(t)$ was an *in-possession* intensity rather than an intensity of the *match*. Useful skeleton, wrong blood.

## 4. v2: making it parametric — the θ vector

The v2 rebuild had one organizing principle: **every tunable is a named scalar in one flat parameter vector θ** (currently 49 entries), with three consequences by construction:

- θ is **fittable from historical tracking** (batch least squares / moment matching), because the drift is *linear* in its θ-weights and the hazards are log-linear GLMs;
- θ is **tunable in realtime** (recursive least squares with exponential forgetting, running in the browser as telemetry arrives);
- θ **serializes** (JSON and a flat f32 layout for wasm staging), so a fitted model ships as an asset and a session's online updates can be read back out.

Defaults are chosen so a *neutral* state reproduces the v1 closed forms: $\theta_0$ **is** the old model, and fitting moves away from it only as far as the data earns. The interesting entries model the interaction physics.

### 4.1 Pitch control as a time-to-intercept race

The probability the attacking side controls point $x$ is a race in *arrival times*, not distances. Player $i$'s time to reach $x$ carries their velocity through a reaction window:

$$
t_i(x) = t_{\text{react}} + \frac{\lVert x - (p_i + v_i\, t_{\text{react}}) \rVert}{v_{\max}},
$$

each team's arrival time is a soft-min over its players,

$$
t_{\text{team}}(x) = \min_i t_i - \sigma \log \sum_i e^{-(t_i - \min t_i)/\sigma},
$$

and control is a logistic in the defender-minus-attacker gap:

$$
C(x) = \sigma_{\text{sig}}\!\left( \frac{t_{\text{def}}(x) - t_{\text{att}}(x)}{\sigma_c} \right).
$$

This is Spearman-style pitch control, and the velocity term is why it's worth it: a defender *sprinting toward* a zone owns it sooner than a stationary defender standing nearer. Position-only openness kernels — what v1's influence model used — cannot represent that, and it's exactly the thing that distinguishes "dangerous-looking but covered" from "about to break open."

### 4.2 Pressure, contest entropy, and control volatility

Defender pressure at $x$ is Gaussian proximity amplified by closing speed:

$$
\Pi(x) = \sum_{d \in \text{def}} \exp\!\left( -\frac{\lVert x - p_d \rVert^2}{2 r_p^2} \right) \left( 1 + \kappa \, \frac{ \max(0, v_d \cdot \widehat{(x - p_d)}) }{v_{\max}} \right).
$$

And the **control volatility** idea — "momentum uncertainty is highest where the ball is genuinely contested" — gets a clean functional form through the *contest entropy* $4\,C(x)\,(1 - C(x))$, which is $0$ when either side owns a zone outright and $1$ at a 50/50. The diffusion tensor becomes state-dependent:

$$
D(x) = D_0(\hat{b}) + \big[\theta_{\text{contest}}\, 4C(1{-}C) + \theta_{\text{press}}\, \Pi + \theta_{\text{mom}}\, \lVert v_{\text{ball}} \rVert \big] \cdot A(\hat{b}) + \theta_{\text{dpass}} \, D_{\text{pass}},
$$

anisotropic along the local drift direction ($A$ splits parallel/perpendicular), with a pass-jump second-moment term I'll come back to. Fast, contested, pressured play is *loose* play, and now that's a fitted statement rather than a vibe.

### 4.3 Potential passes: the option set

Every attacking teammate is a candidate receiver of a **lead pass**. The target is where the ball meets the *runner*, one fixed-point iteration on their motion:

$$
x_r^{\star} = p_r + v_r \cdot \frac{\lVert x_r^{\star} - x \rVert}{v_{\text{pass}}} \;\;\approx\;\; p_r + v_r\, \frac{\lVert p_r - x \rVert}{v_{\text{pass}}},
$$

— passing the ball in front of a player as they run, which is what a pass *is*. Completion is a race along the lane: sample points $y_k$ along $x \to x_r^\star$, and for each defender compute the worst ball-minus-defender arrival margin; each defender contributes a logistic factor, and the product gets a range decay and a skill factor:

$$
c_r = \prod_{d} \sigma_{\text{sig}}\!\left( \frac{ \min_k \left[ t_d(y_k) - t_{\text{flight}} \tfrac{k}{K} \right] }{\sigma_{\text{pass}}} \right) \cdot \sigma_{\text{sig}}\!\left( \frac{R - \lVert x_r^\star - x \rVert}{6} \right) \cdot s_{\text{passer}} \, s_{\text{receiver}},
$$

where $s \in [0.2, 1.5]$ are per-player pass/trap skill multipliers (hooks in the state — defaulting to $1$ until a player-identity feed exists, but the model treats "some players suck at passing or trapping" as a first-class parameter, not an afterthought). The carrier *chooses* among options with a softmax I'll define properly in §7, because the right choice model needs a value function.

The option set collapses to compound-Poisson **jump moments**: release rate $\rho(x) = \rho_0 + \rho_\Pi \Pi(x)$ (pressure forces the ball to move), completion $p = \sum_r q_r c_r$, mean completed jump $\mathbb{E}[\Delta]$, second moment $\mathbb{E}[\Delta\Delta^\top]$. A compound-Poisson jump process contributes

$$
\underbrace{\rho\, \mathbb{E}[\Delta]}_{\text{drift}}, \qquad
\underbrace{\tfrac12 \rho\, \mathbb{E}[\Delta\Delta^\top]}_{\text{diffusion}}, \qquad
\underbrace{\rho\,(1 - p)}_{\text{turnover hazard}}
$$

— so potential passes feed transport *and* risk coherently instead of being bolted on. This moment representation is exactly right for **fitting** (it keeps the drift linear in θ) and, as I found out the hard way, exactly wrong for **propagation** (§7).

### 4.4 Drift linear in θ, hazards log-linear in θ

The full drift is a weighted sum of interpretable vector features:

$$
b(x) = \theta_{\text{carry}} \underbrace{\hat{g}(x)\, C(x)}_{\text{advance what you own}}
+ \theta_{\text{space}} \underbrace{\nabla C(x)}_{\text{move toward winnable space}}
+ \theta_{\text{pass}} \underbrace{\rho\, \mathbb{E}[\Delta]}_{\text{pass transport}}
+ \theta_{\text{mom}} \underbrace{v_{\text{ball}}\, e^{-\lVert x - x_{\text{ball}}\rVert^2 / 2\ell^2}}_{\text{local momentum persistence}}.
$$

Linear-in-θ is a design constraint, not an accident — it's what makes the batch fit a (weighted, whitened) ridge regression and the online fit an RLS update. The cause-specific hazards are log-link GLMs on the same features: shot generation rises with control and falls with pressure; turnover rises with pressure, contest entropy, and the pass-failure rate $\rho(1-p)$ as an explicit offset; out-of-play ramps near the touchlines; finishing $g_{\text{fin}}$ is logistic in shot distance, goal-mouth angle, and pressure. A test pins the neutral state to the v1 closed forms so the prior is auditable.

## 5. The coupled two-possession propagation

v1's single decaying density was the structural lie. The game doesn't end when a possession ends — possession *changes*. v2 carries possession in the state: two densities $p_A(x,t)$ and $p_B(x,t)$ ("side $g$ has the ball at $x$"), each transported by its own state-conditioned field (side B sees the mirrored state), coupled by the exchanges the game actually performs:

$$
\begin{aligned}
\frac{\partial p_A}{\partial t} &= \mathcal{L}_A p_A
- (\lambda^{sh}_A + \lambda^{to}_A + \lambda^{out}_A)\, p_A
+ \underbrace{(\lambda^{to}_B + \lambda^{out}_B)\, p_B}_{\text{turnovers/outs hand over in place}}
+ \underbrace{\mathcal{R}[\lambda^{sh}_B (1 - g_{\text{fin},B})\, p_B]}_{\text{missed shots restart at the goal kick}} \\
\frac{\partial p_B}{\partial t} &= \text{(symmetric)}
\end{aligned}
$$

where $\mathcal{L}_g$ is the Fokker–Planck operator of side $g$'s field and $\mathcal{R}$ relocates mass to the goal-kick spot. The **only absorbing channel is a scored goal**: $\lambda^{sh}_g \cdot g_{\text{fin}}$. Total probability is conserved as

$$
\underbrace{\int (p_A + p_B)\, dx}_{\text{live}(t) \,=\, S(t)} + \; \text{goals}_A(t) + \text{goals}_B(t) \;=\; 1,
$$

which delivers the Addendum-C quantities *exactly* rather than by quadrature:

$$
P(g \text{ scores next}) = \text{goals}_g(T) = \int_t^T \lambda_g(s)\, S(s)\, ds,
\qquad
\lambda_g(t) = \frac{ \int \lambda^{sh}_g\, g_{\text{fin}}\; p_g\, dx }{ S(t) }.
$$

That last line is the product: the **conditional, genuinely time-varying Poisson intensity** of the hazard window — λ given no goal yet, which is precisely what $S(\tau)$ and the crossover rule consume. Every run self-checks $S(T) + P(A) + P(B) = 1$ to machine precision and monotone survival; the identity $S(T) = \exp(-\int (\lambda_A + \lambda_B))$ holds against the reported conditionals to $\sim 10^{-2}$ (trapezoid error), and both are unit tests.

One more piece of structure: the live configuration is only informative for so long. The state-conditioned fields **relax toward a neutral marginal** on a configuration-memory timescale $\theta_{\tau_{\text{state}}}$ (blend weight $w(t) = e^{-t/\tau_{\text{state}}}$). The neutral marginal is not "0.5 control everywhere" — two structural facts survive averaging: defenses concentrate near their own goal (you rarely own the opponent's box), and average pass transport exists (possessions escape their own end by passing). Without the second, a side that wins the ball deep can only crawl out at carry speed while turnovers hand it straight back — the coupled densities ratchet unphysically against one goal. Found during calibration, fixed in the marginal.

![λ(t) strip from the app](/images/momentum-field-soccer/lambda-strip.png)
*The live readout: conditional intensities for the possessing side (cyan) and opponent (pink) over the 80'→90' window, with survival $S(\tau)$ dashed. This frame caught a deep own-half possession — the model prices the opponent's turnover-and-counter intensity above the possessor's early, then both relax toward the neutral rate as configuration memory fades.*

## 6. Fitting θ to real tracking — including the two bugs that mattered

The fit runs on the DFL open tracking match that ships with the repo (~94k frames at 12.5 Hz, 1,692 possession runs after canonical-direction mirroring). Four estimators:

- **Drift**: weighted ridge on $\Delta x / \Delta t$ against the four drift features, weight $\Delta t$.
- **Volatility**: variance regression — squared drift residuals along/perpendicular to the local drift, regressed on $[1, \text{contest}, \Pi, \lVert v \rVert, D_{\text{pass}}]$ with a nonnegative active-set solver.
- **Turnover / out**: moment matching of harvested possession-end events (sequence breaks in the tracking) against exposure, with the pass-failure rate as a fixed offset.
- **Pass release rate**: new in the final iteration — see below.

Two estimator bugs produced the most instructive failures of the whole project, both diagnosed from *visual* symptoms in the app ("the PDF still looks like a Gaussian glued to the ball"):

**Bug 1 — uniform ridge with a 90× column-scale imbalance.** The control-gradient feature has RMS $\sim 0.03$; the momentum feature $\sim 3$. A single ridge coefficient $\alpha \lVert \theta - \theta_0 \rVert^2$ across both means the small-scale column can't move off its prior — the data's pull on it is invisible next to the penalty. The fix is standard but easy to skip: **whiten each column by its RMS, solve, unwhiten**. After whitening, $\theta_{\text{space}}$ went from pinned-at-prior ($38.6$, meaningless) to a fitted $9.5$, and the pass feature earned a real weight instead of noise.

**Bug 2 — fitting the drift at the wrong timescale.** At 12.5 Hz, one-step ball motion is almost pure velocity persistence: regress next-frame velocity on features and $\theta_{\text{mom}}$ absorbs *everything* — of course the ball keeps doing what it was doing for 80 ms. But the Fokker–Planck field doesn't need the 80 ms answer; it needs the transport at its own propagation timescale. The harvest now samples the drift target as the mean velocity over a lag of ~1.6 s (with events still harvested at frame rate). Persistence has decayed by then and the position-conditioned structure — carries, passes, space-seeking — carries the signal. Drift RMSE improved 31% and, more importantly, the *shape* of the propagated density stopped being a symmetric blob.

**The kick-rate fit.** The pass release rate $\rho_0$ was the last prior standing in the transport. A release is detectable in tracking as the ball's speed crossing upward through a kick threshold (~9 m/s — faster than anyone dribbles) within a contiguous run. One subtlety: the state-builder glitch-caps finite-difference ball velocities at 12 m/s (tracking artifacts), so a struck ball *above* the cap would read as speed-zero and every flight frame would count as a fresh crossing — detection therefore runs on consecutive *raw* step velocities chained by position continuity. Poisson regression by moment matching on $[1, \Pi]$ gives

$$
\rho(x) = 0.173 + 0.229\,\Pi(x) \;\; [\text{s}^{-1}],
$$

about 16 releases per minute in possession at neutral pressure — squarely in the real range for professional play, and now a measured quantity. Because all the pass moments are *linear* in $\rho$ at fixed geometry, the already-harvested feature rows are rescaled exactly rather than re-harvested.

Selected fitted values (DFL match, priors in parentheses):

| θ | fitted | prior | reading |
|---|---|---|---|
| $\theta_{\text{carry}}$ | 0.97 | 3.5 | carries advance play less than the v1 guess |
| $\theta_{\text{space}}$ | 9.49 | 40 | space-seeking real but 4× weaker than v1 |
| $\theta_{\text{pass}}$ | 0.25 | 1.0 | pass moments earn a real drift share |
| $\theta_{\text{mom}}$ | 0.49 | 1.0 | persistence at the propagation timescale is modest |
| $D_{\parallel 0}, D_{\perp 0}$ | 3.37, 4.83 | 0.5, 0.3 | real play is far noisier than the prior |
| $\theta_{\text{contest}}$ | 14.4 | 2.0 | contested zones dominate volatility |
| $\rho_0, \rho_\Pi$ | 0.173, 0.229 | 0.35, 0.5 | kick-rate detection |
| $\lambda^{to}_{\text{contest}}$ | 0.081 | 0.08 | turnover physics about right |

Two other fitting surfaces exist and deserve a sentence each. **Online**: an RLS learner with exponential forgetting, centered on the incoming θ (no data → prior; data moves parameters only as far as it earns), runs in-browser on live telemetry. **Inverse game**: the player-motion model is a coupled-Riccati feedback-Nash solver (iLQ) whose cost weights live in θ; `fit_game_weights` recovers them from observed tracking by minimizing window-prediction MSE with multiplicative coordinate descent — the fitted marking weight came out at $5.56$ against a prior of $2$, i.e. real defenders mark much harder than the prior assumed. The Nash solver itself was always exact machinery; what was heuristic was its hardcoded costs, and those are now data.

## 7. Decisions: passes are jumps, not diffusion

This is the part of the project I consider the real finding, and it came from staring at a wrong picture. With everything above fitted, the 10-second-ahead ball PDF *still* looked like an ellipse — visibly underestimating how far play travels, "1/5 of the actual line," and utterly unimodal. The transport was there; it was in the *wrong mathematical channel*.

Folding pass moments into drift and diffusion is the right **fitting** model (it keeps θ identifiable by least squares) and the wrong **propagation** model. Moments smear a *discrete decision* into a symmetric blur: $\rho \mathbb{E}[\Delta]$ shifts the mean a little and $\tfrac12 \rho \mathbb{E}[\Delta\Delta^\top]$ fattens the variance a lot, and a Gaussian with fatter variance is still a Gaussian. But the game's actual 10-second future is a *branch*: the carrier keeps it, **or** hits the runner on the left, **or** switches play right. The correct object is a **jump-diffusion / piecewise-deterministic Markov process**, whose generator has an integral term no moment-matching can imitate:

$$
\mathcal{A}p(x) = -\nabla\cdot(bp) + \tfrac12 \partial_i\partial_j (D_{ij} p)
\; + \; \underbrace{\int \big[ \nu(y \to x)\, p(y) - \nu(x \to y)\, p(x) \big]\, dy}_{\text{jumps}},
$$

with jump kernel

$$
\nu(x \to y) = \rho(x) \sum_{r} q_r(x)\, c_r(x)\, \delta\big(y - x_r^\star\big).
$$

The pieces: $\rho(x)$ is the fitted release rate; $c_r$ the lane-race completion from §4.3; and $q_r$ is the **choice policy** — a softmax over option *utility*, where utility is the **value gained at the target**:

$$
q_r \propto c_r \exp\big( u_r \big), \qquad
u_r = \theta_{\text{vgain}}\, \frac{ V(x^\star_r) - V(x) }{ v_{\text{scale}} }.
$$

$V(x)$ is a Bellman value surface — "max expected future xG from ball-state $x$ under ideal steering against the field's own diffusion and hazards" — computed by value iteration on the grid:

$$
V(x) \leftarrow \lambda_{\text{shot}}(x)\, g_{\text{fin}}(x)\, dt
+ \big(1 - \lambda_{\text{tot}}(x)\, dt\big) \max_{x' \in \mathcal{N}_b(x)} \tilde{V}(x'),
$$

where $\tilde V$ is $V$ smoothed by the diffusion (the uncontrolled spread) and $\mathcal{N}_b$ is the reachable set carried by the drift. The number of Bellman sweeps is *coupled to the propagation horizon* — the policy plans as far as the prediction looks (and in the λ-pipeline, as far as the configuration stays informative, $\tau_{\text{state}}$). This coupling matters: passes are chosen because of where the team's expected goals go, not by raw goalward progress — which is how a diagonal into a runner's path ahead beats a square ball into a crowd.

Numerically, each Fokker–Planck step now applies the jump operator: cell $c$ releases $1 - e^{-\rho_c \tau}$ of its mass, and the completed split $q_r c_r$ **relocates to the receivers' lead targets**. Mass is conserved exactly. And critically, *nothing is double-counted*, by construction:

- fields used with explicit jumps are built with $\theta_{\text{pass}} = \theta_{\text{dpass}} = 0$ (no diffuse pass transport),
- the **failure** mass $\rho(1-p)$ never moves in the jump operator — it stays where it always was, in the turnover hazard,
- and as the state field relaxes toward the neutral marginal, the explicit jumps fade out with the same weight $w(t)$ that fades the diffuse neutral pass moments in — a convex cross-fade between the two representations.

The ensemble trajectories sample the same jump tables per step (release → choose an option by $q_r c_r$ → teleport to the target), so the strands you see visibly *pass* — and the density they sample matches the PDE.

![Multimodal game-view PDF at a 10-second horizon](/images/momentum-field-soccer/game-multimodal-10s.png)
*The payoff. Game view, fitted θ, 10 s horizon: the ball PDF is genuinely multimodal — the carry mode around the ball plus discrete lobes at receivers' lead targets. Pink strands are ensemble tracks sampling the same decision process; grey dots are the simulated future player configuration; the cyan line is what actually happened.*

![Forward view without the decision jumps' player evolution](/images/momentum-field-soccer/forward-occupancy.png)
*For contrast, the forward view: same fitted transport but players frozen at the playhead — a corridor of play rather than a branch structure.*

The acceptance test for all of this is exactly the sentence I wrote before building it: *on a 10-second horizon the distribution should be multimodal because the players can pass the ball*. It's now asserted twice — a unit test on the jump operator (mass conservation to $10^{-12}$; ≥2 modes ≥8 m apart with the secondary carrying real mass), and a headless-browser test against the real match that finds **six distinct modes**, with secondary lobes at ~50% of the peak.

![Value surface with optimal-flow quiver](/images/momentum-field-soccer/value-surface.png)
*The Bellman surface $V(x)$ that steers the pass policy, with the $\nabla V$ quiver ("ideal attacking flow"). In the app this same surface family — rebuilt per time-slice, horizon-coupled — is what the propagators' decision model consumes; the view's sliders restyle only the view.*

One small consequence of "everything is θ" worth flagging: the app's value view used to have a hand-set "ideal speed" slider. It's now **derived**: $v_{\text{ideal}} = \theta_{\text{game\_vmax}} + \bar{\ell}_{\text{pass}}\, \rho_0\, \theta_{\text{pass}}$ — fitted carry top speed plus fitted mean pass transport — 6.0 m/s under the current fit. Refit the model and the knob moves itself. Knobs that the model can compute should not be knobs.

## 8. The player game

The ball model needs future *player* configurations (the fields are state-conditioned, and 10 seconds from now the state has moved). Near the ball, players are simulated with an **iLQ feedback-Nash equilibrium** — attackers steer along the θ drift features toward goal, defenders trade off marking against collision and evasion barriers, all with θ-weighted quadratic costs solved by coupled Riccati recursions. Far from the ball, an acceleration-limited best-response with three structural fixes that each killed a visible artifact: **one-to-one greedy marking assignment** (nearest-mark-for-everyone had all defenders converging on one point), a **home-position leash** (positional discipline — the shape holds instead of everyone collapsing goalward over a long horizon), and a goalkeeper anchored to the ball-goal line. The defender *decision* layer — man-mark vs zone vs lane-blocking vs tackle vs goal-defense as discrete choices, mirroring the attacker's — is the designed next step; the attacking decision model came first because it's what shapes the ball PDF.

![Wake view — where play has just been](/images/momentum-field-soccer/wake.png)
*The wake view: a rolling window of the recent past, the model's "what happened" counterpart to the forward views' "what's likely."*

## 9. The firewall and the gate — why this is still `calibrated: false`

Two design rules from the trading framework govern everything above, and they're worth stating because they're what make the model *usable* rather than just pretty.

**The non-circularity firewall (C.5).** $\lambda_g$ is fair value *only because* every fitted quantity is labeled on **realized play** — tracking, possession events, goals. The moment any of it trains against market odds, μ learns to reproduce the price, the edge inequality $P(\text{side}) > p$ collapses to a tautology, and the measurement measures itself. A Fokker–Planck propagator does not launder this — it disguises it. Market prices may *benchmark* the model; they may never be its training target. (A price-eating sibling exists — the Φ convexity feature, $\Phi_g(t,h) = \int_t^{t+h} \langle \rho_s, KV \rangle_g\, ds$ as a *leading indicator* of convexity formation — but it lives on the other side of the wall, drives timing only, and must pass a price-controlled Frisch–Waugh–Lovell falsification before it drives anything.)

**The calibration gate (C.6).** Before this λ prices a real dollar, it must — out-of-sample, match-level CV, pre-registered — (1) be *reliable* (when it says $P(A) = 0.18$, A wins ~18% in that bin), (2) score well on proper rules (Brier / log-loss against realized $\{A,D,B\}$), and (3) **at least match the de-vigged market** on held-out matches, and beat it where I intend to trade. A confident, miscalibrated μ is worse than no μ, because it fires the edge trigger on noise. Until the gate passes, every output in the pipeline carries `calibrated: false`, the hazard gate keeps its manual override, and the crossover rule runs on the base rate. The structural pieces are validated (conservation identities, ground-truth recovery, behavioral tests); the *statistical* claim — "these intensities are calibrated goal probabilities" — is not yet earned. One tracked match fits transport physics; it does not calibrate a hazard. That needs the goal-timestamped, tracking-grade corpus, and it's the explicit next milestone.

## 10. Engineering notes

Details that mattered more than they should have:

- **The whole model is `std`-only Rust**, no dependencies, compiled to a single wasm `cdylib` that serves both the trading deck and the momentum WebGL app (two ABIs in one module — JSON-over-linear-memory for the deck, flat f32 buffers for the 60 fps field app). The entire pipeline — field construction, coupled propagation, value iteration, jump tables, online RLS — runs **in the browser**. `λ(t)` at the playhead is computed client-side from staged telemetry; nothing round-trips to a server.
- **Visual debugging found what tests didn't.** Both estimator bugs of §6, the defender-collapse artifact, and the unimodality problem were all diagnosed by *looking* at the WebGL app and noticing the picture disagreed with soccer. The app's views are deliberately scoped (forward / game / wake / value, each with its own controls and an explainer) because the moment settings leaked across views, every anomaly had two candidate causes and debugging died. An instrument you can't trust can't falsify anything.
- **Every structural claim in this post is a unit test**: probability conservation, monotone survival, the $S = e^{-\int \lambda}$ identity, neutral-state equivalence to v1, jump mass conservation and multimodality, kick-rate recovery on synthetic data, RLS model recovery, GLM coefficient recovery, and a headless-browser acceptance test that drives the real app against the real match and asserts the multimodal PDF plus UI-decoupling invariants.

![The full instrument](/images/momentum-field-soccer/app-full.png)
*The full app (value view): view-scoped controls, the fitted-θ readout, the θ-derived ideal speed, and the λ(t) hazard strip. The bottom line is the whole project in one row — "next goal by 90′: poss 10% · opp 13% · none 76%" — the competing-risks three-vector, computed in-browser from the live state at the playhead.*

## 11. What's next

In rough order: the **defender decision model** (the discrete counterpart of §7 on the defensive side); **per-player skill estimation** so the $s_{\text{passer}} s_{\text{receiver}}$ hooks stop defaulting to 1; the **multi-goal convolution** to extend the next-goal-decisive three-vector earlier into matches; and the big one, **C.6 calibration** on a real corpus with the market as benchmark-not-target. If calibration passes, the manual hazard gate retires, the crossover rule runs on measured $\lambda(t)$, and the fair-value three-vector prices the basket directly. If it fails, that's a logged research result and the manual gates stand — which is the correct failure mode for a system whose first design principle is that the best output is often *no trade*.

---

*The model, the app, the fits, and every test in this post live in the `momentum-field` crate of the kalshi-basket repo. The math throughout synthesizes the project's internal design docs — the master trading framework, the momentum-field technical spec, the conversion-timing optimal-stopping note, and Addenda B/C on the Φ feature and the μ pipeline.*
