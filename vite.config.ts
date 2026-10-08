import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import agents from "agents/vite";
import { defineConfig } from "vite";
import { assertLoopbackArgs } from "./scripts/lib/loopback.ts";

// Dev login trusts loopback hostnames, so the dev server may never listen elsewhere.
assertLoopbackArgs(process.argv, ["--host"]);

export default defineConfig({
  plugins: [
    agents(),
    react(),
    cloudflare({
      // Fixed inspector port, so a dev server never races another local project for the default.
      inspectorPort: 9234,
      remoteBindings: false,
    }),
  ],
  server: { host: "127.0.0.1", strictPort: true },
  preview: { host: "127.0.0.1", strictPort: true },
});
