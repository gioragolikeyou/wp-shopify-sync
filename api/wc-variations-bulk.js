// api/wc-variations-bulk.js
// Fetcha varianti di più prodotti in una sola chiamata server-side
// Evita timeout del browser su cataloghi grandi

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { wp_url, wp_key, wp_secret, product_ids } = req.body;
  if (!wp_url || !wp_key || !wp_secret || !Array.isArray(product_ids))
    return res.status(400).json({ error: "Parametri mancanti" });

  const base = wp_url.replace(/\/$/, "");
  const basicAuth = "Basic " + Buffer.from(`${wp_key}:${wp_secret}`).toString("base64");
  const headers = { "Authorization": basicAuth, "User-Agent": "WP-Shopify-SyncConsole/1.0" };

  const results = {}; // { product_id: [variations] }

  for (const product_id of product_ids) {
    try {
      const url = `${base}/wp-json/wc/v3/products/${product_id}/variations?per_page=100&page=1`;
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
      if (!r.ok) {
        results[product_id] = [];
        continue;
      }
      const data = await r.json();
      results[product_id] = Array.isArray(data) ? data : [];
    } catch {
      results[product_id] = [];
    }
    // Pausa tra richieste per non sovraccaricare WC
    await new Promise(r => setTimeout(r, 300));
  }

  return res.status(200).json({ results });
}
