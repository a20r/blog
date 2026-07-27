#!/usr/bin/env python3
"""Local emulation of the BigQuery S2 heatmap trick for the blog post
posts/sql-heatmaps-from-overlapping-polygons.md.

Pipeline (mirrors the post):
  1. Generate a few hundred random overlapping polygons over San Francisco
     (stand-ins for delivery zones / coverage areas / isochrones).
  2. Emulate S2_COVERINGCELLIDS(poly, min_level=>17, max_level=>17) with
     s2sphere: cover each polygon's bounding rect at level 17, keep cells
     whose center falls inside the polygon.
  3. Run the post's GROUP BY query verbatim (modulo dialect) in SQLite,
     including the signed-int64 -> 16-hex-digit token cast BigQuery does.
  4. Render the tokens back to their true S2 cell quadrilaterals and plot
     the heatmap, plus a small covering illustration for one polygon.

Outputs: images/sql-heatmaps/{s2-heatmap-sf.png, s2-covering-single.png,
         s2_heatmap.csv}
"""

import csv
import math
import pathlib
import random
import sqlite3

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import s2sphere
from matplotlib.collections import PolyCollection
from matplotlib.colors import Normalize
from shapely.geometry import Point, Polygon

OUT = pathlib.Path(__file__).resolve().parent.parent / "images" / "sql-heatmaps"
OUT.mkdir(parents=True, exist_ok=True)

LEVEL = 17
N_POLYGONS = 250
CENTER_LAT, CENTER_LNG = 37.765, -122.435  # San Francisco
rng = random.Random(20220217)


def blob(lat, lng, radius_m, n=24):
    """An irregular star-convex polygon around (lat, lng)."""
    # Low-frequency radial noise so the shapes look like real service areas,
    # not circles.
    k1, k2 = rng.randint(2, 3), rng.randint(4, 6)
    p1, p2 = rng.uniform(0, 2 * math.pi), rng.uniform(0, 2 * math.pi)
    a1, a2 = rng.uniform(0.1, 0.3), rng.uniform(0.05, 0.2)
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        r = radius_m * (1 + a1 * math.sin(k1 * t + p1) + a2 * math.sin(k2 * t + p2))
        dlat = (r * math.cos(t)) / 111_320
        dlng = (r * math.sin(t)) / (111_320 * math.cos(math.radians(lat)))
        pts.append((lng + dlng, lat + dlat))
    return Polygon(pts)


def covering_cell_ids(poly: Polygon, level: int):
    """Emulate BigQuery's S2_COVERINGCELLIDS at a single fixed level.

    RegionCoverer covers the polygon's bounding rect at `level`; cells whose
    center lies inside the polygon are kept. (BigQuery keeps every cell that
    intersects the polygon — center-in test is the same up to boundary fuzz,
    which is the post's stated approximation anyway.)
    """
    minx, miny, maxx, maxy = poly.bounds
    rect = s2sphere.LatLngRect(
        s2sphere.LatLng.from_degrees(miny, minx),
        s2sphere.LatLng.from_degrees(maxy, maxx),
    )
    coverer = s2sphere.RegionCoverer()
    coverer.min_level = coverer.max_level = level
    coverer.max_cells = 1_000_000
    for cell_id in coverer.get_covering(rect):
        c = s2sphere.LatLng.from_point(s2sphere.CellId(cell_id.id()).to_lat_lng().to_point())
        if poly.contains(Point(c.lng().degrees, c.lat().degrees)):
            yield cell_id.id()


def to_signed(u):
    """uint64 S2 id -> the signed INT64 BigQuery stores."""
    return u - (1 << 64) if u >= (1 << 63) else u


def cell_vertices(token):
    """S2 token -> the cell's 4 corner (lng, lat) pairs."""
    cell = s2sphere.Cell(s2sphere.CellId(int(token, 16)))
    out = []
    for k in range(4):
        ll = s2sphere.LatLng.from_point(cell.get_vertex(k))
        out.append((ll.lng().degrees, ll.lat().degrees))
    return out


def mercator(lng, lat):
    x = lng * 20037508.34 / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) * 20037508.34 / math.pi
    return x, y


