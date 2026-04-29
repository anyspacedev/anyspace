import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://teamship.app",
  server: { port: 4321, host: true },
  build: { inlineStylesheets: "auto" },
});
