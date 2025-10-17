import { createRequestHandler } from "@remix-run/express";
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Serve static files
app.use(express.static("build/client", {
  immutable: true,
  maxAge: "1y"
}));

// Handle all routes with Remix
app.all("*", createRequestHandler({
  build: await import("./build/server/index.js"),
  mode: process.env.NODE_ENV || "production"
}));

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server started on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV}`);
  console.log(`   Shopify App URL: ${process.env.SHOPIFY_APP_URL}`);
});
