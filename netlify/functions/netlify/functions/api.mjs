// Family Christmas Lists — API
// Storage: Netlify Blobs (one key per list and per item, so two people saving at once don't overwrite each other).
// Editing needs the EDIT_KEY environment variable (set in Netlify > Site configuration > Environment variables).
// Anyone with the site link can view lists and mark gifts as bought.
import { getStore } from "@netlify/blobs";

const store = () => getStore({ name: "christmas-lists", consistency: "strong" });

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const bad = (msg, status = 400) => json({ error: msg }, status);

const newId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-5);
const clean = (s, n = 200) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const cents = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : null;
};
const httpUrl = (u) => {
  try {
    const x = new URL(String(u || "").trim());
    return /^https?:$/.test(x.protocol) ? x.href : "";
  } catch {
    return "";
  }
};
const imageRef = (v) => {
  const s = String(v || "");
  if (/^\/api\/img\/[a-z0-9]+$/i.test(s)) return s;
  return httpUrl(s).slice(0, 2000);
};

function isEditor(req) {
  const key = process.env.EDIT_KEY;
  if (!key) return false;
  const given = req.headers.get("x-edit-key") || "";
  if (given.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

async function readAll(s, prefix) {
  const { blobs } = await s.list({ prefix }); // returns every page when not paginating
  const out = blobs.map((b) => b.key);
  const docs = await Promise.all(out.map((k) => s.get(k, { type: "json" })));
  return docs.filter(Boolean);
}

async function body(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/* ---------- link preview: photo, name and price from a product page ---------- */
const decode = (s) =>
  String(s || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, " ").trim();

function meta(html, names) {
  for (const name of names) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${name}["']`, "i");
    const m = html.match(re1) || html.match(re2);
    if (m && m[1]) return decode(m[1]);
  }
  return "";
}

function jsonLdProducts(html) {
  const found = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const t = node["@type"];
    if (t === "Product" || (Array.isArray(t) && t.includes("Product")) || t === "ProductGroup") found.push(node);
    if (node["@graph"]) walk(node["@graph"]);
    if (node.hasVariant) walk(node.hasVariant);
  };
  while ((m = re.exec(html))) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* skip bad blocks */ }
  }
  return found;
}

function pickImage(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return pickImage(v[0]);
  return v.url || v.contentUrl || "";
}
function pickPrice(offers) {
  if (!offers) return null;
  if (Array.isArray(offers)) {
    for (const o of offers) { const p = pickPrice(o); if (p != null) return p; }
    return null;
  }
  const raw = offers.price ?? offers.lowPrice ?? offers.priceSpecification?.price;
  const n = parseFloat(String(raw ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function blockedHost(host) {
  const h = host.toLowerCase();
  return (
    h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.startsWith("[")
  );
}

// Amazon blocks page fetches, but its product photos are reachable by product ID (ASIN).
function amazonImage(u) {
  try {
    const x = new URL(u);
    if (!/(^|\.)amazon\.[a-z.]+$/i.test(x.hostname)) return "";
    const m = x.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})/i);
    return m ? `https://m.media-amazon.com/images/P/${m[1].toUpperCase()}.01._SCLZZZZZZZ_.jpg` : "";
  } catch { return ""; }
}

async function imageWorks(src) {
  try {
    const r = await fetch(src, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(6000) });
    const len = Number(r.headers.get("content-length") || 0);
    const buf = len ? null : await r.arrayBuffer();
    return r.ok && /^image\//.test(r.headers.get("content-type") || "") && (len || buf.byteLength) > 1500;
  } catch { return false; }
}

