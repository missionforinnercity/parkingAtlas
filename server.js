require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { MongoClient } = require("mongodb");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.PORT || 3001);
const HEADERS = [
  "ID", "Facility", "Status", "Cross-checked (Yes/No)", "Date checked", "Corrections / comments",
  "Address / cross streets", "Precinct", "Latitude", "Longitude", "GPS match / note", "Inside map area?",
  "Type", "Owner / operator", "Hourly rate (ZAR)", "Daily / max rate (ZAR)", "Bays", "Size",
  "Opening hours", "Phone", "Email", "Website / booking", "Data date", "Source URL", "Notes"
];
const REQUIRED_ENV = ["MONGODB_URI", "MONGODB_DATABASE", "MONGODB_COLLECTION"];
const missingEnv = REQUIRED_ENV.filter(function (key) { return !process.env[key]; });
if (missingEnv.length) throw new Error("Missing required environment settings: " + missingEnv.join(", "));
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("PORT must be a valid TCP port.");

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
  maxPoolSize: 10
});
const db = client.db(process.env.MONGODB_DATABASE);
const spots = db.collection(process.env.MONGODB_COLLECTION);
const meta = db.collection("_parking_atlas_meta");

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch (error) {
    const invalid = new Error("Request body must be valid JSON.");
    invalid.status = 400;
    throw invalid;
  }
}

function cleanSpot(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    const error = new Error("A parking spot record is required.");
    error.status = 400;
    throw error;
  }
  const record = {};
  HEADERS.forEach(function (header) {
    let value = source[header];
    if (value === null || value === undefined) value = "";
    if (header === "Latitude" || header === "Longitude") {
      if (value === "") record[header] = "";
      else {
        const number = Number(value);
        const limit = header === "Latitude" ? 90 : 180;
        if (!Number.isFinite(number) || Math.abs(number) > limit) {
          const error = new Error(header + " must be a valid coordinate.");
          error.status = 400;
          throw error;
        }
        record[header] = number;
      }
    } else if (typeof value === "string") record[header] = value.slice(0, 10000);
    else if (typeof value === "number" && Number.isFinite(value)) record[header] = value;
    else record[header] = String(value).slice(0, 10000);
  });
  record.ID = String(source.ID || "").trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(record.ID)) {
    const error = new Error("Spot ID must use 1–40 letters, numbers, dashes, or underscores.");
    error.status = 400;
    throw error;
  }
  return record;
}

function storedRecord(record) {
  return Object.assign({ _id: record.ID }, record);
}

function publicRecord(record) {
  const copy = Object.assign({}, record);
  delete copy._id;
  return copy;
}

async function seedIfNeeded() {
  const markerId = "initial-spots-v1";
  const current = await meta.findOne({ _id: markerId });
  if (current && current.state === "complete") return;

  try {
    await meta.insertOne({ _id: markerId, state: "seeding", startedAt: new Date() });
  } catch (error) {
    if (error.code !== 11000) throw error;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const marker = await meta.findOne({ _id: markerId });
      if (marker && marker.state === "complete") return;
      if (marker && marker.state === "failed") break;
      await new Promise(function (resolve) { setTimeout(resolve, 200); });
    }
    const marker = await meta.findOne({ _id: markerId });
    if (marker && marker.state === "seeding") throw new Error("Parking spot setup is already running.");
    await meta.deleteOne({ _id: markerId });
    return seedIfNeeded();
  }

  try {
    const existingCount = await spots.countDocuments({});
    let seededCount = 0;
    if (existingCount === 0) {
      const seedPath = path.join(DIST, "spots.json");
      const input = JSON.parse(fs.readFileSync(seedPath, "utf8"));
      if (!Array.isArray(input)) throw new Error("The bundled parking data is invalid.");
      const records = input.map(cleanSpot);
      if (records.length) {
        await spots.insertMany(records.map(storedRecord), { ordered: true });
        seededCount = records.length;
      }
    }
    await meta.updateOne({ _id: markerId }, {
      $set: { state: "complete", completedAt: new Date(), seededCount: seededCount }
    });
    if (seededCount) console.log("Initialized shared parking data (" + seededCount + " records).");
  } catch (error) {
    await meta.updateOne({ _id: markerId }, { $set: { state: "failed", failedAt: new Date() } }).catch(function () {});
    throw error;
  }
}

