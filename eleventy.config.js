import { HtmlBasePlugin } from "@11ty/eleventy";
import syntaxHighlight from "@11ty/eleventy-plugin-syntaxhighlight";

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("css");
  eleventyConfig.addPlugin(HtmlBasePlugin);
  eleventyConfig.addPlugin(syntaxHighlight);

  eleventyConfig.ignores.add("README.md");

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
