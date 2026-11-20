// KUNA.SKYSTREAM — API для каталога и админ-панели.
// Данные каталога и загруженные фото хранятся в Cloudflare KV (binding CATALOG).
// Пароль админки — секрет ADMIN_PASSWORD (Settings → Variables and Secrets).

const MAX_CATALOG_BYTES = 200 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return new Uint8Array(buf);
}

async function isAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const h = request.headers.get("authorization") || "";
  const given = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!given) return false;
  const a = await sha256(given);
  const b = await sha256(env.ADMIN_PASSWORD);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function denied() {
  await new Promise((r) => setTimeout(r, 800)); // замедляем подбор пароля
  return json({ error: "Неверный пароль" }, 401);
}

function cleanStr(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function cleanPhoto(p) {
  return typeof p === "string" && /^(img\/[\w.-]+|\/u\/[\w-]+)$/.test(p) ? p : null;
}
function cleanItem(it, withPoints) {
  const out = {
    id: cleanStr(it.id, 40) || crypto.randomUUID().slice(0, 8),
    name: cleanStr(it.name, 80),
    price: Math.max(0, Math.round(Number(it.price) || 0)),
    inStock: !!it.inStock,
    desc: cleanStr(it.desc, 400),
    photos: (Array.isArray(it.photos) ? it.photos : []).map(cleanPhoto).filter(Boolean).slice(0, 8),
  };
  if (withPoints) out.points = (Array.isArray(it.points) ? it.points : []).map((p) => cleanStr(p, 120)).filter(Boolean).slice(0, 6);
  return out;
}
function cleanCatalog(d) {
  if (!d || typeof d !== "object") throw new Error("bad");
  return {
    phone: cleanStr(d.phone, 20).replace(/\D/g, ""),
    kits: (Array.isArray(d.kits) ? d.kits : []).slice(0, 30).map((k) => cleanItem(k, true)),
    accessories: (Array.isArray(d.accessories) ? d.accessories : []).slice(0, 50).map((a) => cleanItem(a, false)),
    updatedAt: new Date().toISOString(),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Публичное чтение каталога
    if (path === "/api/catalog" && method === "GET") {
      const data = await env.CATALOG.get("catalog");
      return data
        ? new Response(data, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } })
        : json(null);
    }

    // Проверка пароля
    if (path === "/api/login" && method === "POST") {
      if (!env.ADMIN_PASSWORD) return json({ error: "Пароль админки ещё не задан в Cloudflare (ADMIN_PASSWORD)" }, 503);
      return (await isAdmin(request, env)) ? json({ ok: true }) : denied();
    }

    // Сохранение каталога
    if (path === "/api/catalog" && method === "PUT") {
      if (!(await isAdmin(request, env))) return denied();
      const text = await request.text();
      if (text.length > MAX_CATALOG_BYTES) return json({ error: "Слишком большой каталог" }, 413);
      let data;
      try { data = cleanCatalog(JSON.parse(text)); } catch { return json({ error: "Неверные данные" }, 400); }
      const prev = await env.CATALOG.get("catalog");
      if (prev) await env.CATALOG.put("catalog:backup", prev);
      await env.CATALOG.put("catalog", JSON.stringify(data));
      return json({ ok: true, catalog: data });
    }

    // Загрузка фото
    if (path === "/api/upload" && method === "POST") {
      if (!(await isAdmin(request, env))) return denied();
      const type = (request.headers.get("content-type") || "").split(";")[0];
      if (!IMAGE_TYPES.includes(type)) return json({ error: "Нужен JPG, PNG или WEBP" }, 415);
      const body = await request.arrayBuffer();
      if (body.byteLength > MAX_IMAGE_BYTES) return json({ error: "Фото больше 3 МБ" }, 413);
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      await env.CATALOG.put("img:" + id, body, { metadata: { type } });
      return json({ ok: true, url: "/u/" + id });
    }

    // Отдача загруженных фото
    const m = path.match(/^\/u\/([\w-]+)$/);
    if (m && method === "GET") {
      const { value, metadata } = await env.CATALOG.getWithMetadata("img:" + m[1], "arrayBuffer");
      if (!value) return new Response("Not found", { status: 404 });
      return new Response(value, {
        headers: { "content-type": (metadata && metadata.type) || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
      });
    }

    if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