async function parseSpotId(pathname) {
  const match = /^\/api\/spots\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); }
  catch (error) {
    const invalid = new Error("Spot ID is not valid.");
    invalid.status = 400;
    throw invalid;
  }
}

async function handleApi(req, res, url) {
  const mutating = req.method !== "GET" && req.method !== "HEAD";
  if (mutating && req.headers.origin) {
    const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const protocol = forwardedProtocol || (req.socket.encrypted ? "https" : "http");
    const expectedOrigin = protocol + "://" + req.headers.host;
    if (req.headers.origin !== expectedOrigin) return sendJson(res, 403, { error: "Cross-site changes are not allowed." });
  }
  if ((req.method === "POST" || req.method === "PUT") && !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
    return sendJson(res, 415, { error: "Send changes as JSON." });
  }

  if (url.pathname === "/api/health" && req.method === "GET") {
    await db.command({ ping: 1 });
    return sendJson(res, 200, { ok: true, spots: await spots.countDocuments({}) });
  }

  if (url.pathname === "/api/spots" && req.method === "GET") {
    const records = await spots.find({}).sort({ ID: 1 }).toArray();
    return sendJson(res, 200, records.map(publicRecord));
  }

  if (url.pathname === "/api/spots" && req.method === "POST") {
    const record = cleanSpot(await readJson(req));
    try { await spots.insertOne(storedRecord(record)); }
    catch (error) {
      if (error.code === 11000) return sendJson(res, 409, { error: "That spot ID is already in use." });
      throw error;
    }
    return sendJson(res, 201, record);
  }

  if (url.pathname === "/api/spots/import" && req.method === "PUT") {
    const body = await readJson(req);
    if (!body || !Array.isArray(body.spots) || body.spots.length > 5000) {
      return sendJson(res, 400, { error: "The import must contain a list of up to 5,000 parking spots." });
    }
    const records = body.spots.map(cleanSpot);
    const ids = new Set(records.map(function (record) { return record.ID; }));
    if (ids.size !== records.length) return sendJson(res, 400, { error: "Each spot in the import needs a unique ID." });
    if (!records.length) return sendJson(res, 400, { error: "The import does not contain any parking spots." });
    await spots.bulkWrite(records.map(function (record) {
      return { replaceOne: { filter: { _id: record.ID }, replacement: storedRecord(record), upsert: true } };
    }), { ordered: true });
    await spots.deleteMany({ _id: { $nin: Array.from(ids) } });
    return sendJson(res, 200, { ok: true, count: records.length });
  }

  const id = await parseSpotId(url.pathname);
  if (id !== null && req.method === "PUT") {
    const record = cleanSpot(await readJson(req));
    if (record.ID !== id) return sendJson(res, 400, { error: "The spot ID in the URL and record must match." });
    await spots.replaceOne({ _id: id }, storedRecord(record), { upsert: true });
    return sendJson(res, 200, record);
  }
  if (id !== null && req.method === "DELETE") {
    const result = await spots.deleteOne({ _id: id });
    if (!result.deletedCount) return sendJson(res, 404, { error: "That parking spot was not found." });
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: "API route not found." });
}

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

function serveFile(req, res, url) {
  let requestPath;
  try { requestPath = decodeURIComponent(url.pathname); }
  catch (error) { res.writeHead(400); res.end("Invalid path."); return; }
  if (requestPath === "/") requestPath = "/index.html";
  const filePath = path.resolve(DIST, "." + requestPath);
  if (!filePath.startsWith(DIST + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
    res.end("Not found.");
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": path.extname(filePath) === ".html" ? "no-cache" : "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch(function (error) {
      if (error.status) return sendJson(res, error.status, { error: error.message });
      console.error("Parking Atlas request failed:", error.name || "Error", error.code || "");
      if (!res.headersSent) sendJson(res, 500, { error: "The request could not be completed." });
      else res.end();
    });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Allow": "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed.");
    return;
  }
  serveFile(req, res, url);
});

async function start() {
  await client.connect();
  await db.command({ ping: 1 });
  await seedIfNeeded();
  server.listen(PORT, "0.0.0.0", function () {
    console.log("Parking Atlas listening on port " + PORT + ".");
  });
}

start().catch(async function (error) {
  console.error("Parking Atlas could not start:", error.name || "Error", error.code || "");
  await client.close().catch(function () {});
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async function () {
    server.close();
    await client.close().catch(function () {});
    process.exit(0);
  });
}
