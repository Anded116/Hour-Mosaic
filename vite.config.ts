import { defineConfig } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error process is a Node.js global
const host = process.env.TAURI_DEV_HOST;
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(here, "index.html"),
        history: resolve(here, "history.html"),
        settings: resolve(here, "settings.html"),
      },
    },
  },
});
