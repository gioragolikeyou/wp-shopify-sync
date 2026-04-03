const ENTITY_KEY = { products: "product", orders: "order", customers: "customer" };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { shopify_domain, shopify_token, entity, payload, shopify_id } = req.body;
  if (!shopify_domain || !shopify_token || !entity || !payload)
    return res.status(400).json({ error: "Parametri mancanti" });
  if (!ENTITY_KEY[entity])
    return res.status(400).json({ error: `Entità non valida: ${entity}` });

  const domain  = shopify_domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const method  = shopify_id ? "PUT" : "POST";
  const path    = shopify_id
    ? `https://${domain}/admin/api/2024-01/${entity}/${shopify_id}.json`
    : `https://${domain}/admin/api/2024-01/${entity}.json`;

  try {
    const upstream = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shopify_token, "User-Agent": "WP-Shopify-SyncConsole/1.0" },
      body: JSON.stringify({ [ENTITY_KEY[entity]]: payload }),
      signal: AbortSignal.timeout(20000),
    });
    const json = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: `Shopify ${upstream.status}`, detail: json?.errors || json });
    return res.status(200).json({ success: true, id: json[ENTITY_KEY[entity]]?.id, result: json[ENTITY_KEY[entity]] });
  } catch (err) {
    return res.status(502).json({
      error: err.name === "TimeoutError" ? "Timeout Shopify" : "Errore di rete",
      detail: err.message,
    });
  }
}
