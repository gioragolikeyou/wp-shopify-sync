const ENTITY_KEY = { products:"product", orders:"order", customers:"customer" };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { shopify_domain, shopify_token, entity, payload, shopify_id, check_tag } = req.body;
  if (!shopify_domain || !shopify_token || !entity)
    return res.status(400).json({ error: "Parametri mancanti" });

  const domain = shopify_domain.replace(/^https?:\/\//, "").replace(/\/$/, "");

  // ── Dedup check per ORDINI ──────────────────────────────────────────────────
  if (entity === "check_order" && check_tag) {
    try {
      const url = `https://${domain}/admin/api/2024-01/orders.json?tag=${encodeURIComponent(check_tag)}&limit=1&status=any`;
      const r = await fetch(url, {
        headers: { "X-Shopify-Access-Token": shopify_token, "User-Agent": "WP-Shopify-SyncConsole/1.0" },
      });
      const data = await r.json();
      return res.status(200).json({ exists: Array.isArray(data.orders) && data.orders.length > 0 });
    } catch {
      return res.status(200).json({ exists: false });
    }
  }

  // ── Dedup check per PRODOTTI ────────────────────────────────────────────────
  // Cerca per tag wc_product_{id} — se esiste restituisce anche l'id Shopify
  // così possiamo fare PUT invece di POST (aggiornamento invece di duplicato)
  if (entity === "check_product" && check_tag) {
    try {
      const url = `https://${domain}/admin/api/2024-01/products.json?tag=${encodeURIComponent(check_tag)}&limit=1&published_status=any&fields=id,tags,title`;
      const r = await fetch(url, {
        headers: { "X-Shopify-Access-Token": shopify_token, "User-Agent": "WP-Shopify-SyncConsole/1.0" },
      });
      const data = await r.json();
      const found = Array.isArray(data.products) && data.products.length > 0;
      return res.status(200).json({
        exists: found,
        shopify_id: found ? data.products[0].id : null,
        title: found ? data.products[0].title : null,
      });
    } catch {
      return res.status(200).json({ exists: false, shopify_id: null });
    }
  }

  if (!payload || !ENTITY_KEY[entity])
    return res.status(400).json({ error: `Entità non valida: ${entity}` });

  let method = shopify_id ? "PUT" : "POST";
  let resolvedId = shopify_id;

  // ── Dedup clienti per email ─────────────────────────────────────────────────
  if (entity === "customers" && !shopify_id && payload.email) {
    try {
      const searchUrl = `https://${domain}/admin/api/2024-01/customers/search.json?query=email:${encodeURIComponent(payload.email)}&limit=1`;
      const searchRes = await fetch(searchUrl, { headers: { "X-Shopify-Access-Token": shopify_token } });
      const searchData = await searchRes.json();
      if (searchData.customers && searchData.customers.length > 0) {
        resolvedId = searchData.customers[0].id;
        method = "PUT";
      }
    } catch {}
  }

  const path = resolvedId
    ? `https://${domain}/admin/api/2024-01/${entity}/${resolvedId}.json`
    : `https://${domain}/admin/api/2024-01/${entity}.json`;

  try {
    const upstream = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": shopify_token,
        "User-Agent": "WP-Shopify-SyncConsole/1.0",
      },
      body: JSON.stringify({ [ENTITY_KEY[entity]]: payload }),
      signal: AbortSignal.timeout(25000),
    });
    const json = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: `Shopify ${upstream.status}`, detail: json?.errors || json });
    return res.status(200).json({ success: true, id: json[ENTITY_KEY[entity]]?.id, result: json[ENTITY_KEY[entity]] });
  } catch (err) {
    return res.status(502).json({ error: "Errore di rete", detail: err.message });
  }
}
