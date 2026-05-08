import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://anyspace.dev",
  server: { port: 4321, host: true },
  build: { inlineStylesheets: "auto" },
});