# 1. The polygon table -------------------------------------------------------
polygons = []
for i in range(N_POLYGONS):
    lat = CENTER_LAT + rng.gauss(0, 0.018)
    lng = CENTER_LNG + rng.gauss(0, 0.022)
    polygons.append((f"zone_{i:03d}", blob(lat, lng, rng.uniform(400, 1400))))

# 2. The UNNEST(S2_COVERINGCELLIDS(...)) expansion ---------------------------
rows = []
for pid, poly in polygons:
    for cid in covering_cell_ids(poly, LEVEL):
        rows.append((pid, to_signed(cid)))
print(f"{N_POLYGONS} polygons -> {len(rows)} (polygon, cell) rows")

# 3. The query itself, in SQLite --------------------------------------------
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE polygon_table (id TEXT, cell INTEGER)")
db.executemany("INSERT INTO polygon_table VALUES (?, ?)", rows)
result = db.execute(
    """
    SELECT
      printf('%016x', cell) AS s2_token,
      COUNT(cell) AS total
    FROM polygon_table
    GROUP BY cell
    """
).fetchall()
print(f"-> {len(result)} distinct level-{LEVEL} cells, max overlap "
      f"{max(t for _, t in result)}")

with open(OUT / "s2_heatmap.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["s2_token", "total"])
    w.writerows(result)

# 4a. The heatmap ------------------------------------------------------------
verts, totals = [], []
for token, total in result:
    verts.append([mercator(*v) for v in cell_vertices(token)])
    totals.append(total)

fig, ax = plt.subplots(figsize=(9, 9), dpi=200)
surface = "#101418"
fig.patch.set_facecolor(surface)
ax.set_facecolor(surface)

norm = Normalize(vmin=0, vmax=max(totals))
pc = PolyCollection(verts, array=totals, cmap="magma", norm=norm,
                    edgecolors="none", antialiaseds=False)
ax.add_collection(pc)

xs = [x for quad in verts for x, _ in quad]
ys = [y for quad in verts for _, y in quad]
pad = 800
ax.set_xlim(min(xs) - pad, max(xs) + pad)
ax.set_ylim(min(ys) - pad, max(ys) + pad)
ax.set_aspect("equal")
ax.set_axis_off()

try:  # basemap is a nice-to-have; the cells are the figure
    import contextily as cx

    cx.add_basemap(ax, source=cx.providers.CartoDB.DarkMatterNoLabels,
                   crs="EPSG:3857", attribution=False, zorder=0)
    ax.text(0.99, 0.01, "basemap © OpenStreetMap contributors © CARTO",
            transform=ax.transAxes, ha="right", va="bottom",
            fontsize=6, color="#8a939e")
    print("basemap: ok")
except Exception as e:  # offline build: plain dark surface
    print(f"basemap: skipped ({e})")

cb = fig.colorbar(pc, ax=ax, fraction=0.036, pad=0.02)
cb.set_label("polygons covering the cell", color="#e6e9ec")
cb.ax.yaxis.set_tick_params(color="#8a939e", labelcolor="#e6e9ec")
cb.outline.set_edgecolor("#2a3138")

fig.savefig(OUT / "s2-heatmap-sf.png", bbox_inches="tight",
            facecolor=surface, pad_inches=0.15)
plt.close(fig)

# 4b. One polygon and its covering ------------------------------------------
pid, poly = polygons[7]
tokens = [format(to_signed(c) & 0xFFFFFFFFFFFFFFFF, "016x")
          for c in covering_cell_ids(poly, LEVEL)]
fig, ax = plt.subplots(figsize=(6, 6), dpi=200)
fig.patch.set_facecolor(surface)
ax.set_facecolor(surface)
quads = [[mercator(*v) for v in cell_vertices(t)] for t in tokens]
ax.add_collection(PolyCollection(
    quads, facecolors="#f28e2b", alpha=0.35, edgecolors=surface, linewidths=0.5))
bx, by = zip(*[mercator(x, y) for x, y in poly.exterior.coords])
ax.plot(bx, by, color="#7cc4fa", linewidth=2)
ax.set_aspect("equal")
ax.set_axis_off()
ax.set_title(f"one polygon, its {len(tokens)} level-{LEVEL} cells",
             color="#e6e9ec", fontsize=11)
fig.savefig(OUT / "s2-covering-single.png", bbox_inches="tight",
            facecolor=surface, pad_inches=0.15)
plt.close(fig)
print("figures written to", OUT)
