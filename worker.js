var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var META_PIXEL_ID = "1370562934621507";
var CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS", "Content-Type": "application/json" };

function corsR(request) {
  const origin = request.headers.get("Origin") || "*";
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS", "Content-Type": "application/json", "Vary": "Origin" };
}
__name(corsR, "corsR");

function slugify(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}
__name(slugify, "slugify");

async function getConfigObj(env) {
  const rows = await env.DB.prepare("SELECT key, value FROM config").all();
  const config = {};
  for (const r of rows.results) config[r.key] = r.value;
  return config;
}
__name(getConfigObj, "getConfigObj");

var worker_default = {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsR(request) });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/productos") {
        if (request.method === "GET") return getProductos(env);
        if (request.method === "POST") return postProductos(request, env);
      }
      if (url.pathname.startsWith("/api/productos/") && request.method === "PATCH") {
        const id = decodeURIComponent(url.pathname.slice("/api/productos/".length));
        return patchProductos(request, env, id);
      }
      if (url.pathname === "/api/config" && request.method === "GET") return getConfig(env);
      if (url.pathname === "/api/img" && request.method === "GET") return getImg(request, env);
      if (url.pathname === "/api/feed/meta.csv" && request.method === "GET") return getFeedMeta(env);
      if (url.pathname === "/api/feed/meta-gs.csv" && request.method === "GET") return getFeedMetaGs(env);
      if (url.pathname === "/api/track" && request.method === "POST") return track(request, env);
      return new Response(JSON.stringify({ error: "Ruta no encontrada" }), { status: 404, headers: CORS });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
    }
  }
};

async function getProductos(env) {
  const db = env.DB;
  const prods = await db.prepare("SELECT id, name, category, price_usd, img, sort, status, fragrantica FROM productos WHERE visible = 1 ORDER BY category ASC, sort ASC, name ASC").all();
  const config = await getConfigObj(env);
  return new Response(JSON.stringify({
    version: 2,
    productos: prods.results.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category || "",
      price_usd: p.price_usd == null ? 0 : Number(p.price_usd),
      img: p.img || "",
      sort: p.sort || 0,
      status: p.status === "out_of_stock" ? "out_of_stock" : "active",
      fragrantica: p.fragrantica || ""
    })),
    config: {
      rate_gs: Number(config.rate_gs || 0),
      rate_ars: Number(config.rate_ars || 0),
      phone: config.phone || "",
      instagram: config.instagram || "",
      title: config.title || "",
      price_note: config.price_note || "",
      monedas: config.monedas || "US$,Gs.,ARS",
      whatsapp_channel: config.whatsapp_channel || "https://whatsapp.com/channel/0029VbDaI1kIHphK6ZUvMG1T"
    }
  }), { status: 200, headers: CORS });
}
__name(getProductos, "getProductos");

async function getConfig(env) {
  const config = await getConfigObj(env);
  return new Response(JSON.stringify({
    rate_gs: Number(config.rate_gs || 0),
    rate_ars: Number(config.rate_ars || 0),
    phone: config.phone || "",
    instagram: config.instagram || "",
    title: config.title || "",
    price_note: config.price_note || "",
    monedas: config.monedas || "US$,Gs.,ARS",
    whatsapp_channel: config.whatsapp_channel || "https://whatsapp.com/channel/0029VbDaI1kIHphK6ZUvMG1T"
  }), { status: 200, headers: CORS });
}
__name(getConfig, "getConfig");

function auth(req, env) {
  const token = req.headers.get("Authorization") || "";
  const expected = env.PUBLISH_TOKEN || "";
  if (!expected || !token.startsWith("Bearer ") || token.slice(7) !== expected) return false;
  return true;
}
__name(auth, "auth");

