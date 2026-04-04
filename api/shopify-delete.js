// api/shopify-delete.js — cancella ordini/prodotti/clienti da Shopify
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { shopify_domain, shopify_token, entity, tag_filter } = req.body;
  if (!shopify_domain || !shopify_token || !entity)
    return res.status(400).json({ error: "Parametri mancanti" });

  const domain = shopify_domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const apiBase = `https://${domain}/admin/api/2024-01`;
  const headers = { "X-Shopify-Access-Token": shopify_token, "Content-Type": "application/json", "User-Agent": "WP-Shopify-SyncConsole/1.0" };

  try {
    // Fetch tutti gli ID da cancellare
    let ids = [];
    let page_info = null;
    do {
      let url = `${apiBase}/${entity}.json?limit=250&status=any`;
      if (tag_filter) url += `&tag=${encodeURIComponent(tag_filter)}`;
      if (page_info)  url += `&page_info=${page_info}`;
      const r = await fetch(url, { headers });
      const data = await r.json();
      const items = data[entity] || [];
      ids = [...ids, ...items.map(i => i.id)];
      // paginazione link header
      const link = r.headers.get("link") || "";
      const next = link.match(/page_info=([^&>]+)[^>]*>;\s*rel="next"/);
      page_info = next ? next[1] : null;
    } while (page_info);

    // Cancella uno per uno
    let deleted = 0, failed = 0;
    for (const id of ids) {
      const r = await fetch(`${apiBase}/${entity}/${id}.json`, { method: "DELETE", headers });
      if (r.ok || r.status === 200 || r.status === 204) deleted++;
      else failed++;
      await new Promise(r => setTimeout(r, 300));
    }
    return res.status(200).json({ deleted, failed, total: ids.length });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
