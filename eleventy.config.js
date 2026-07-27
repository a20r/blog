import { HtmlBasePlugin } from "@11ty/eleventy";
import syntaxHighlight from "@11ty/eleventy-plugin-syntaxhighlight";
import mathjax3 from "markdown-it-mathjax3";

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("css");
  eleventyConfig.addPassthroughCopy("js");
  eleventyConfig.addPassthroughCopy("images");
  // The momentum-field demo is a prebuilt static app — copy it verbatim and
  // keep Eleventy from processing its index.html as a template.
  eleventyConfig.addPassthroughCopy("momentum-field");
  eleventyConfig.ignores.add("momentum-field/**");
  eleventyConfig.addPlugin(HtmlBasePlugin);
  eleventyConfig.addPlugin(syntaxHighlight);
  // $...$ / $$...$$ rendered to inline SVG at build time — no client JS.
  eleventyConfig.amendLibrary("md", (mdLib) => mdLib.use(mathjax3));

  eleventyConfig.ignores.add("README.md");
  eleventyConfig.ignores.add("CLAUDE.md");

  eleventyConfig.addFilter("readableDate", (date) => {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }).format(date);
  });

  eleventyConfig.addFilter("isoDate", (date) => {
    return date.toISOString().split("T")[0];
  });

  eleventyConfig.addFilter("pad2", (n) => String(n).padStart(2, "0"));

  // Posts declare topics via `topics: [a, b]` front matter (a separate key
  // from Eleventy's `tags`, which the posts/ directory data uses to build
  // the posts collection). This maps topic -> posts for the /tags/ pages.
  eleventyConfig.addCollection("byTopic", (collectionApi) => {
    const map = {};
    for (const post of collectionApi.getFilteredByTag("posts")) {
      for (const topic of post.data.topics || []) {
        (map[topic] ??= []).push(post);
      }
    }
    return map;
  });

  eleventyConfig.addFilter("readingTime", (content) => {
    const words = String(content)
      // style/script CONTENT survives a plain tag-strip (MathJax injects a
      // large <style> block) — drop those blocks before counting words.
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .split(/\s+/)
      .filter(Boolean).length;
    return Math.max(1, Math.round(words / 220));
  });

  return {
    dir: {
      input: ".",
      includes: "_includes",
      output: "_site",
    },
    // Set by CI to "/<repo>" so links work on project GitHub Pages.
    pathPrefix: process.env.PATH_PREFIX || "/",
    markdownTemplateEngine: false,
  };
}
