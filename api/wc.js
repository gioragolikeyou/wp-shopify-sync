const ALLOWED = ["products", "orders", "customers", "products/categories"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { wp_url, wp_key, wp_secret, entity, per_page = 100, page = 1, category, after, before } = req.body;
  if (!wp_url || !wp_key || !wp_secret || !entity)
    return res.status(400).json({ error: "Parametri mancanti" });
  if (!ALLOWED.includes(entity))
    return res.status(400).json({ error: `Entità non valida: ${entity}` });

  const base = wp_url.replace(/\/$/, "");
  const params = new URLSearchParams({
    consumer_key: wp_key,
    consumer_secret: wp_secret,
    per_page: String(Math.min(parseInt(per_page) || 100, 100)),
    page: String(page),
  });

  // orderby=date solo per products e orders, non customers
  if (entity !== "customers" && entity !== "products/categories") {
    params.set("orderby", "date");
    params.set("order", "desc");
  }

  if (category && entity === "products") params.set("category", String(category));
  if (after)  params.set("after",  after);
  if (before) params.set("before", before);

  const url = `${base}/wp-json/wc/v3/${entity}?${params.toString()}`;
  try {
    const upstream = await fetch(url, {
      headers: { "User-Agent": "WP-Shopify-SyncConsole/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!upstream.ok) {
      const body = await upstream.text();
      return res.status(upstream.status).json({ error: `WooCommerce ${upstream.status}`, detail: body.slice(0,500) });
    }
    const data = await upstream.json();
    const total = parseInt(upstream.headers.get("x-wp-total") || "0");
    const totalPages = parseInt(upstream.headers.get("x-wp-totalpages") || "1");
    return res.status(200).json({ data, total, totalPages, page });
  } catch (err) {
    return res.status(502).json({
      error: err.name === "TimeoutError" ? "Timeout" : "Errore di rete",
      detail: err.message,
    });
  }
}
