# Blog conventions

Eleventy static blog. Build with `npx @11ty/eleventy`; output goes to `_site/`.

## Posts (`posts/*.md`)

- **Every post MUST have a `summary` in its front matter** — a one-to-two
  sentence quoted string. The index page (`index.njk`) shows it under the
  title; a post without one renders as a bare title in the list.
- The title comes from the first `# ` heading in the body, not front matter
  (see `posts/posts.11tydata.js`).
- Front matter uses `topics: [a, b, c]` for the tag chips and `/tags/` pages
  (`tags` is reserved for Eleventy's posts collection). `date:` is optional
  and defaults to git creation time.
- Math is written as `$...$` / `$$...$$` (rendered at build time by
  markdown-it-mathjax3); code fences get syntax highlighting.
- Images live in a per-post directory under `images/` and are referenced
  with absolute paths like `/images/<name>/figure.png` (the HtmlBase plugin
  applies the path prefix).