async function postProductos(request, env) {
  const db = env.DB;
  if (!auth(request, env)) {
    return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: CORS });
  }
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.productos)) {
    return new Response(JSON.stringify({ error: "Body invalido: falta productos" }), { status: 400, headers: CORS });
  }
  const cat = String(body.categoria || "").trim();
  const now = new Date().toISOString();
  const existing = await db.prepare("SELECT id, name, price_usd, img, sort, visible, status FROM productos WHERE category = ?").bind(cat).all();
  const byKey = new Map();
  for (const e of existing.results) byKey.set(slugify(e.name), e);
  const touched = new Set();
  const stmts = [];
  let inserts = 0;
  let updates = 0;
  for (let i = 0; i < body.productos.length; i++) {
    const p = body.productos[i];
    const name = String(p.name || "").slice(0, 200).trim();
    if (!name) continue;
    const price = Number(p.price_usd) || 0;
    const key = slugify(name);
    const ex = byKey.get(key);
    if (ex) {
      touched.add(key);
      if (ex.price_usd !== price || (ex.sort || 0) !== i || ex.status !== "active") {
        stmts.push(db.prepare("UPDATE productos SET price_usd = ?, sort = ?, status = 'active', updated_at = ? WHERE id = ?").bind(price, i, now, ex.id));
        updates++;
      }
    } else {
      stmts.push(db.prepare("INSERT INTO productos (id, name, price_usd, img, sort, visible, category, status, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, 'active', ?)").bind(String(p.id || key), name, price, String(p.img || ""), i, cat, now));
      inserts++;
    }
  }
  for (const [key, e] of byKey) {
    if (!touched.has(key) && (e.status || "active") !== "out_of_stock") {
      stmts.push(db.prepare("UPDATE productos SET status = 'out_of_stock', updated_at = ? WHERE id = ?").bind(now, e.id));
      updates++;
    }
  }
  if (stmts.length) await db.batch(stmts);
  const cfg = body.config || {};
  const configSet = [["rate_gs", cfg.rate_gs != null ? String(cfg.rate_gs) : ""], ["rate_ars", cfg.rate_ars != null ? String(cfg.rate_ars) : ""], ["phone", cfg.phone || ""], ["instagram", cfg.instagram || ""], ["title", cfg.title || ""], ["price_note", cfg.price_note || ""], ["monedas", cfg.monedas || "US$,Gs.,ARS"], ["whatsapp_channel", cfg.whatsapp_channel || "https://whatsapp.com/channel/0029VbDaI1kIHphK6ZUvMG1T"], ["updated_at", now]];
  await db.batch(configSet.map(([k, v]) => db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, v)));
  return new Response(JSON.stringify({ success: true, categoria: cat, insertados: inserts, actualizados: updates, total: body.productos.length }), { status: 200, headers: CORS });
}
__name(postProductos, "postProductos");

async function patchProductos(request, env, id) {
  const db = env.DB;
  if (!auth(request, env)) {
    return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: CORS });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !id) {
    return new Response(JSON.stringify({ error: "Body invalido" }), { status: 400, headers: CORS });
  }
  const sets = [];
  const vals = [];
  if (body.name !== undefined) { sets.push("name = ?"); vals.push(String(body.name).slice(0, 200)); }
  if (body.price_usd !== undefined) { sets.push("price_usd = ?"); vals.push(Number(body.price_usd) || 0); }
  if (body.status !== undefined) {
    const st = body.status === "out_of_stock" ? "out_of_stock" : "active";
    sets.push("status = ?"); vals.push(st);
  }
  if (body.img !== undefined) { sets.push("img = ?"); vals.push(String(body.img || "")); }
  if (body.fragrantica !== undefined) { sets.push("fragrantica = ?"); vals.push(String(body.fragrantica || "").slice(0, 400)); }
  if (body.notes !== undefined) { sets.push("notes = ?"); vals.push(String(body.notes || "").slice(0, 1000)); }
  if (body.category !== undefined) { sets.push("category = ?"); vals.push(String(body.category || "").trim()); }
  if (body.visible !== undefined) { sets.push("visible = ?"); vals.push(body.visible ? 1 : 0); }
  if (!sets.length) return new Response(JSON.stringify({ error: "No hay campos para actualizar" }), { status: 400, headers: CORS });
  sets.push("updated_at = ?");
  vals.push(new Date().toISOString());
  const res = await db.prepare("UPDATE productos SET " + sets.join(", ") + " WHERE id = ?").bind(...vals, id).run();
  return new Response(JSON.stringify({ success: res.meta.changes > 0, changed: res.meta.changes }), { status: 200, headers: CORS });
}
__name(patchProductos, "patchProductos");