// Backup: a free link-preview service that opens the page in a real browser (about 50 lookups a day).
async function microlink(url) {
  try {
    const r = await fetch("https://api.microlink.io/?url=" + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
    const d = await r.json();
    if (d.status !== "success" || !d.data) return {};
    const logo = d.data.logo?.url || "";
    let image = d.data.image?.url || "";
    if (image && (image === logo || /logo|sprite|prime/i.test(image))) image = "";
    return { image, title: decode(d.data.title || "") };
  } catch { return {}; }
}

const BLOCK_TITLE = /captcha|robot check|access denied|just a moment|attention required|page not found|not found|are you a human|security check/i;

function tidyTitle(t, u) {
  t = decode(t).replace(/^Amazon\.com\s*:\s*/i, "");
  t = t.split(/\s+\|\s+/)[0].trim();
  const site = (() => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  if (!t || t.toLowerCase() === site.toLowerCase() || /^(amazon(\.com)?|walmart(\.com)?|target|etsy|best buy)$/i.test(t) || BLOCK_TITLE.test(t)) return "";
  return t.slice(0, 140);
}

async function preview(url) {
  const r = await directPreview(url).catch(() => ({ image: "", title: "", price: null, blocked: true, finalUrl: url }));
  const finalUrl = r.finalUrl || url;
  r.title = tidyTitle(r.title, finalUrl);
  const amz = amazonImage(finalUrl) || amazonImage(url);
  if (amz && (await imageWorks(amz))) r.image = amz;
  if (!r.image || !r.title) {
    const m = await microlink(finalUrl);
    if (!r.image && m.image) r.image = m.image;
    if (!r.title && m.title) r.title = tidyTitle(m.title, finalUrl);
  }
  return { image: r.image || "", title: r.title || "", price: r.price ?? null, blocked: !r.image && !r.title };
}

async function directPreview(url) {
  const target = new URL(url);
  if (blockedHost(target.hostname)) throw new Error("blocked");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  let html = "";
  let finalUrl = url;
  let status = 200;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    finalUrl = res.url || url;
    status = res.status;
    const text = await res.text();
    html = text.slice(0, 3_000_000);
  } finally {
    clearTimeout(timer);
  }

  const products = jsonLdProducts(html);
  const p = products[0] || {};

  let image =
    meta(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]) ||
    pickImage(p.image) ||
    (html.match(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i) || [])[1] ||
    (html.match(/data-old-hires=["']([^"']+)["']/i) || [])[1] ||
    (html.match(/"hiRes":"(https:[^"]+)"/) || [])[1] ||
    (html.match(/id=["']landingImage["'][^>]*src=["']([^"']+)["']/i) || [])[1] ||
    "";
  if (image) {
    try { image = new URL(decode(image), finalUrl).href; } catch { image = ""; }
  }

  let title = decode(p.name) || meta(html, ["og:title", "twitter:title"]) ||
    decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  title = title.replace(/\s*[|:–-]\s*(Amazon\.com|Target|Walmart\.com|Best Buy|Etsy).*$/i, "").replace(/^Amazon\.com:\s*/i, "").slice(0, 140);

  let price = pickPrice(p.offers);
  if (price == null) {
    const m = meta(html, ["product:price:amount", "og:price:amount", "price"]);
    const n = parseFloat(String(m).replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) price = Math.round(n * 100);
  }
  if (price == null) {
    const m = html.match(/class=["']a-offscreen["'][^>]*>\s*\$([\d,]+\.\d{2})/);
    if (m) price = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
  }

  const blocked = status >= 400 || (!image && !title) || BLOCK_TITLE.test(title);
  return blocked ? { image: "", title: "", price: null, blocked: true, finalUrl } : { image, title, price, blocked: false, finalUrl };
}

/* ---------- router ---------- */
export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [res, id, sub] = parts;
  const method = req.method;
  const s = store();
  const editor = isEditor(req);
  const needEdit = () => (editor ? null : bad("Only the list owner can make that change.", 403));

  try {
    // Photos
    if (res === "img" && id && method === "GET") {
      const entry = await s.getWithMetadata("img/" + id, { type: "arrayBuffer" });
      if (!entry) return new Response("Not found", { status: 404 });
      return new Response(entry.data, {
        headers: {
          "content-type": entry.metadata?.type || "image/jpeg",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    }

    if (res === "state" && method === "GET") {
      const [lists, items, settings] = await Promise.all([
        readAll(s, "lists/"),
        readAll(s, "items/"),
        s.get("settings", { type: "json" }),
      ]);
      return json({ lists, items, settings: settings || {}, canEdit: editor, editSetUp: !!process.env.EDIT_KEY });
    }

    if (res === "auth" && method === "POST") return json({ ok: editor });

    if (res === "settings" && method === "POST") {
      const deny = needEdit(); if (deny) return deny;
      const b = await body(req);
      const current = (await s.get("settings", { type: "json" })) || {};
      const next = { ...current, title: clean(b.title, 60) || current.title || "" };
      await s.setJSON("settings", next);
      return json(next);
    }

    if (res === "lists") {
      const deny = needEdit(); if (deny) return deny;
      if (method === "POST" && !id) {
        const b = await body(req);
        const existing = await readAll(s, "lists/");
        const count = Math.max(0, Math.min(30, parseInt(b.count, 10) || 0));
        const made = [];
        for (let k = existing.length; k < count; k++) {
          const doc = { id: newId(), name: "Family member " + (k + 1), order: k, createdAt: Date.now() + k };
          await s.setJSON("lists/" + doc.id, doc);
          made.push(doc);
        }
        return json({ created: made });
      }
      if (!id) return bad("Missing list id");
      const doc = await s.get("lists/" + id, { type: "json" });
      if (!doc) return bad("That list no longer exists.", 404);
      if (method === "PATCH") {
        const b = await body(req);
        if (b.name !== undefined) doc.name = clean(b.name, 60) || doc.name;
        await s.setJSON("lists/" + id, doc);
        return json(doc);
      }
      if (method === "DELETE") {
        const items = (await readAll(s, "items/")).filter((i) => i.listId === id);
        await Promise.all(items.map((i) => s.delete("items/" + i.id)));
        await s.delete("lists/" + id);
        return json({ ok: true });
      }
    }

    if (res === "items") {
      // Marking bought is open to everyone with the link.
      if (id && sub === "bought" && method === "POST") {
        const b = await body(req);
        const doc = await s.get("items/" + id, { type: "json" });
        if (!doc) return bad("That gift was removed from the list.", 404);
        doc.purchased = !!b.purchased;
        doc.purchasedBy = doc.purchased ? clean(b.by, 40) : "";
        doc.purchasedAt = doc.purchased ? Date.now() : null;
        await s.setJSON("items/" + id, doc);
        return json(doc);
      }
      const deny = needEdit(); if (deny) return deny;
      if (method === "POST" && !id) {
        const b = await body(req);
        const list = await s.get("lists/" + clean(b.listId, 40), { type: "json" });
        if (!list) return bad("That list no longer exists.", 404);
        const doc = {
          id: newId(), listId: list.id, url: httpUrl(b.url), title: clean(b.title, 140), size: clean(b.size, 30),
          price: cents(b.price), image: imageRef(b.image), purchased: false, purchasedBy: "", createdAt: Date.now(),
        };
        await s.setJSON("items/" + doc.id, doc);
        return json(doc);
      }
      if (!id) return bad("Missing item id");
      const doc = await s.get("items/" + id, { type: "json" });
      if (!doc) return bad("That gift was removed from the list.", 404);
      if (method === "PATCH") {
        const b = await body(req);
        if (b.url !== undefined) doc.url = httpUrl(b.url);
        if (b.title !== undefined) doc.title = clean(b.title, 140);
        if (b.size !== undefined) doc.size = clean(b.size, 30);
        if (b.price !== undefined) doc.price = cents(b.price);
        if (b.image !== undefined) doc.image = imageRef(b.image);
        await s.setJSON("items/" + id, doc);
        return json(doc);
      }
      if (method === "DELETE") {
        if (/^\/api\/img\//.test(doc.image || "")) await s.delete("img/" + doc.image.split("/").pop());
        await s.delete("items/" + id);
        return json({ ok: true });
      }
    }

    if (res === "upload" && method === "POST") {
      const deny = needEdit(); if (deny) return deny;
      const type = req.headers.get("content-type") || "";
      if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return bad("Upload a JPG, PNG, WebP or GIF image.");
      const buf = await req.arrayBuffer();
      if (buf.byteLength > 4_500_000) return bad("That photo is too large. Try a smaller one.");
      const key = newId();
      await s.set("img/" + key, buf, { metadata: { type } });
      return json({ image: "/api/img/" + key });
    }

    if (res === "preview" && method === "POST") {
      const deny = needEdit(); if (deny) return deny;
      const b = await body(req);
      const target = httpUrl(b.url);
      if (!target) return bad("That link doesn't look right.");
      try {
        return json(await preview(target));
      } catch {
        return json({ image: "", title: "", price: null, blocked: true });
      }
    }

    return bad("Not found", 404);
  } catch (err) {
    console.error(err);
    return bad("Something went wrong saving that. Try again.", 500);
  }
};

export const config = { path: "/api/*" };
