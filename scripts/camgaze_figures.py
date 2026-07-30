#!/usr/bin/env python3
"""Figures for the blog post posts/camgaze-js.md.

Two figures, both faithful re-implementations of the algorithms in
camgaze.js v2 (https://github.com/a20r/camgaze.js):

  1. timm-barth.png — the gradient-alignment eye-center objective
     (Timm & Barth, VISAPP 2011) evaluated on a synthetic eye patch:
     the patch with its thresholded gradient field, and the objective
     surface whose argmax is the pupil center. Mirrors
     src/pupil/timmBarth.ts (central differences, mean + 0.3*std
     magnitude threshold, darkness weighting).

  2. one-euro.png — why the One Euro filter (Casiez et al., CHI 2012)
     replaced v1's moving average: a synthetic fixation/saccade/fixation
     trace with pupil-detection noise, smoothed by both. The moving
     average trades lag for smoothness; One Euro gets both. Mirrors
     src/filter/oneEuro.ts.

Outputs: images/camgaze/{timm-barth.png, one-euro.png}
"""

import pathlib

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

OUT = pathlib.Path(__file__).resolve().parent.parent / "images" / "camgaze"
OUT.mkdir(parents=True, exist_ok=True)

rng = np.random.default_rng(7)


# ---------------------------------------------------------------------------
# Figure 1: Timm-Barth gradient-alignment objective
# ---------------------------------------------------------------------------

def synthetic_eye(w=42, h=32):
    """A cartoon eye patch: bright sclera, iris ring, dark pupil, eyelids."""
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    cx, cy = w * 0.58, h * 0.52  # pupil deliberately off-center
    img = np.full((h, w), 205.0)

    r = np.hypot(xx - cx, yy - cy)
    img[r < 9.5] = 120.0  # iris
    img[r < 4.5] = 25.0   # pupil

    # Eyelid shading: darken toward the top and bottom edges (almond shape).
    lid = np.clip((np.abs(yy - h / 2) - (h * 0.30)) / (h * 0.2), 0, 1)
    img = img * (1 - 0.55 * lid) + 60.0 * 0.55 * lid

    img += rng.normal(0, 4.0, img.shape)
    return np.clip(img, 0, 255)


def box_blur3(img):
    p = np.pad(img, 1, mode="edge")
    out = np.zeros_like(img)
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            out += p[dy : dy + img.shape[0], dx : dx + img.shape[1]]
    return out / 9.0


def timm_barth(img, k=0.3, use_darkness=True):
    """Port of locateEyeCenter() from src/pupil/timmBarth.ts."""
    h, w = img.shape
    img = box_blur3(img)
    gx = np.zeros_like(img)
    gy = np.zeros_like(img)
    gx[1:-1, 1:-1] = (img[1:-1, 2:] - img[1:-1, :-2]) / 2
    gy[1:-1, 1:-1] = (img[2:, 1:-1] - img[:-2, 1:-1]) / 2
    mag = np.hypot(gx, gy)

    inner = mag[1:-1, 1:-1]
    thresh = inner.mean() + k * inner.std()
    keep = mag > thresh
    keep[0, :] = keep[-1, :] = False
    keep[:, 0] = keep[:, -1] = False

    ys, xs = np.nonzero(keep)
    ngx = gx[keep] / mag[keep]
    ngy = gy[keep] / mag[keep]

    score = np.zeros_like(img)
    for cy in range(h):
        for cx in range(w):
            dx = xs - cx
            dy = ys - cy
            dist = np.hypot(dx, dy)
            ok = dist > 0
            dot = (dx[ok] * ngx[ok] + dy[ok] * ngy[ok]) / dist[ok]
            dot = np.clip(dot, 0, None)
            score[cy, cx] = np.mean(dot**2) * len(dot) / len(xs)
    if use_darkness:
        score *= (255 - img) / 255
    return score, (xs, ys, ngx, ngy)


