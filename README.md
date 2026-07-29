# toilet time explorations

A blog built with [Eleventy](https://www.11ty.dev/), deployed automatically to GitHub Pages.

## Adding a post

Drop a markdown file into `posts/` — that's it. No front matter needed:

- The **title** comes from the first `# Heading` line in the file.
- The **date** comes from the git commit that added the file.
- The **URL slug** comes from the filename (`posts/my-post.md` → `/posts/my-post/`).

Open a PR with the new file; CI builds the site as a check. When the PR merges to `main`, the site rebuilds and deploys automatically.

Front matter is optional but supported if you want to override things or tag the post:

```markdown
---
title: A custom title
date: 2026-01-01
topics: [claude, shenanigans]
---
```

`topics` are shown as chips on the home page and on the post, and each topic gets its own listing page at `/tags/<topic>/`.

## Local development

```sh
npm install
npm start        # serves at http://localhost:8080 with live reload
npm run build    # writes the static site to _site/
```

## How deployment works

`.github/workflows/deploy.yml` runs on every push to `main`: it builds the site with Eleventy and publishes it via GitHub Pages (using the "GitHub Actions" Pages source, which the workflow enables on first run). Pull requests get a build-only check, no deploy.
