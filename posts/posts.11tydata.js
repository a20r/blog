// Directory data for posts/: derives a post's title from its first `# ` line
// so a post can be a plain markdown file with no front matter at all.
export default {
  eleventyComputed: {
    title: (data) => {
      if (data.title) return data.title;
      const match = (data.page.rawInput || "").match(/^#\s+(.+?)\s*$/m);
      return match ? match[1] : data.page.fileSlug;
    },
  },
};