def fig_timm_barth():
    img = synthetic_eye()
    score, (xs, ys, ngx, ngy) = timm_barth(img)
    by, bx = np.unravel_index(np.argmax(score), score.shape)

    fig, axes = plt.subplots(1, 2, figsize=(9.2, 3.4), dpi=160)

    ax = axes[0]
    ax.imshow(img, cmap="gray", vmin=0, vmax=255)
    ax.quiver(
        xs, ys, ngx, -ngy,  # invert y: image rows grow downward
        color="#ff5d40", scale=28, width=0.004, headwidth=3.2,
        headlength=4, alpha=0.9,
    )
    ax.set_title("thresholded gradients $\\mathbf{g}_i$", fontsize=10)
    ax.set_xticks([])
    ax.set_yticks([])

    ax = axes[1]
    im = ax.imshow(score, cmap="magma")
    ax.plot(bx, by, "o", mfc="none", mec="#4dd2ff", mew=2, ms=14)
    ax.plot(bx, by, "+", color="#4dd2ff", ms=8, mew=2)
    ax.set_title(
        "objective $\\frac{1}{N}\\sum_i (\\mathbf{d}_i^\\top \\mathbf{g}_i)^2$"
        " $\\times$ darkness — argmax = pupil",
        fontsize=10,
    )
    ax.set_xticks([])
    ax.set_yticks([])
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.03)

    fig.tight_layout()
    fig.savefig(OUT / "timm-barth.png", bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------------------
# Figure 2: One Euro filter vs moving average
# ---------------------------------------------------------------------------

class LowPass:
    def __init__(self):
        self.y = None

    def filter(self, x, alpha):
        if self.y is None:
            self.y = x
        else:
            self.y = alpha * x + (1 - alpha) * self.y
        return self.y


class OneEuro:
    """Port of OneEuroFilter from src/filter/oneEuro.ts (same defaults)."""

    def __init__(self, min_cutoff=1.0, beta=0.007, d_cutoff=1.0):
        self.min_cutoff, self.beta, self.d_cutoff = min_cutoff, beta, d_cutoff
        self.x, self.dx = LowPass(), LowPass()
        self.last_t = None
        self.last_v = None

    @staticmethod
    def alpha(cutoff, dt):
        tau = 1 / (2 * np.pi * cutoff)
        return 1 / (1 + tau / dt)

    def filter(self, v, t_ms):
        dt = 1 / 60
        if self.last_t is not None and t_ms > self.last_t:
            dt = (t_ms - self.last_t) / 1000
        self.last_t = t_ms
        dv = (v - (self.last_v if self.last_v is not None else v)) / dt
        self.last_v = v
        edv = self.dx.filter(dv, self.alpha(self.d_cutoff, dt))
        cutoff = self.min_cutoff + self.beta * abs(edv)
        return self.x.filter(v, self.alpha(cutoff, dt))


def fig_one_euro():
    fps = 30
    t = np.arange(0, 6, 1 / fps)
    # Fixation at 120 px, a fast saccade at t=2.5s to 420 px, fixation again.
    truth = np.where(t < 2.5, 120.0, 420.0)
    ramp = (t >= 2.5) & (t < 2.58)  # ~80 ms saccade
    truth[ramp] = 120 + (420 - 120) * (t[ramp] - 2.5) / 0.08
    noisy = truth + rng.normal(0, 6.0, t.shape)  # pupil-detection jitter

    window = 12  # v1-style moving average (~400 ms at 30 fps)
    kernel = np.ones(window) / window
    padded = np.concatenate([np.full(window - 1, noisy[0]), noisy])
    ma = np.convolve(padded, kernel, mode="valid")

    # Parameters tuned for pixel-scale values (the library defaults,
    # minCutoff=1 / beta=0.007, are calibrated for normalized units):
    # a lower cutoff floor for stronger smoothing at rest, and a speed
    # term sized so the ~3750 px/s saccade opens the cutoff wide while
    # noise-induced derivatives barely move it.
    oe = OneEuro(min_cutoff=0.3, beta=0.01)
    euro = np.array([oe.filter(v, tm * 1000) for v, tm in zip(noisy, t)])

    fig, axes = plt.subplots(
        1, 2, figsize=(9.2, 3.3), dpi=160, sharey=False,
        gridspec_kw={"width_ratios": [1.7, 1]},
    )

    ax = axes[0]
    ax.plot(t, noisy, color="#b9bec7", lw=0.8, label="raw pupil x (noisy)")
    ax.plot(t, ma, color="#e0723c", lw=1.8, label=f"moving average ({window} frames)")
    ax.plot(t, euro, color="#2e7dd1", lw=1.8, label="One Euro")
    ax.plot(t, truth, "k--", lw=0.9, alpha=0.6, label="true gaze")
    ax.set_xlim(1.8, 4.2)
    ax.set_xlabel("time (s)")
    ax.set_ylabel("pupil x (px)")
    ax.set_title("saccade: the moving average lags for ~0.4 s", fontsize=10)
    ax.legend(fontsize=7.5, loc="lower right", framealpha=0.9)

    ax = axes[1]
    ax.plot(t, noisy, color="#b9bec7", lw=0.8)
    ax.plot(t, ma, color="#e0723c", lw=1.8)
    ax.plot(t, euro, color="#2e7dd1", lw=1.8)
    ax.plot(t, truth, "k--", lw=0.9, alpha=0.6)
    ax.set_xlim(0.5, 2.4)
    ax.set_ylim(90, 150)
    ax.set_xlabel("time (s)")
    ax.set_title("fixation: both are steady", fontsize=10)

    fig.tight_layout()
    fig.savefig(OUT / "one-euro.png", bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    fig_timm_barth()
    fig_one_euro()
    print(f"wrote figures to {OUT}")
