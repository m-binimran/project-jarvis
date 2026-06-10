// serve.js — simple static file server for the JARVIS frontend
// Usage: node serve.js
// Opens at http://localhost:3020

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3020;
const DIR = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".jsx": "application/javascript; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".wav": "audio/wav",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

  // Stay inside the frontend folder — no path traversal.
  const filePath = path.normalize(path.join(DIR, urlPath));
  if (!filePath.startsWith(DIR)) { res.writeHead(403); res.end("Forbidden"); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end(`Not found: ${urlPath}`);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "text/plain",
      // Allow the page to call the daemon (localhost:9101) without CORS issues
      "Access-Control-Allow-Origin": "*",
    });
    res.end(data);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  JARVIS Frontend running at http://127.0.0.1:${PORT}\n`);
  console.log(`  Make sure the daemon is running:`);
  console.log(`  cd "C:/Users/user/Claude apps/jarvis-daemon"`);
  console.log(`  node --experimental-strip-types src/index.ts\n`);
});
