---
topics: [javascript, typescript, computer-vision, eye-tracking, browser]
date: 2026-07-30
summary: "In 2013 I wrote a webcam eye tracker in JavaScript by concatenating files together and sweeping intensity thresholds. Thirteen years later I rebuilt it: same idea, zero dependencies, and every stage of the pipeline replaced with an algorithm from the eye-tracking literature that didn't exist yet when v1 shipped."
---
# camgaze.js: rebuilding a 2013 webcam eye tracker with 2016's algorithms

In the summer of 2013, as an NSF REU intern, I wrote
[camgaze.js](https://github.com/a20r/camgaze.js) — an eye tracker that ran
entirely in the browser, on a laptop webcam, in visible light. No infrared
LEDs, no head rest, no plugin. Point `getUserMedia` at your face and get a
gaze vector out. There was a [paper](https://github.com/a20r/camgaze.js/tree/master/paper),
there were presentations, and there was a build process that was literally
`cat js/* > build/camgaze.js`.

Then the platform moved on. `navigator.getUserMedia` was removed in favor of
`navigator.mediaDevices.getUserMedia`. `URL.createObjectURL(stream)` — the
way you connected a camera to a `<video>` element in 2013 — was removed
outright. The demo didn't degrade; it stopped existing as a runnable
artifact. The repo sat there for over a decade as a monument to a browser
API surface that no longer exists.

This year I rebuilt it. Version 2 is a ground-up modernization: an ES-module
TypeScript library with a test suite, typed APIs, and **zero runtime
dependencies** — and, more interestingly, a tracking pipeline where nearly
every stage is an algorithm from the eye-tracking literature that *postdates
the original project*. Rebuilding a 2013 system in 2026 means you get to
cherry-pick a decade of papers written in between. This post walks through
the pipeline stage by stage: what v1 did, what the literature figured out,
and what v2 does now.

There's a [live demo](https://a20r.github.io/camgaze.js/) — start the
camera, run the 9-point calibration, and watch the red dot follow your gaze.
The original 2013 code, paper and slides are preserved untouched under
[`legacy/`](https://github.com/a20r/camgaze.js/tree/master/legacy).

# The problem: gaze from a webcam is a tiny signal

Commercial eye trackers cheat. They shine infrared light at your eye and
image the corneal glint and the pupil (which is either brightly
retroreflective or very dark under IR, depending on the illumination
geometry). The pupil–glint offset gives gaze almost directly, at sub-degree
accuracy.

A webcam gives you none of that. In visible light the pupil is a dark blob
inside a slightly-less-dark iris, imaged at maybe 40×30 pixels per eye if
the user sits at a normal laptop distance. The entire usable signal — the
difference between "looking at the left edge of the screen" and "looking at
the right edge" — is the pupil center translating a handful of pixels inside
the eye. Every stage of the pipeline is about extracting, stabilizing, and
mapping those few pixels:

1. **Find the eyes** in the frame,
2. **locate the pupil** inside each eye region,
3. **smooth** the pupil trajectory over time,
4. **map** pupil position to a point on the screen.

v1 and v2 agree on this decomposition. They disagree on every stage.

![The original 2013 pipeline: thresholded pupil candidates, detected pupils, and the corner-vector construction for the gaze vector](/images/camgaze/pupilDetection.jpg)

That figure is from the 2013 paper: the intensity-thresholded pupil
candidates (top), the accepted pupils (middle), and the geometric
construction v1 used to produce a gaze vector from the corners of the eye's
bounding box (bottom). It worked — in the demo video, under the lighting in
the lab that summer, for the faces we tried. Each stage also had a
hand-tuned constant in it that made it work, which is precisely what the
last decade of literature got rid of.

# Stage 1: finding eyes — Viola–Jones, but gated

v1 found eyes by running a Haar-cascade eye detector
([Viola–Jones, CVPR 2001](https://en.wikipedia.org/wiki/Viola%E2%80%93Jones_object_detection_framework),
via the jsfeat library) over the entire frame, every frame. This has two
problems. It's slow — the cascade slides a window over every position and
scale in the image. And an eye cascade run on a whole frame produces
phantom eyes: eyebrows, nostrils, dark corners of the room. v1's tracker
had a whole "lost eyes" bookkeeping apparatus to cope with detections
flickering in and out.

v2 keeps Viola–Jones — more on why in a second — but ports the detector
in-house (a dependency-free TypeScript port of the jsfeat scanner, with
variance-normalized stage evaluation and OpenCV-style rectangle grouping)
and changes how it's *deployed*:

- A **face** cascade finds the largest face, but only every 10th frame —
  heads move slowly relative to frame rate, so the face box is cached in
  between.
- The **eye** cascade then runs only inside the *eye band* of that face:
  the strip from 18% to 60% of the face's height. Skip the forehead, stop
  above the nostrils.
- The two strongest detections survive and are labeled left/right by
  horizontal order.

Face-gating kills both problems at once. The eye cascade scans a small crop
instead of the frame, and the things that used to masquerade as eyes —
eyebrows sit right at the edge of the band, nostrils and background clutter
are excluded entirely — never get the chance. It is simultaneously more
robust and much cheaper, which is the kind of trade you only get when the
original design was wrong.

Why keep Viola–Jones at all in the era of neural face landmarkers? Because
of the zero-dependency constraint. A MediaPipe FaceLandmarker is strictly
better at finding eyes — but it's ~10 MB of WASM and model weights, and
plenty of apps already run one for other reasons. So the eye finder is a
pluggable interface: the built-in provider is the face-gated Haar pair
(cascade data compiled into the library as TypeScript modules — no fetches,
no binary assets), and if you already have landmarks, you hand them over
and skip the cascades entirely:

```js
import { GazeTracker, LandmarkEyeRegionProvider } from "camgaze";

let latestLandmarks = null; // update from your model each frame

const tracker = new GazeTracker({
  eyeRegionProvider: new LandmarkEyeRegionProvider(() => latestLandmarks),
});
```

Tighter eye boxes in, and blink detection via eye aspect ratio for free
(more below).

# Stage 2: the pupil — gradients instead of thresholds

This is the stage where the rewrite pays for itself.

v1 located pupils by brute force: threshold the grayscale eye region at
every intensity value in a fixed window (10 to 30 out of 255), run connected
components at each threshold, and pick the blob that best matched an
expected pupil size. Those constants — `MIN_COLOR = 10`, `MAX_COLOR = 30`,
an `averageContourSize` with a comment reading *"need to figure out this
value, probably way too big right now"* — were tuned to a webcam, a room,
and a summer. Different exposure, different skin tone, backlighting, or
glasses, and the pupil simply wasn't in the window.

v2 replaces the sweep with **eye-center localization by means of gradients**
([Timm & Barth, VISAPP 2011](https://www.inb.uni-luebeck.de/fileadmin/files/PUBPDFS/TiBa11b.pdf))
— published two years before v1, but I didn't know about it then; it has
since become the standard baseline for visible-light pupil localization.
The insight is geometric. The pupil and iris form a dark disc, so image
gradients on the disc's boundary all point radially outward — away from the
center. So score every candidate center $c$ by how well the displacement
directions from $c$ to each gradient location align with the gradients
themselves:

$$
c^* \;=\; \arg\max_{c}\; \frac{1}{N} \sum_{i=1}^{N}
w_c \,\big(\mathbf{d}_i^\top \mathbf{g}_i\big)_+^2,
\qquad
\mathbf{d}_i = \frac{\mathbf{x}_i - c}{\lVert \mathbf{x}_i - c \rVert},
$$

where $\mathbf{g}_i$ is the unit gradient at pixel $\mathbf{x}_i$, only
gradients with magnitude above $\mu + 0.3\sigma$ participate, and $w_c$
weights candidates by darkness (pupils are dark, so an inverted-intensity
prior suppresses bright false peaks). At the true center, every boundary
gradient agrees; everywhere else, the dot products interfere destructively.

![The Timm-Barth objective on a synthetic eye patch: thresholded gradients on the left, the objective surface with its argmax at the pupil on the right](/images/camgaze/timm-barth.png)

That figure runs the actual algorithm (a NumPy port of the library's
`locateEyeCenter`, [script in this blog's
repo](https://github.com/a20r/blog/blob/main/scripts/camgaze_figures.py)) on
a synthetic eye patch. The objective is beautifully peaked at the pupil even
though the patch also contains eyelid edges — those gradients exist, but no
candidate center makes them *all* agree.

The objective is $O(\text{centers} \times \text{gradients})$, which sounds
bad until you notice both live in a patch downscaled to at most 42 px wide.
A call runs well under a millisecond, and the eye center at 42 px resolution
is plenty — because there's a refinement stage.

Two properties fall out for free:

**Confidence.** The normalized peak value is a real confidence signal:
gradient agreement is high on actual pupils (typically 0.15–0.45 on
fixations), and collapses toward zero when the eye closes — there's no dark
disc for the gradients to agree on. v1 had no concept of confidence; during
blinks the detected "pupil" just teleported to whatever dark blob
remained. In v2, `confidence < 0.05` *is* the blink detector.

**No thresholds on intensity.** The gradient threshold is relative
($\mu + 0.3\sigma$ of the patch itself), the darkness weight is relative.
Nothing needs to know how bright your room is.

The coarse center then gets refined by a dark-blob pass in the spirit of the
coarse-positioning stage of **ElSe**
([Fuhl et al., ETRA 2016](https://dl.acm.org/doi/10.1145/2857491.2857505)):
threshold the patch at its **2nd-percentile intensity** (plus a small
margin), flood-fill the connected dark component nearest the coarse center,
and take its centroid — which also yields a pupil radius from the blob
area. The contrast with v1 is one line: *percentile of this patch* versus
*fixed window 10–30*. The percentile threshold adapts to exposure and skin
tone by construction; the fixed window was a bet about the world. And when
no plausibly-sized dark component exists near the seed (blinks again), the
refinement declines, and the pipeline falls back to the coarse estimate
rather than inventing a blob.

# Stage 3: smoothing — the One Euro filter

Raw per-frame pupil estimates jitter by a pixel or two, and after gaze
mapping multiplies that by the screen-to-eyebox ratio, a pixel of pupil
jitter is tens of pixels of cursor jitter. v1 smoothed with a fixed-length
moving average, which forces a bad choice: a long window is smooth but lags
badly when the eye actually moves; a short window is responsive but jittery.
Eye movement makes this trade-off maximally painful, because gaze is
*either* fixating (where you want aggressive smoothing) *or* saccading at
hundreds of degrees per second (where any lag is instantly visible). A fixed
window is wrong in both regimes.

The **One Euro filter**
([Casiez, Roussel & Vogel, CHI 2012](https://gery.casiez.net/1euro/)) is the
now-standard answer, and it is embarrassingly simple: an exponential
low-pass whose cutoff frequency rises with the signal's speed,

$$
f_c = f_{c,\min} + \beta \, |\dot{\hat{x}}|.
$$

When the estimate is still, the cutoff sits at its floor and jitter is
crushed; when the estimate moves fast, the cutoff opens up and the filter
gets out of the way. One filter per axis per eye, two parameters, no model
of eye dynamics required.

![One Euro vs a 12-frame moving average on a synthetic saccade: identical steadiness during fixation, but the moving average lags the saccade by ~400 ms while One Euro settles in ~100 ms](/images/camgaze/one-euro.png)

Same simulation deal as before — the library's filter ported to NumPy, fed
a synthetic fixation–saccade–fixation trace with realistic detection noise.
During fixation the two are indistinguishable; at the saccade the moving
average spends 400 ms being wrong. That 400 ms is exactly the feeling of "the
cursor is swimming behind my eyes" that makes gaze interfaces feel broken.

(A constant-velocity Kalman filter is also in the library — it's the better
choice if you want principled uncertainty propagation or to feed downstream
fusion — but One Euro is the default because for interactive pointing it's
what you want 95% of the time, and it's two tunable knobs instead of noise
covariances.)

# Stage 4: from pupil to screen — ridge-regression calibration

v1 had no calibration. It reported a "gaze vector" — the pupil's pixel
displacement from the eye-region center — and the paper's demos worked in
that relative space: look left, vector points left. The vector from the 2013
paper's full-face figure:

![A 2013 screenshot of camgaze v1 drawing gaze vectors from both detected pupils](/images/camgaze/fullFaceGaze.jpg)

Relative gaze is enough for gestures ("user glanced left"), but the thing
everyone actually wants is *where on the screen you're looking*. Mapping
pupil position to screen coordinates depends on your face's geometry, your
distance from the screen, the camera's position, and your monitor — none of
which the library can know a priori. Hence calibration: show the user a few
dots at known screen positions, record the pupil features while they stare
at each, and fit the mapping.

v2 fits the mapping with **ridge regression**, the approach popularized for
webcam gaze by [WebGazer](https://webgazer.cs.brown.edu/)
(Papoutsaki et al., IJCAI 2016). Over typical head poses, normalized
pupil-in-eye-box position maps *near-linearly* to screen position, so a tiny
regularized linear model is the right size for the data you can collect in a
15-second calibration; anything fancier just overfits your 9 dots. The
feature vector is

$$
\phi = [\,l_x,\; l_y,\; r_x,\; r_y,\; l_x l_y,\; r_x r_y,\; 1\,],
$$

the normalized pupil coordinates of both eyes plus per-eye cross terms (a
cheap nod to the slight bilinearity you get from perspective), and two
independent models are fit for screen $x$ and $y$:

$$
w = (X^\top X + \lambda I)^{-1} X^\top t.
$$

With seven features, the normal equations are a 7×7 solve — Gaussian
elimination with partial pivoting, closed form, no iterative optimizer.
Training on a couple hundred samples is instant, entirely client-side.

The detail I care most about: **missing eyes are imputed with the other
eye's values**. Eye detection drops an eye all the time — winks, hair,
glasses glare, a head turn that clips one eye out of the face band. Because
the feature vector always carries both eye slots, filling an absent eye
with its partner's coordinates keeps the trained model applicable through
one-eye frames, instead of the gaze point blinking out whenever a detection
does. Predictions stay stable through winks by construction.

Calibrating from application code is deliberately boring:

```js
// For each of ~9 dots at known page coordinates (x, y):
tracker.addCalibrationPoint({ x, y }); // call several times per dot

// After all dots:
const { meanError } = tracker.calibration.train();

// From now on frame.gazePoint is populated.
```

`meanError` (mean Euclidean training error in pixels) comes back so the UI
can decide the calibration was garbage and re-run it.

# Blinks, confidence, and honest failure

A theme across the stages: v2 always has a story for *failing visibly*
instead of silently emitting garbage, which is the single biggest practical
difference from v1.

- The Timm–Barth confidence collapses when the eye closes → `frame.blink`.
- The blob refinement returns null rather than segment a non-pupil.
- The calibrator's estimate is null until trained, and null when both eyes
  are lost.
- For landmark users there's an
  [eye-aspect-ratio](https://vision.fe.uni-lj.si/cvww2016/proceedings/papers/05.pdf)
  helper (Soukupová & Čech, 2016) — the classic six-landmark
  height-over-width ratio that drops sharply when the lid closes.

v1's blink story was that the pupils jumped somewhere else during blinks
and the moving average dragged them back afterwards.

# The engineering wrapper

Some notes on the library-shaped parts, because they're half the reason for
the rewrite:

**Everything is a plain struct.** All vision routines operate on
`{ width, height, data }` grayscale buffers — no DOM types in the core. The
browser layer (camera capture via `getUserMedia` + `requestVideoFrameCallback`
+ `OffscreenCanvas`) is a thin adapter at the edge. Consequence: the whole
pipeline runs in workers and in Node, and the vitest suite exercises the
real algorithms headlessly — synthetic eyes with known pupil positions, no
browser in the loop. The 2013 version was untestable in a very literal
sense: you couldn't run any of it without a webcam and a human.

**One frame per camera frame.** The loop is driven by
`requestVideoFrameCallback` where available, so processing runs once per
*camera* frame, not once per display refresh — no burning 120 Hz of
detection on a 30 fps webcam.

**Buffers are reused.** The Haar detector keeps its integral-image and
work buffers across frames; the flood fill allocates its queue once per
call from typed arrays. Per-frame garbage is what murders long-running
vision loops in JS, and it's all avoidable.

**Everything is exported.** The tracker is a convenience assembly; each
piece — `HaarDetector`, `locateEyeCenter`, `refinePupil`, `OneEuroFilter2D`,
`Kalman2D`, `GazeCalibrator`, `ridgeRegression`, the image ops — is a
standalone, tree-shakeable export. If you only want a dependency-free
Viola–Jones detector, or just the One Euro filter, take that and leave the
rest.

The whole thing is about 2,000 lines of TypeScript.

# What I'd tell 2013 me

The v1 pipeline wasn't wrong in structure — find eyes, find pupils, smooth,
map is still the shape of the thing, and it's the shape of WebGazer and
every other webcam tracker too. What changed is that every hand-tuned
constant became a *relative* quantity (percentiles, gradient statistics,
speed-adaptive cutoffs) and every "it just does something" failure mode
became an explicit null or a confidence you can threshold. That's the
actual content of a decade of eye-tracking literature, compressed: the
algorithms got less clever-looking and more self-normalizing.

Also: version your platform assumptions. The 2013 code's fatal bug wasn't
in the vision — it was `URL.createObjectURL(stream)`, a line that
seemed too mundane to be a risk. The vision math from 2013 still runs
fine; it's the glue that rotted.

```sh
npm install camgaze
```

```js
import { GazeTracker } from "camgaze";

const tracker = new GazeTracker();
tracker.on("gaze", (frame) => {
  for (const eye of frame.eyes) {
    console.log(eye.side, eye.pupil, eye.confidence, eye.gazeVector);
  }
  if (frame.gazePoint) {
    moveCursor(frame.gazePoint.x, frame.gazePoint.y);
  }
});
await tracker.start(); // asks for camera permission
```

# References

- F. Timm, E. Barth. *Accurate Eye Centre Localisation by Means of Gradients.* VISAPP 2011.
- G. Casiez, N. Roussel, D. Vogel. *1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems.* CHI 2012.
- W. Fuhl, T. Santini, T. Kübler, E. Kasneci. *ElSe: Ellipse Selection for Robust Pupil Detection in Real-World Environments.* ETRA 2016.
- A. Papoutsaki, P. Sangkloy, J. Laskey, N. Daskalova, J. Huang, J. Hays. *WebGazer: Scalable Webcam Eye Tracking Using User Interactions.* IJCAI 2016.
- T. Soukupová, J. Čech. *Real-Time Eye Blink Detection using Facial Landmarks.* CVWW 2016.
- P. Viola, M. Jones. *Rapid Object Detection using a Boosted Cascade of Simple Features.* CVPR 2001.
