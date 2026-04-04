import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/python-sidecar/**", "**/node-sidecar/**"],
    },
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/App.tsx",
        "./src/components/**/*.tsx",
        "./src/hooks/**/*.ts",
      ],
    },
  },

  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/plugin-dialog",
      "lucide-react",
    ],
  },

  build: {
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react/jsx-runtime"],
          tauri: [
            "@tauri-apps/api/core",
            "@tauri-apps/api/event",
            "@tauri-apps/plugin-dialog",
          ],
          ui: ["lucide-react"],
        },
      },
    },
  },

  esbuild: {
    drop: process.env.TAURI_DEBUG ? [] : ["console", "debugger"],
  },

  clearScreen: false,
});
