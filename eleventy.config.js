import { HtmlBasePlugin } from "@11ty/eleventy";

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("css");
  eleventyConfig.addPlugin(HtmlBasePlugin);

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