async function getImg(request, env) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return new Response(JSON.stringify({ error: "Falta id" }), { status: 400, headers: CORS });
  const row = await env.DB.prepare("SELECT img FROM productos WHERE id = ?").bind(id).first();
  if (!row || !row.img) return new Response(JSON.stringify({ error: "Imagen no encontrada" }), { status: 404, headers: CORS });
  const img = row.img;
  let mime = "image/jpeg";
  let b64 = img;
  const m = img.match(/^data:([^;,]+);base64,/);
  if (m) { mime = m[1]; b64 = img.slice(m[0].length); }
  const raw = atob(b64);
  const bin = new Uint8Array(raw.length);
  for (let i = 0; i < bin.length; i++) bin[i] = raw.charCodeAt(i);
  return new Response(bin, { status: 200, headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*" } });
}
__name(getImg, "getImg");

async function getFeedMeta(env) {
  const db = env.DB;
  const prods = await db.prepare("SELECT id, name, price_usd FROM productos WHERE visible = 1 AND status = 'active' ORDER BY sort ASC, name ASC").all();
  const config = await getConfigObj(env);
  const rate_ars = Number(config.rate_ars || 0);
  const LINK = "https://sublime-perfumeria.pages.dev/tienda";
  const IMG = "https://sublime-api.sobresirian2.workers.dev/api/img?id=";
  const CAT = "Beauty & Health > Fragrance > Perfume & Cologne";
  const esc = __name((s) => '"' + String(s).replace(/"/g, '""') + '"', "esc");
  const lines = ["id,title,description,availability,condition,price,link,image_link,brand,google_product_category,identifier_exists"];
  for (const p of prods.results) {
    const name = (p.name || "").trim();
    const price = Math.round((Number(p.price_usd) || 0) * rate_ars * 100) / 100;
    const brand = name.split(" ")[0] || "SUBLIME";
    const title = name || "Perfume SUBLIME";
    const desc = "Perfume " + title + " original. Venta mayorista de SUBLIME Perfumería.";
    lines.push([p.id, title, desc, "in stock", "new", price.toFixed(2) + " ARS", LINK, IMG + p.id, brand, CAT, "FALSE"].map(esc).join(","));
  }
  return new Response(lines.join("\n"), { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "public, max-age=2700", "Access-Control-Allow-Origin": "*" } });
}
__name(getFeedMeta, "getFeedMeta");

async function getFeedMetaGs(env) {
  const db = env.DB;
  const prods = await db.prepare("SELECT id, name, price_usd FROM productos WHERE visible = 1 AND status = 'active' ORDER BY sort ASC, name ASC").all();
  const config = await getConfigObj(env);
  const rate_gs = Number(config.rate_gs || 0);
  const DISCOUNT_GS_USD = 2;
  const LINK = "https://sublime-perfumeria.pages.dev/tienda";
  const IMG = "https://sublime-api.sobresirian2.workers.dev/api/img?id=";
  const CAT = "Beauty & Health > Fragrance > Perfume & Cologne";
  const esc = __name((s) => '"' + String(s).replace(/"/g, '""') + '"', "esc");
  const lines = ["id,title,description,availability,condition,price,link,image_link,brand,google_product_category,identifier_exists"];
  for (const p of prods.results) {
    const name = (p.name || "").trim();
    const usd = Number(p.price_usd) || 0;
    const gs = Math.round((usd - DISCOUNT_GS_USD) * rate_gs);
    const brand = name.split(" ")[0] || "SUBLIME";
    const title = name || "Perfume SUBLIME";
    const desc = "Perfume " + title + " original. Venta mayorista de SUBLIME Perfumería.";
    lines.push([p.id, title, desc, "in stock", "new", gs + " Gs.", LINK, IMG + p.id, brand, CAT, "FALSE"].map(esc).join(","));
  }
  return new Response(lines.join("\n"), { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "public, max-age=2700", "Access-Control-Allow-Origin": "*" } });
}
__name(getFeedMetaGs, "getFeedMetaGs");

async function track(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !body.event_name) {
    return new Response(JSON.stringify({ error: "Body invalido: falta event_name" }), { status: 400, headers: corsR(request) });
  }
  const token = env.META_ACCESS_TOKEN;
  if (!token) return new Response(JSON.stringify({ error: "Falta META_ACCESS_TOKEN" }), { status: 500, headers: corsR(request) });
  const eventName = String(body.event_name);
  const allowed = ["ViewContent", "AddToCart", "InitiateCheckout", "Purchase", "PageView"];
  if (!allowed.includes(eventName)) {
    return new Response(JSON.stringify({ error: "event_name no permitido: " + eventName }), { status: 400, headers: corsR(request) });
  }
  const eventTime = body.event_time || Math.floor(Date.now() / 1e3);
  const customData = {};
  if (body.value != null) customData.value = Number(body.value);
  if (body.currency) customData.currency = String(body.currency);
  if (body.content_ids) customData.content_ids = body.content_ids;
  if (body.content_name) customData.content_name = String(body.content_name);
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ua = request.headers.get("User-Agent") || "";
  const userData = Object.assign({}, body.user_data || {});
  if (ip) userData.client_ip_address = ip;
  if (ua) userData.client_user_agent = ua;
  const dedupe = body.event_id || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const metaPayload = {
    data: [{
      event_name: eventName,
      event_time: eventTime,
      event_id: body.event_id || void 0,
      user_data: userData,
      custom_data: customData,
      action_source: body.action_source || "website"
    }]
  };
  const url = `https://graph.facebook.com/v20.0/${META_PIXEL_ID}/events?access_token=${token}${body.test_event_code ? `&test_event_code=${encodeURIComponent(body.test_event_code)}` : ""}`;
  const mres = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metaPayload)
  });
  const mtext = await mres.text();
  let mjson = null;
  try { mjson = JSON.parse(mtext); } catch (e) { mjson = mtext; }
  return new Response(JSON.stringify({ meta_status: mres.status, meta_response: mjson, event_id: dedupe }), { status: 200, headers: corsR(request) });
}
__name(track, "track");

export {
  worker_default as default
};