import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
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
