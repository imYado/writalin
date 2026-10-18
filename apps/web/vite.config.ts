import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Runs the Vercel functions in `api/` inside the Vite dev server, so
 * `pnpm dev` serves the app and its API on one port. In production Vercel
 * runs them as serverless functions.
 */
function devApi(): Plugin {
  return {
    name: "writalin-dev-api",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      // Load .env.local / .env for the API (Vite only exposes VITE_* to the client).
      for (const f of [".env.local", ".env"]) {
        if (!existsSync(f)) continue;
        for (const line of readFileSync(f, "utf8").split("\n")) {
          const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
          if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
        }
      }
      server.middlewares.use("/api", async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const route = url.pathname.replace(/^\/+|\/+$/g, "");
        const file = `api/${route}.ts`;
        if (!route || route.startsWith("_") || !existsSync(file)) return next();
        try {
          const mod = (await server.ssrLoadModule(`/${file}`)) as Record<string, (r: Request) => Promise<Response>>;
          const fn = mod[req.method ?? "GET"];
          if (!fn) {
            res.statusCode = 405;
            return res.end();
          }
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
          const request = new Request(`http://${req.headers.host}/api/${route}${url.search}`, {
            method: req.method,
            headers,
            body: chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined,
          });
          const response = await fn(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          console.error(e);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    devApi(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon16.png", "icons/icon48.png", "icons/icon180.png"],
      manifest: {
        name: "Writalin",
        short_name: "Writalin",
        description: "Calm, local-first notes for students.",
        theme_color: "#3b5bdb",
        background_color: "#f4f4f1",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icons/icon48.png", sizes: "48x48", type: "image/png" },
          { src: "icons/icon128.png", sizes: "128x128", type: "image/png" },
          { src: "icons/icon192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,mjs}"],
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
});
