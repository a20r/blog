---
topics: [collapse, supply-chains, modeling]
extraCss: ["/css/civgrad.css"]
summary: "The living essay of the civgrad project: model a civilization's supply web as a Petri net, relax it until collapse has a gradient, and ask what brittleness — not depletion — does to an island with no off-island."
---
# The civilization gradient

*The living essay of the [civgrad](https://github.com/a20r/civgrad) project
(v0.5 — flow and editorial revision). This post is the essay's
single source of truth, versioned like the repo's methodology — the
[changelog](https://github.com/a20r/blog/blob/main/posts/the-civilization-gradient-changelog.md)
lives alongside it here; civgrad hosts the model, the data, and the
seeded audits that every number and table below traces to.*

## 1. An island with no off-island

I was in the middle of the Easter Island chapter of Jared Diamond's
*Collapse* when the thought arrived, uninvited. To a
Rapa Nui islander, the island effectively *was* the world — a closed system
ringed by an ocean that might as well have been vacuum. A few thousand people
to that island is, at relative scale, a few billion people to this planet. The
ratio changes; the geometry doesn't.

The famous version of that story is contested. Terry Hunt and Carl Lipo
have argued for years that the ecocide narrative is mostly wrong:
Polynesian rats, not profligate islanders, drove the deforestation by
eating palm seeds, and the demographic catastrophe came *after* European
contact, from disease and slave raiding — not before it, from
self-inflicted resource collapse. Diamond's flagship case is shakier than
his chapter admits, and this essay keeps both readings on the table.

The metaphor survives either reading. What matters is not why the trees
disappeared but that, once they had, there was nowhere to import canoes
from. A closed system must solve its problems with what is inside it, at
the speed its internal machinery allows. Earth has no off-island.

This is not an essay about running out of things. It asks the question the
island's geometry raises: in a closed, hyperconnected economy, where
precisely is it brittle — and where should a marginal dollar of resilience
go?

<aside class="cg-callout">
<p class="kicker">what this essay is</p>
<p class="pull">One marginal dollar of resilience to spend — where should
it go?</p>
<p class="note">An exploration, not a thesis. What follows is a small
formal model of one supply-chain slice — built in the open, running live
in this page, graded against four historical shocks with its misses kept
in red. Where it would end up was not known at the start.</p>
</aside>

## 2. Brittleness is not depletion

Talk of collapse fixates on depletion — peak this, running out of that.
For most industrial inputs, abundance is not the problem. The dangerous
structure is **concentration times rebuild time**: the supply graph lacks
redundancy at a handful of nodes, and some of those nodes would take a
decade to rebuild.

A short tour of the neighborhood this project models. Semiconductor lasers
breathe neon, which is a byproduct of Soviet-era steel-mill air separation,
and until February 2022 [roughly half of the world's chip-grade purification
ran through two Ukrainian companies](https://www.cnbc.com/2022/03/12/russias-attack-on-ukraine-halts-half-of-worlds-neon-output-for-chips.html)
— one of them in Mariupol. Gallium is not
rare at all; it's sitting in bauxite tailings on every continent. It's just
that [~98% of *refining* happens in China](https://www.csis.org/analysis/beyond-rare-earths-chinas-growing-threat-gallium-supply-chains),
because everyone else stopped
bothering — which is how a [December 2024 export ban](https://nam.org/china-bans-export-of-some-critical-minerals-to-u-s-32784/)
could turn a geological
non-issue into a supply crisis. The chokepoint is a license regime, not the
Earth's crust. Every advanced chip passes through extreme-ultraviolet
lithography machines that exactly one company, ASML, knows how to build, a
few dozen a year — and underneath ASML sits Carl Zeiss SMT, whose mirrors are
[polished to sub-nanometer figure](https://www.zeiss.com/semiconductor-manufacturing-technology/smt-magazine/euv-lithography-as-an-european-joint-project.html)
by three decades of institutional knowledge
that exists in one place. A monopoly *under* the monopoly. In 1993, about
[60% of the world's epoxy molding compound for chip packaging came from a
single Sumitomo plant](https://www.upi.com/Archives/1993/07/22/Computer-memory-chip-prices-stabilize-after-factory-fire-sends-them-soaring/7204743313600/),
right up until it exploded. And [roughly 90% of leading-edge
logic fabrication sits on one island](https://theconversation.com/how-taiwan-came-to-dominate-the-global-chip-industry-276939),
which also hosts the shipping strait,
which means one bad month in one place hits fabrication *and* transport as a
single correlated event.

The chokepoints come in two species. Gallium refining is a
**capacity monopoly**: annoying, but rebuildable in two or three years of
determined investment. Zeiss and TSMC are **knowledge monopolies**: decade-
plus rebuild times, because what is concentrated is not machines but
learning. Brittleness, throughout this project, means concentration ×
rebuild-time × co-location. Depletion barely makes the list.

## 3. The machinery, defined

Before the why, the what. The whole project is one pipeline, and it is
easier to walk each stage later if you have seen the map of it first:

<figure class="cg-fig">
<svg viewBox="0 0 1000 132" role="img" aria-label="The civgrad pipeline: map, discrete net, continuous relaxation, gradients, adaptation, scorecard">
<defs>
<marker id="cg-arrow-p" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0.5 L7.5,4 L0,7.5 Z" fill="currentColor" opacity="0.75"/></marker>
</defs>
<g class="boxes">
<rect x="8" y="30" width="148" height="64" rx="10"/><text x="82" y="56" text-anchor="middle">the map</text><text x="82" y="74" text-anchor="middle" class="sub">values + provenance</text>
<rect x="176" y="30" width="148" height="64" rx="10"/><text x="250" y="56" text-anchor="middle">discrete net</text><text x="250" y="74" text-anchor="middle" class="sub">SPOFs, livelock</text>
<rect x="344" y="30" width="148" height="64" rx="10"/><text x="418" y="56" text-anchor="middle">relaxation</text><text x="418" y="74" text-anchor="middle" class="sub">saturating ODE</text>
<rect x="512" y="30" width="148" height="64" rx="10"/><text x="586" y="56" text-anchor="middle">gradients</text><text x="586" y="74" text-anchor="middle" class="sub">where to invest</text>
<rect x="680" y="30" width="148" height="64" rx="10"/><text x="754" y="56" text-anchor="middle">adaptation</text><text x="754" y="74" text-anchor="middle" class="sub">emergent recovery</text>
<rect x="848" y="30" width="148" height="64" rx="10"/><text x="922" y="56" text-anchor="middle">scorecard</text><text x="922" y="74" text-anchor="middle" class="sub">misses kept red</text>
</g>
<g class="arcs">
<path d="M156,62 L172,62" class="arc"/>
<path d="M324,62 L340,62" class="arc"/>
<path d="M492,62 L508,62" class="arc"/>
<path d="M660,62 L676,62" class="arc"/>
<path d="M828,62 L844,62" class="arc"/>
</g>
</svg>
<figcaption>One pipeline: a provenance-carrying map is compiled into a
discrete net for structural questions, relaxed into an ODE for
differentiable ones, and held to account by historical replays.</figcaption>
</figure>

A **Petri net** is a bipartite graph with two kinds of node. *Places* hold
*tokens* — the state is a marking $m \in \mathbb{N}^{|P|}$ — and stand for
stocks: crates of crude neon, packaged chips, working EUV tools.
*Transitions* are processes, wired to places by weighted arcs collected in
two matrices: $W^-$ says what each transition consumes, $W^+$ what it
produces. A transition $t$ is *enabled* when its inputs are present,
$m \ge W^- e_t$, and firing it moves matter:

$$ m' \;=\; m + \big(W^+ - W^-\big)\, e_t $$

Nothing appears from nowhere and nothing vanishes: conservation is an
invariant of the algebra, not an assumption you hope holds. Two more arc
types round out the vocabulary. A **read arc** requires a token without
consuming it — enabling needs $m_p \ge w$, but firing doesn't subtract. An
**inhibitor arc** inverts the test: the transition is enabled only while
its inhibitor place is *empty*.

<figure class="cg-fig">
<svg viewBox="0 0 900 270" role="img" aria-label="Petri net primitives: places, tokens, a transition, a read arc, and an inhibitor arc">
<defs>
<marker id="cg-arrow-q" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0.5 L7.5,4 L0,7.5 Z" fill="currentColor" opacity="0.75"/></marker>
<marker id="cg-inhib" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.4"/></marker>
</defs>
<g class="net">
<circle cx="150" cy="170" r="22" class="place"/>
<circle cx="143" cy="165" r="3.4" class="token"/><circle cx="157" cy="165" r="3.4" class="token"/><circle cx="150" cy="177" r="3.4" class="token"/>
<text x="150" y="215" text-anchor="middle">place (stock)</text>
<text x="150" y="231" text-anchor="middle" class="sub">tokens = how much</text>
<rect x="437" y="152" width="26" height="36" class="trans"/>
<text x="450" y="215" text-anchor="middle">transition (process)</text>
<text x="450" y="231" text-anchor="middle" class="sub">fires when inputs present</text>
<circle cx="750" cy="170" r="22" class="place"/>
<circle cx="750" cy="170" r="3.4" class="token"/>
<text x="750" y="215" text-anchor="middle">place (stock)</text>
<path d="M176,170 L431,170" class="arc"/>
<text x="300" y="160" text-anchor="middle" class="sub">consumes (W⁻)</text>
<path d="M467,170 L722,170" class="arc"/>
<text x="597" y="160" text-anchor="middle" class="sub">produces (W⁺)</text>
<circle cx="330" cy="52" r="18" class="place"/>
<circle cx="330" cy="52" r="3.4" class="token"/>
<text x="330" y="24" text-anchor="middle">capital equipment</text>
<path d="M344,64 C 380,96 414,128 439,148" class="arc read"/>
<text x="332" y="112" text-anchor="middle" class="sub">read arc: required,</text>
<text x="332" y="127" text-anchor="middle" class="sub">not consumed</text>
<circle cx="570" cy="52" r="18" class="place"/>
<text x="570" y="24" text-anchor="middle">policy token</text>
<path d="M556,64 C 520,96 486,128 461,148" class="arc inhib"/>
<text x="574" y="112" text-anchor="middle" class="sub">inhibitor: blocks</text>
<text x="574" y="127" text-anchor="middle" class="sub">while marked</text>
</g>
</svg>
<figcaption>The four arc types on one illustrative transition. Capital
equipment is a read arc (a catalyst); an export ban is one token sitting
on an inhibitor place.</figcaption>
</figure>

The discrete net answers structural questions — *can this state ever be
reached, is there a firing sequence after which no chip can ever be made
again* — but investment questions need derivatives, and counting doesn't
differentiate. So the second stage relaxes the net: markings become real
concentrations $x \in \mathbb{R}_{\ge 0}^{|P|}$, and each transition
becomes a flow with saturation kinetics borrowed from enzyme chemistry.
With $s(x) = x/(x + k)$ — Michaelis–Menten, where $k$ is the just-in-time
cliff, about a day and a half of stock in the frozen calibration — a
transition with capacity $c_i$ runs at

$$ v_i \;=\; c_i \cdot \min_{p \,\in\, \mathrm{in}(i)} s(x_p)
   \cdot \prod_{p \,\in\, \mathrm{read}(i)} s(x_p),
   \qquad \dot{x} \;=\; \big(W^+ - W^-\big)^{\!\top} v $$

The $\min$ is Liebig's law of the minimum — a process runs at the pace of
its scarcest input — and read arcs multiply in as catalyst availability.
Concretely: the fab runs at
$c_{\text{Fab}} \cdot \min(s_{\text{Ga}}, s_{\text{Ne}},
s_{\text{wafers}}) \cdot s_{\text{tools}}$. This is now a
piecewise-smooth ODE, which means it can be differentiated end to end,
which is the move the project is named for. Write $J$ for total fab
throughput over a disrupted trajectory; the headline object is the
gradient of its expectation over a prior $\pi$ of disruption scenarios,

$$ g \;=\; \nabla_{c,\,x_0}\; \mathbb{E}_{s \sim \pi}\!\left[ J_s(c, x_0) \right] $$

— one number per capacity and per stockpile, read as *marginal resilience
per marginal unit of investment*. Sorting $g$ is the whole thesis of the
project in a single vector, and §6 reads it.

Two more pieces complete the machine. The **adaptation law** (protocol
v1) lets capacity respond to scarcity instead of recovering on an imposed
schedule: each transition's capacity grows toward need at a frozen gain,

$$ \dot{c}_i \;=\; \alpha\, \bar{c}_i\, \sigma_i, \qquad
   \sigma_i \;=\; \max\!\big(\, \mathrm{scar}_{\mathrm{runway}},\;
   \mathrm{deficit}_i \cdot \mathrm{gap}_i \big) $$

where the runway alarm fires when a stock's months of cover
$r_p = x_p / \mathrm{drain}_p$ falls below a planning horizon
($\mathrm{scar} = \mathrm{clip}(1 - r_p/H)$, $H = 6$ months), and the
restoration term rebuilds destroyed capacity in proportion to how far
current flow sits below its pre-crisis reference. The gain
$\alpha = 0.06$ — six percent of baseline capacity re-buildable per month
at full alarm — was fitted once, on a single training event, then frozen;
how it earned each of those signals the hard way is §7's story. And the
**measurement**: every historical replay is scored on two numbers, the
*dip* (deepest drop of the observed flow against its pre-shock mean) and
the *recovery* (months until the flow re-crosses 95% of that mean).
Everything above lives in a few hundred lines of
[the repo's](https://github.com/a20r/civgrad) `core/`, and the map's
values feed it with provenance attached — every parameter carries a
source and a confidence grade, and no grade has yet risen above C, the
lowest. §9 measures what that ignorance costs.

That is the whole machine. The rest of the essay walks it: §4 argues why
this formalism and not a flow network; §5 adds the epistemic layer — fog,
drawn and labeled; §6 reads the gradient and its two surprises, with the
model running live; §7 makes recovery emergent and confesses the five
failures that shaped it; §8 scores the machine against history, misses
included; §9 cashes the gradient out into an actionable conclusion; §10
says what all of this is and isn't.

## 4. Why Petri nets

Supply chains usually get modeled as graphs — nodes, edges, flows. But the
things that actually break are *stocks* and *concurrency*: buffers draining,
processes waiting on each other, matter being conserved whether you like it
or not. The machinery of §3 gives you all three natively: stocks are
places, processes are transitions, and conservation comes already checked.
The two exotic arc types earn their keep once you notice what they mean: a
read arc — required, not consumed — is exactly what capital equipment is,
a catalyst; an inhibitor arc is exactly what a policy is. In this model,
China's gallium export ban is
literally one token sitting on one place. Sanctions relief is removing it.

The centerpiece of the discrete model (`core/net.py`) is a failure mode that
flow networks cannot even state. From the initial state, a single legal
firing — one EUV tool wearing out before any chips have been banked — reaches
a state from which no chip can *ever* be made again, while raw materials keep
flowing forever. Mining continues. Refining continues. Everything moves;
nothing can be accomplished. The formal name is livelock; the plainer name is
**busy futility**. And it rhymes with the island: Rapa Nui society kept
functioning for generations after the last tree fell. What it lost was the
ability to build ocean-going canoes. Collapse doesn't have to look like
silence. It can look like a perfectly normal Tuesday on which a certain kind
of thing has quietly become impossible.

## 5. The map and the fog

Nobody can model the global supply chain, and this project doesn't pretend
to. It borrows the fog of war from strategy games and makes it a modeling
primitive. The formalism is hierarchical Petri nets: an **oracle** is a
substitution transition — a black box that declares its interface (which
stocks flow in and out) and a one-line contract, and nothing else
(`map/_oracles/`). The live model in §6 draws oracles as literal fog,
because that's what they are: territory the map admits it hasn't surveyed.

The doctrine comes before the results because the fog burned this project
twice before any result in this essay existed — in opposite directions.
Fog hid *extra fragility*: the first cut of the map treated "equipment
manufacturing" as one box, and only expanding that box forced the question
of where the optics come from — surfacing §2's monopoly-under-the-monopoly,
Zeiss, a deeper chokepoint than ASML itself with a longer rebuild time,
found by drawing edges rather than by reading the news. And fog
manufactured *fake resilience*: the unexpanded sources at the map's
frontier had no upstream constraints, so they behaved as infinite faucets —
and the discrete net of §4, asked whether any reachable state was a dead
end, triumphantly reported that collapse was impossible. Same cause,
opposite errors. Fog is not conservative and it is not optimistic; it is
wrong in whichever direction its hidden structure points. All one can do
is draw it, label it, and remember that everything downstream of here —
the gradients of §6, the replays of §8, the conclusions of §9 — is
conditional on where the fog currently sits.

## 6. The gradient of collapse

Now the payoff of the move §3 made. Relaxed, the net is a piecewise-smooth
ODE running under JAX. Which means it's differentiable. Which means "where
should civilization's marginal dollar go" stops being a panel discussion and
becomes a vector you can compute: the derivative of disrupted throughput with
respect to every capacity and every stockpile in the net
(`core/gradients.py`). Investing along that vector is gradient ascent on
resilience. Two caveats first. The magnitudes are only as good as the
calibration — the frozen numbers live in
`validation/baseline_outputs.txt`, and every parameter behind them is
still confidence-C. For that reason, every claim in this section is
stress-tested in §9, where an audit lets all of those parameters be wrong
at once: the big signs and the broad shape survive; the fine ordering
does not. Two results stand out.

First, the **negative shipping gradient**: −2.68 in the single-scenario run,
−1.63 averaged over the disruption prior. After a shock destroys fabrication
tools, adding *more* shipping capacity makes total output *worse* — because
exports drain the packaged chips that the equipment-rebuilding loop needs.
The model derived wartime rationing from pure topology. Nobody asked it to.
When the means of production are damaged, the correct policy is to hold the
product back from consumers and feed it to the machines that make machines —
and that fell out of a derivative.

Second, the **boneyard result**: worn-out tools are among the most
valuable stockpiles in the entire net — 0.85 against 0.70 for *working*
spare tools in the single-scenario run. §9's audit took the
stronger version of this claim away from me: average over the disruption
prior and the two flip (0.43 vs 0.51), and under parameter fog worn-on-top
survives in only about a fifth of draws. What survives every regime is that
a refurbishable boneyard is *comparable in value* to pristine inventory,
because the refurbishment path converts junk back into capacity at a
fraction of the cost of building new — still a strong claim about an
industry that scraps old fab equipment routinely, and quietly shreds
resilience capital doing it. The US Air Force figured this out decades ago
in the Arizona desert.

<section class="civgrad-demo" id="demo">
<h2 class="demo-title">The model, live</h2>
<p class="demo-sub">Protocol v1: capacity is destroyed as a pure impulse; recovery is
emergent from the frozen adaptation law (ALPHA=0.06, HORIZON=6&nbsp;mo). Unmapped
territory is drawn as fog — hover it. Click any process to disrupt it.</p>
<noscript><p class="demo-sub">The live model needs JavaScript; everything it shows is
generated from <a href="https://github.com/a20r/civgrad">the repository</a>.</p></noscript>
<div class="net-wrap">
<svg id="net" viewBox="0 0 1000 520" role="img" aria-label="Petri net of the semiconductor slice with fogged oracle frontier"></svg>
<div id="tooltip" hidden></div>
</div>
<div class="controls">
<div class="presets" id="presets"></div>
<div class="sliders">
<label>disrupt
<select id="target"></select>
</label>
<label>severity <span class="val" id="severity-val"></span>
<input type="range" id="severity" min="0" max="95" step="5" value="50">
</label>
<label>stockpile <span class="val" id="buffer-val"></span>
<input type="range" id="buffer" min="0" max="12" step="0.5" value="0.5">
<small id="buffer-place"></small>
</label>
<label>alpha <span class="val" id="alpha-val"></span>
<input type="range" id="alpha" min="0.02" max="0.12" step="0.005" value="0.06">
<small>0.06 = frozen value (fitted on neon 2022)</small>
</label>
</div>
<div class="readouts">
<div class="readout"><span class="k">observed</span><span class="v" id="ro-observe"></span></div>
<div class="readout"><span class="k">dip</span><span class="v" id="ro-dip"></span></div>
<div class="readout"><span class="k">recovery</span><span class="v" id="ro-rec"></span></div>
<div class="readout" id="ro-band-wrap" hidden><span class="k">vs history</span><span class="v" id="ro-band"></span></div>
</div>
<p class="history-line" id="history-line"></p>
</div>
<div class="charts">
<svg id="chart" viewBox="0 0 1000 320" role="img" aria-label="Fab and delivered flow over 72 months"></svg>
<p class="chart-note">fab flow <span class="swatch accent"></span> and delivered flow
<span class="swatch muted"></span> over 72 months, relative to pre-shock. Dashed line:
the 95% recovery threshold. This demo runs protocol <b>v1</b> only; the imposed-τ
protocol <b>v0</b> rows, the acceptance bands, and every miss are in the
<a href="https://github.com/a20r/civgrad/blob/main/SCORECARD.md">scorecard</a>
(mirrored below).</p>
</div>
</section>

## 7. Making recovery emergent

The first version of this model had a dirty secret: recovery time was an
input. The 2022 neon shock replay recovered in about the historical window
because I *told it* alternative supply ramps in nine months. Validation
where you feed in the answer isn't validation. So v1 replaces the imposed
curve with an adaptation law: every transition's capacity grows at a rate
α when it's scarce, and recovery time becomes an *output*.

What counts as "scarce" took five instructive failures to get right, each
forced by data rather than taste. **One**: the infinite-faucet
bias from the discrete era — unconstrained sources faked away deadlock —
which became the fog doctrine of §5. **Two**: the wrong observable —
Sumitomo 1993 was invisible through fab throughput because packaging sits
*downstream* of the fab; the historical pain was in deliveries, and the
model has to be read at the place history was measured. **Three**: buffers
mask the alarm — a scarcity signal based on stock levels meant a fat
stockpile suppressed the warning until the buffer was gone, and the dip
arrived late anyway. Real markets are forward-looking: neon prices went up
9× within weeks in 2022 while stockpiles were still full, because traders
compute *runway* — months of cover at the current net drain. The repaired
signal fires when runway falls below a planning horizon. **Four**:
equilibrium hides shortage — runway alone goes silent once the system
stabilizes *into* scarcity, because nothing is draining anymore; the model
settled into permanent depression with the alarm off. The fix is a second
signal term anchored to unfilled pre-crisis demand. **Five**: adaptation
cannibalized the scarce good — at full urgency, tool-building outbid
deliveries for the very chips that were scarce and drove shipments to
zero. That's a real phenomenon (fabs need chips to build fabs; 2021 in
miniature) but its magnitude was an artifact of having no prices, so the
law now distinguishes *restoring* destroyed capacity (driven by flow
deficit) from *expanding* beyond baseline (which requires sustained runway
evidence).

α was fitted once, on the neon training event — it lands at 0.06, roughly
"6% of baseline capacity re-buildable per month at full alarm," a plausible
industrial number — and then frozen. Everything after that is holdout.

## 8. The scorecard

The protocol: structure, constants, and the calibration rule are frozen;
per-event inputs are documented historical facts with citations; predictions
are registered before running. `SCORECARD.md` is the source of truth and is
regenerated by CI, misses included. The results: **neon 2022** passes under
both protocols — with the documented ~6-month stockpiles (an industry lesson
from the 2014 Crimea price spike), no fab stoppage, matching history; the
same run *without* stockpiles takes a ~17% hit, which is the model pricing
what that lesson was worth. **Tōhoku 2011** passes: two months of wafer
inventory dwarfs the integrated deficit — 1.0 month-equivalent under the
imposed ramp, 0.6 as measured under the adaptation law (§9 tabulates all
six). That inequality — buffer-months versus the integral of the deficit
while capacity ramps — is the single mechanism that decides nearly every
event in the suite.
**Photoresist 2019** — Japan putting export licenses on the chip chemicals
it supplied to Korea's fabs, roughly 90% of the world's photoresist among
them; the licenses flowed and the feared cutoff never came — passes as the
non-event it was; and the counterfactual run of what everyone *feared* (a
real 90% cut) yields a 64% dip — the model quantifying what the panic
implied and the licensing regime prevented.

And then **Sumitomo 1993**, which the model misses twice, in opposite
directions. Under v0 it's
invisible (−1.7% — the wrong-observable failure). Under v1, measured at the
right observable, it predicts a 57.6% delivery collapse that *never
recovers* within the 72-month horizon — against a historical record of
"price spike, brief pain, no catastrophe." Tracing the never-recovers
part shows the trap precisely: the
outage piles up unpackaged chips upstream, and that bloated buffer *masks
the destroyed capacity* — packaging flow returns to its pre-crisis
reference while 8% of its capacity is still missing, so the restoration
alarm falls silent; downstream, deliveries settle at nine-tenths of
pre-shock with nothing draining, so the runway alarm is silent too. A
self-consistent depressed equilibrium with every alarm quantitatively off —
the wrong-observable failure again, this time *inside the control law*. The
stocks are misallocated — one buffer bloated, the loop it feeds starving —
and reallocation between competing uses is a price mechanism this model
does not yet have. That is hysteresis: the shock knocks the system into a
worse basin that is locally stable. Uninvited, Diamond's actual thesis
showed up in the mathematics — **collapse as attractor, not event**. For
1993 the prediction is simply wrong; the real economy reallocated its way
out in months. But a formalism that can *express* collapse-as-attractor is
exactly what a project with this name requires. It just needs the escape
mechanism reality has, and that gap is a failing test on the scorecard —
not a footnote.

Two results now sit on the other side of that test. §9's audit says the
miss is structural: re-run this replay under its 500 parameter-fog
draws and 95% still miss the acceptance band — 45% never recover at all,
and the median dip is 96% — so no citation will fix it. And the
price experiment says the diagnosis was right, from both directions.
Teach the model to see a **processing margin** — fat input saturation
beside a starved output, the formal shadow of the 1993 epoxy price spike —
and let that margin restore destroyed capacity toward baseline, and the
attractor dissolves while the passing replays don't move:

| event (v1 protocol) | frozen law | + margin restoration |
|---|---:|---:|
| neon 2022 | dip −0.7%, rec 0.0 mo | dip −0.7%, rec 0.0 mo |
| Tōhoku 2011 | dip −0.6%, rec 0.0 mo | dip −0.6%, rec 0.0 mo |
| **Sumitomo 1993** | **dip 57.6%, never recovers** | **dip 57.6%, rec 9.9 mo** |
| photoresist 2019 | dip −0.7%, rec 0.0 mo | dip −0.7%, rec 0.0 mo |

A margin term one step removed from an actual price supplies the escape
reality has. That is evidence *for* the missing-mechanism diagnosis — not
a fix. The scorecard row stays red until this ships through the
frozen-parameter discipline, because a law changed after seeing the
holdout is no longer validated against it.

The experiment's cautionary arm inverts the lesson. Suppose a crisis
manager takes the project's thesis object literally and allocates the
contested stock — packaged chips — by the gradient's own priority list,
the one computed on a catastrophe that destroys tools:

| consumer of the packaged-chip stock | gradient | crisis allocation weight |
|---|---:|---:|
| Ship_Strait (deliveries) | −2.68 | 0.000 |
| Build_EUV (tool building) | 81.79 | 0.963 |
| Refurb (tool refurbishment) | 3.15 | 0.037 |

That price list hands everything to the equipment loop and prices
deliveries at zero — and deliveries go to zero and stay there: dip 100%,
no recovery, a collapse the frozen law never produces. A gradient computed
on one catastrophe is the wrong price list for another. Real prices
re-solve the allocation problem every day with current information; a
frozen derivative does not. (Both arms regenerate from
[`analysis/`](https://github.com/a20r/civgrad/tree/main/analysis) in the
repo, alongside
[`PRICE_EXPERIMENT.md`](https://github.com/a20r/civgrad/blob/main/PRICE_EXPERIMENT.md).)

One caveat governs everything this model outputs. It has no
price-mediated allocation, no substitution, no design-around response,
and so it systematically overstates how deep shocks bite and how long
they last. Trust where it says fragility concentrates — the rankings, the
chokepoints, the signs of the gradients. Distrust how bad it says things
get.

<section class="civgrad-scorecard" id="scorecard">
<h2>The scorecard, in full</h2>
<p>Every historical replay, hits and misses, both protocols. This table mirrors the
committed <a href="https://github.com/a20r/civgrad/blob/main/SCORECARD.md">SCORECARD.md</a>,
which is regenerated by the Python runner — the authority; the demo above is a port
checked against it in CI.</p>
<div class="table-wrap"><table id="scorecard-table"></table></div>
<details id="xfail-details"><summary>Why the Sumitomo rows stay red on purpose</summary>
<p id="xfail-reason"></p></details>
</section>

## 9. The marginal dollar, cashed out

The question in §1 was where one marginal dollar of resilience should go.
This section is the model's answer, each claim carrying its measured
robustness. The scope restrictions ride along: one confidence-C
semiconductor slice, declared fog at every frontier, no price-mediated
allocation — so dips are ceilings, not forecasts.

The audit promised since §3 comes first. The protocol: 500 seeded draws,
each multiplying
every confidence-C parameter in the map by an independent lognormal
factor — 95% of factors land between ×0.5 and ×2, a fair reading of
"session estimate" — plus a separate sweep that holds the
parameters and fogs the disruption prior instead. Every gradient is
recomputed per draw, and each claim is scored by the fraction of draws
that still agree with it. (Every table in this section regenerates from
the repo's seeded
[`analysis/`](https://github.com/a20r/civgrad/tree/main/analysis)
harness.) What the audit left standing:

| claim under audit | param fog (single-scenario) | param fog (prior-averaged) | prior fog |
|---|---:|---:|---:|
| shipping gradient is negative | 89% | 85% | 100% |
| wear gradient is negative | 92% | 91% | 100% |
| top capacity is in the production/equipment complex | 99% | 91% | 100% |
| top stockpile is an equipment or fab-input stock | 100% | 90% | 100% |
| Fab is the single #1 capacity | 9% | 10% | 94% |
| boneyard: worn tools outrank working spares | 20% | 12% | 0% |
| full ranking order (Kendall τ vs baseline, mean) | 0.53 | 0.47 | 0.92 |

The verdict: **what survives parameter fog is the partition, not the
ordering** — which side of the net the marginal dollar belongs to is about
as robust as anything this model produces, while which single node leads
is fog-conditional. The prior-fog column, stable nearly everywhere,
locates the weakness: parameter ignorance, not the choice of catastrophe
prior — which real citations on the map would sharpen. Five conclusions
survive this table.

**1. Buffers first — and they have a sizing rule.** A shock bites only
when buffer-months of cover fall short of the integrated capacity deficit
while supply rebuilds. That single inequality decides every replay in the
suite:

| event | buffer (mo) | deficit, imposed-τ (mo) | deficit, emergent (mo) | outcome (v1) |
|---|---:|---:|---:|---|
| neon 2022 (historical) | 6.0 | 4.5 | 5.7 | dip −0.7% — invisible |
| neon 2022 (lean counterfactual) | 0.5 | 4.5 | 5.7 | dip 17.5%, rec 6.7 mo |
| Tōhoku 2011 | 2.0 | 1.0 | 0.6 | dip −0.6% — invisible |
| Sumitomo 1993 | 1.5 | 3.6 | 7.6 | dip 57.6%, never† |
| photoresist 2019 (realized) | 2.0 | 0.1 | 1.6 | dip −0.7% — invisible |
| photoresist 2019 (feared) | 2.0 | 0.9 | 10.6 | dip 64.0%, rec 13.7 mo |

*† depth real; the never-recovery is the §8 hysteresis artifact.*

Buffer above deficit: the shock is invisible. Buffer below: it bites. Six
rows, one rule. The industry's post-2014 neon stockpile (~6 months) sits
just above the measured deficit (5.7 month-equivalents); the 2014 lesson
bought almost exactly the right amount of insurance. *At
single-source chokepoints, hold — or require disclosure of —
months-of-cover sized to `capacity-lost × expected-ramp-months` for the
outages you consider plausible. Inventory at chokepoints is insurance
priced far below the capacity it protects — the cheapest resilience in
this model.*

**2. The marginal capacity dollar goes upstream — never to logistics.**
Here is the full capacity gradient, both objectives, with each entry's
sign stability and how often it tops the ranking under fog:

| capacity | single-scenario | prior-averaged | sign under fog (single / prior-avg) | ranks #1 (single / prior-avg) |
|---|---:|---:|---|---:|
| Fab | 157.04 | 51.42 | + robust (99%) / + robust (91%) | 9% / 10% |
| Build_EUV | 81.79 | 11.14 | + robust (93%) / + robust (91%) | 36% / 23% |
| Refine_Ga | 0.00 | 9.61 | ~0 unstable (32%) / ~0 unstable (33%) | 12% / 12% |
| Refurb | 3.15 | 7.61 | + robust (93%) / + robust (91%) | 4% / 3% |
| Purify_Ne | 29.67 | 0.80 | ~0 unstable (53%) / + leaning (66%) | 14% / 22% |
| Mine | 11.22 | 0.16 | + leaning (78%) / + leaning (82%) | 12% / 8% |
| Recycle | 0.00 | 0.06 | ~0 unstable (32%) / ~0 unstable (33%) | 0% / 0% |
| OpticsMfg | 0.00 | 0.01 | ~0 unstable (30%) / ~0 unstable (25%) | 1% / 0% |
| Consume | 0.00 | 0.00 | ~0 unstable (32%) / ~0 unstable (32%) | 0% / 0% |
| WaferSupply | 0.00 | 0.00 | ~0 unstable (25%) / ~0 unstable (15%) | 12% / 12% |
| Package | −1.70 | −0.37 | ~0 unstable (51%) / + leaning (75%) | 0% / 3% |
| Ship_Strait | −2.68 | −1.63 | − robust (89%) / − leaning (85%) | 0% / 0% |
| Wear_EUV | −6.61 | −24.26 | − robust (92%) / − robust (91%) | 1% / 7% |

*(Sign labels use strict directional fractions: "robust" ≥ 85% of draws
agree on the sign, "leaning" ≥ 65%, "~0 unstable" means no sign commands
even that — draws with exactly-zero gradients count for neither side,
which is why the zero-at-baseline rows read as unstable rather than
negative.)*

The equipment loop (Build_EUV) is the modal leader; shipping topped the
ranking in exactly one draw out of a thousand. Which single node wins, the
audit refuses to say — but industrial-policy dollars pointed at shipping,
packaging, or consumption-side capacity are pointed the wrong way in
nearly every world consistent with the map. *Capacity subsidies go
upstream: equipment, tooling, input processing.*

**3. Post-shock, allocation beats capacity — and static priority lists
are dangerous.** The negative shipping gradient (89%/85% sign-stable,
100% under prior fog) is the model deriving wartime rationing from
topology: after a capacity-destroying shock, exports drain exactly the
intermediate the rebuild loop needs. But §8's cautionary arm shows the
failure mode of taking that literally — a *frozen* priority list applied
in the wrong crisis drove deliveries to zero. *Crisis authority should
take the form of allocation power exercised on current information,
recomputed per event — or get out of the way of the prices that re-solve
that problem daily. Not pre-committed priority lists; not
logistics-capacity subsidies.*

**4. Stop shredding the boneyard.** The stockpile side of the same table:

| stockpile | single-scenario | prior-averaged | sign under fog (single / prior-avg) | ranks #1 (single / prior-avg) |
|---|---:|---:|---|---:|
| EUV_tools | 0.695 | 0.511 | + robust (88%) / + robust (87%) | 44% / 48% |
| EUV_worn | 0.848 | 0.434 | + robust (85%) / ~0 unstable (34%) | 1% / 0% |
| Ga_refined | 0.000 | 0.242 | + leaning (66%) / ~0 unstable (32%) | 13% / 13% |
| Chips | −0.020 | 0.074 | + leaning (82%) / + leaning (82%) | 0% / 8% |
| Ne_purified | 0.705 | 0.035 | + leaning (82%) / ~0 unstable (64%) | 20% / 15% |
| Pkg | −0.016 | 0.015 | + leaning (79%) / + leaning (79%) | 0% / 2% |
| Ne_crude | 0.358 | 0.013 | ~0 unstable (53%) / + leaning (65%) | 8% / 1% |
| Ga_byproduct | 0.000 | 0.003 | ~0 unstable (32%) / ~0 unstable (33%) | 0% / 1% |
| EUV_optics | 0.000 | 0.000 | + robust (86%) / ~0 unstable (24%) | 1% / 0% |
| E_waste | 0.000 | 0.000 | ~0 unstable (32%) / ~0 unstable (33%) | 0% / 0% |
| Goods | 0.000 | 0.000 | ~0 unstable (32%) / ~0 unstable (33%) | 0% / 0% |
| Wafers | 0.000 | 0.000 | ~0 unstable (25%) / ~0 unstable (15%) | 13% / 12% |

Worn tools top the single-scenario baseline (0.848 over 0.695), lose the
prior-averaged one (0.434 vs 0.511), and hold the top spot in only a
fifth of fog draws — so the audited claim is *comparable value*, not
*highest value*. Comparable is still remarkable for scrap, and the
equipment stockpiles as a family dominate the #1 slot in every regime.
*A decommissioned-tool registry, warm storage, and refurbishment capacity
are cheap resilience buys; an industry that routinely scraps old fab
equipment is discarding a stockpile the model prices near working
spares.*

**5. Tail-risk planners buy fab redundancy — and note which catastrophe
does *not* make the tail.** The frozen objective is the prior *mean*;
policy usually cares about tails. Re-weight toward the worst scenarios
holding the last 30% of prior probability and the objective concentrates
on two of the five:

| scenario | prior prob | disrupted throughput | CVaR(30%) weight |
|---|---:|---:|---:|
| neon-style gas cut | 0.30 | 70.4 | 0.00 |
| strait blockade | 0.25 | 70.5 | 0.00 |
| **Taiwan fab loss** | 0.20 | **34.2** | **0.67** |
| **gallium ban hardens** | 0.15 | **51.1** | **0.33** |
| Zeiss knocked out | 0.10 | 70.5 | 0.00 |

| rank | mean objective | tail objective |
|---:|---|---|
| 1 | Fab | Fab |
| 2 | Build_EUV | Build_EUV |
| 3 | Refine_Ga | Refurb |
| 4 | Refurb | Refine_Ga |
| 5 | Purify_Ne | Mine |

The tail's top stockpile is working tools, and no plausible buffer covers
a 60-month fab rebuild — so the tail answer is geographic redundancy for
the decade-rebuild nodes. The surprise is the last row: the
Zeiss knockout does *not* make the 72-month tail, because the
refurbishment loop consumes worn tools and chips but no new optics — the
boneyard result wearing its policy clothes. Don't read it as comfort: a
120-month rebuild mostly bites *beyond* a 72-month horizon, so this table
prices the six-year tail, not the forever tail, and extending the horizon
is named future work.

All of it conditional on a confidence-C toy slice — and the audit's own
conclusion is that citations, not more cleverness, are what would sharpen
the rankings. That is what the map's provenance gates are for.

## 10. What this is and isn't

This is not a forecast, not a claim that collapse is coming, and not a
policy tool to point at the real world without reading its scorecard
first; §9's conclusions carry their conditions for exactly that reason.
Every parameter in the map carries provenance metadata; every one is
still confidence-C, though the load-bearing ones now cite verified
sources awaiting a reviewer's upgrade. It is a lens — and the surprise of
the project is how much structure a toy lens resolves. Brittleness is
concentration times
rebuild time, not depletion. Buffer-months versus ramp-time integrals
decide who feels a shock. Boneyards are resilience capital, and adding
capacity in the wrong place can carry a negative sign. Fog is wrong in
unknown directions, so declare it. And a scorecard that shows its misses
beats an impressive demo: the red Sumitomo row is the model saying where
not to trust it.

This began with a chapter of *Collapse* and a question that stuck: where,
in a closed system, is a marginal dollar of resilience best spent? The
answer was built in one long back-and-forth with an AI (the receipts are
in the footer), then held to a discipline: frozen parameters, registered
predictions, public misses. The gradient
points somewhere. Mostly, I built this to learn how to read it. Play with
the demo above; every number it shows traces back to the repo. And if you
know one of the fogged territories — resin chemistry, phosphate
logistics, optics — the fog is labeled and the gate is open.

---

*Design history: the model and its five instructive failures were worked out
in one conversation (July 2026). Full transcript export pending —
`docs/TRANSCRIPT.md` holds the placeholder and the [interim link](https://claude.ai/share/04279425-3700-447c-82c8-9d3861471785).
When the export lands, this footer links it directly.*

<script type="module" src="/js/civgrad/app.js"></script>
