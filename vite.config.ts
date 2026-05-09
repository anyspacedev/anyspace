import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

const host = process.env.TAURI_DEV_HOST;

function resolveGitSha(): string {
  // CI sets VITE_GIT_SHA explicitly so the value matches the release commit
  // even in shallow checkouts. Locally, fall back to the working-tree HEAD.
  const fromEnv = process.env.VITE_GIT_SHA;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim().slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  define: {
    "import.meta.env.VITE_GIT_SHA": JSON.stringify(resolveGitSha()),
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "esnext",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ["monaco-editor", "@monaco-editor/react"],
          xterm: [
            "@xterm/xterm",
            "@xterm/addon-fit",
            "@xterm/addon-webgl",
            "@xterm/addon-serialize",
            "@xterm/addon-clipboard",
          ],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ["monaco-editor"],
  },
}));
