import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";

import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: "https://anyspace.dev",
  server: { port: 4321, host: true },

  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
  ],

  build: { inlineStylesheets: "auto" },
  adapter: cloudflare()
});