import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";

import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: "https://anyspace.dev",
  server: { port: 4321, host: true },

  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
  ],

  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      wrap: true,
      defaultColor: false,
    },
    rehypePlugins: [
      rehypeSlug,
      [
        rehypeAutolinkHeadings,
        {
          behavior: "append",
          properties: { className: ["heading-anchor"], ariaLabel: "Permalink to this heading" },
          content: { type: "text", value: "#" },
        },
      ],
    ],
  },

  build: { inlineStylesheets: "auto" },
  adapter: cloudflare()
});
