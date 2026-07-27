---
topics: [sql, bigquery, s2, geospatial, kepler-gl]
date: 2022-02-17
summary: "Turn thousands of overlapping polygons into a heatmap with one GROUP BY: S2 cells turn geometry into integers, a hex cast turns integers into Kepler.gl tokens, and a bit mask zooms out for free."
---
# Creating heatmaps from overlapping polygons with BigQuery, S2, and Kepler.gl

Let's say that you have some large number of polygons and you want to create a
heatmap where the intensity of a point in that heatmap indicates the number of
polygons that contain that point. Basically, the more polygons containing a
point in the heatmap, the higher the intensity of that point. This tutorial
outlines a way to efficiently create these heatmaps that scale with a very large
number of polygons using [Google
BigQuery](https://cloud.google.com/products/bigquery/) and
[S2](https://s2geometry.io/).

Where does this come up? Any time each row of a table is an *area* rather than a
point and you want to know where the areas pile up: delivery zones from
thousands of restaurants, isochrones ("where can you reach in 10 minutes from
each station"), wireless coverage footprints, flood-risk extents, and so on.
"How many zones cover this block?" is a heatmap over overlap counts.

# BigQuery table schema

All the query needs is a table with a `GEOGRAPHY` column holding one polygon per
row:

```sql
CREATE TABLE my_dataset.polygon_table (
  id STRING,
  poly GEOGRAPHY
);
```

It doesn't matter how the polygons got there — `ST_GEOGFROMTEXT` on WKT,
`ST_GEOGFROMGEOJSON`, `ST_BUFFER` around points — as long as each row has one.

# Solution overview

The naive approach is fully geometric: lay a grid of points over your region and
count, for every point, how many polygons contain it with `ST_CONTAINS`. That is
a spatial join between every grid point and every polygon, and it gets ugly fast
— the pairwise containment checks dominate, and the polygons' vertices get
dragged through every comparison.

The trick is to stop doing geometry as soon as possible. Instead of asking
"which points are inside which polygons," we *rasterize* each polygon
independently onto a shared, discrete global grid, and then the overlap count
becomes a plain `GROUP BY` over integers. No spatial join ever happens: each
polygon is converted to grid cells on its own (embarrassingly parallel, which is
exactly what BigQuery is good at), and counting how many polygons landed on each
cell is the kind of hash aggregation that data warehouses eat for breakfast. The
grid we rasterize onto is S2.

## What is S2?

[S2](https://s2geometry.io/) is a library from Google that models the Earth as a
hierarchy of cells. The sphere is projected onto the six faces of a cube, and
each face is recursively subdivided into four children, 30 levels deep. A
level-0 cell is a sixth of the planet; a level-30 cell is about a square
centimeter. The two properties that matter here:

1. **Every cell has a 64-bit integer ID.** The subdivision path from cube face
   to cell is bit-packed into one integer, so "which cell is this" is a number
   you can group by, join on, and index — no geometry required.
2. **Cells at a fixed level form a (roughly) uniform grid over the whole
   planet.** At level 17, which I use below, a cell is on the order of 5,000 m²
   — roughly 70 m across, a city block or so. That's the pixel size of our
   heatmap.

BigQuery has [native S2
functions](https://cloud.google.com/bigquery/docs/reference/standard-sql/geography_functions),
and the one doing the heavy lifting here is `S2_COVERINGCELLIDS`, which takes a
`GEOGRAPHY` and returns an array of cell IDs whose union covers it.

## The query

```sql
SELECT
  CAST(cell AS STRING FORMAT 'xxxxxxxxxxxxxxxx') AS s2_token,
  COUNT(cell) AS total
FROM
  polygon_table,
  UNNEST(S2_COVERINGCELLIDS(poly,
      min_level=>17,
      max_level=>17,
      max_cells=>10000)) AS cell
GROUP BY
  cell
```

Working from the inside out:

- **`S2_COVERINGCELLIDS(poly, min_level=>17, max_level=>17, max_cells=>10000)`**
  computes, for each polygon, the set of S2 cells that covers it. Left to its
  own devices the function returns an *adaptive* covering — a few huge cells for
  the interior, small ones along the boundary — because that's the compact
  representation. That would ruin the heatmap: counts on cells of wildly
  different sizes aren't comparable. Pinning `min_level = max_level = 17` forces
  the covering to be a uniform level-17 tiling, i.e. an honest rasterization.
  `max_cells` then has to be raised from its small default so the function is
  actually allowed to emit enough cells to tile the polygon at that fine a
  level; 10,000 level-17 cells is roughly 50 km² of polygon, so size it (or your
  level) to your data.

- **`polygon_table, UNNEST(...) AS cell`** is BigQuery's implicit cross join
  against the unnested array: one output row per *(polygon, cell)* pair. This is
  the rasterization step materialized — every polygon explodes into its grid
  cells.

- **`GROUP BY cell` + `COUNT(cell)`** is the whole heatmap. A cell shows up once
  for every polygon whose covering includes it, so the count per cell is the
  number of polygons overlapping that cell. All the geometry is gone by this
  point; it's an integer aggregation.

- **`CAST(cell AS STRING FORMAT 'xxxxxxxxxxxxxxxx')`** is the sneaky part.
  BigQuery stores cell IDs as *signed* `INT64`, and the hex `FORMAT` clause
  prints the two's-complement bits as 16 lowercase hex digits — which is exactly
  the S2 *token* format that mapping tools like Kepler.gl understand. (Canonical
  tokens strip trailing zeros, but the padded form parses identically.) One cast
  and the output is directly plottable, no coordinate reconstruction needed.

One honest caveat: a covering contains every cell that *intersects* the polygon,
so cells straddling the boundary count even when only partially inside. At level
17 that's ~70 m of fuzz on the edges of shapes that are typically kilometers
across — invisible in a heatmap. If your polygons are small relative to the
cells, bump the level (each level down quarters the cell area).

# Actually running it

I didn't want a BigQuery bill just to render a blog figure, so I reproduced the
pipeline locally with the same moving parts: 250 random overlapping
delivery-zone-ish polygons over San Francisco,
[s2sphere](https://github.com/sidewalklabs/s2sphere) (a Python port of S2) standing in
for `S2_COVERINGCELLIDS`, and the query above run verbatim in SQLite — including
the signed-int64-to-hex-token cast, which SQLite spells `printf('%016x', cell)`.
The full script is [in this blog's
repo](https://github.com/a20r/blog/blob/main/scripts/s2_heatmap_demo.py).

Here is one polygon after the covering step — the array of level-17 cells that
`UNNEST` explodes into rows. Note the cells are slightly skewed quadrilaterals,
not axis-aligned squares: they're the projected cube-face grid, and their IDs
are what we count.

![A single polygon overlaid with the level-17 S2 cells covering it](/images/sql-heatmaps/s2-covering-single.png)

And here is the query result — 250 polygons exploded into 171,899
*(polygon, cell)* rows, grouped down to 24,060 distinct cells — with each token
rendered back to its cell and colored by `total`:

![Heatmap of overlap counts over San Francisco, rendered from the query output](/images/sql-heatmaps/s2-heatmap-sf.png)

The individual polygons are indistinguishable at this density, which is the
point: what survives is the structure of the *overlap*, block by block.

# Plotting with Kepler.gl

The nice thing about emitting S2 tokens is that
[Kepler.gl](https://kepler.gl/) has a built-in S2 layer, so the query output is
plottable as-is:

1. Export the query result as CSV from the BigQuery console (two columns:
   `s2_token`, `total`).
2. Drop the file into [kepler.gl/demo](https://kepler.gl/demo).
3. Add an **S2** layer, point its token field at `s2_token`, and set **Fill
   Color** based on `total` with a sequential palette. For extra drama, enable
   height and set it from `total` too — the overlap count extrudes into 3D.

Kepler decodes each token back to its cell polygon client-side and renders the
lot on a basemap. If you want to try it without running anything, here's [the
CSV from my run](/images/sql-heatmaps/s2_heatmap.csv) — drop it straight into
the demo.

# Zooming out is integer math

There's a bonus hiding in the fact that cell IDs are *hierarchical* integers.
The 64 bits of an S2 cell ID are laid out as: 3 bits picking the cube face,
then two bits per level walking down the quadtree (which of the four children
you descended into), then a single `1` bit marking where the path ends, then
zeros. So a cell's ancestor at any coarser level is a pure bit operation on the
ID — truncate the path, move the marker:

```sql
DECLARE coarse_level INT64 DEFAULT 13;

SELECT
  CAST((cell & -(1 << (2 * (30 - coarse_level))))
         | (1 << (2 * (30 - coarse_level)))
       AS STRING FORMAT 'xxxxxxxxxxxxxxxx') AS s2_token,
  SUM(total) / POW(4, 17 - coarse_level) AS avg_overlap
FROM
  heatmap_17
GROUP BY
  s2_token
```

Here `heatmap_17` is the first query's output materialized with the raw `INT64`
cell kept alongside the token. `1 << (2 * (30 - coarse_level))` is the marker
bit for the target level; AND-ing with its negation zeroes out every path bit
below it (two's complement: `-x` is all ones from `x`'s bit upward), and the OR
plants the new marker. Every level-17 cell maps to exactly one level-13
ancestor, so the `GROUP BY` folds each 256-cell block into one row — the
expensive rasterization never runs again. This works identically on the signed
`INT64`s BigQuery stores, because bitwise ops don't care about the sign
interpretation.

One honest subtlety: the statistic changes meaning. Dividing the sum by
$4^{17-\ell}$ (the number of level-17 descendants) gives the *mean overlap
depth* over the coarse cell — a box-filtered downsample of the fine heatmap,
the same thing graphics people call a mipmap. It is *not* the count of distinct
polygons touching the coarse cell; that isn't recoverable from counts alone,
and if you need it, re-run the original query at the coarser level. For a
heatmap, though, the mean is exactly what you want: intensities stay comparable
as you zoom. (Cells with zero overlap are simply absent from `heatmap_17`, and
absent rows contribute nothing to the sum — which is the correct zero.)

I ran this against my emulated results too — same SQLite database, polygons
never touched again — folding the 24,060 level-17 rows down to 1,618 cells at
level 15 and 127 at level 13:

![The same heatmap re-aggregated to levels 15 and 13 with bit math alone](/images/sql-heatmaps/s2-heatmap-pyramid.png)

Precompute a few of these and you have a zoomable heatmap pyramid: pick the
level by map zoom, serve the matching token table, and the colors mean the same
thing at every altitude. (You can also see the S2 grid getting visibly skewed
at level 13 — the projected cube-face lattice again.)

That's the whole trick: one array function to rasterize, one `GROUP BY` to
count, one cast to make the result a map — and every zoom level after that is a
bit mask and a `SUM`.
