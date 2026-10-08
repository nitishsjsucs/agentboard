import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import agents from "agents/vite";
import { defineConfig } from "vite";

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
  // Loopback only: dev login trusts loopback hostnames (SPEC section 10.3).
  server: { host: "127.0.0.1", strictPort: true },
  preview: { host: "127.0.0.1", strictPort: true },
});
