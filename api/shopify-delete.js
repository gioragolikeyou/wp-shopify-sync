export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { shopify_domain, shopify_token, entity } = req.body;
  if (!shopify_domain || !shopify_token || !entity)
    return res.status(400).json({ error: "Parametri mancanti" });

  const domain  = shopify_domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const apiBase = `https://${domain}/admin/api/2024-01`;
  const headers = { "X-Shopify-Access-Token": shopify_token, "Content-Type": "application/json" };

  try {
    let ids = [];
    let url;

    if (entity === "products") {
      // Cancella SOLO prodotti con tag wc_product_* (importati dalla console)
      url = `${apiBase}/products.json?limit=250&published_status=any&fields=id,tags`;
      while (url) {
        const r = await fetch(url, { headers });
        const data = await r.json();
        const filtered = (data.products || [])
          .filter(p => p.tags && p.tags.includes("wc_product_"))
          .map(p => p.id);
        ids = [...ids, ...filtered];
        const link = r.headers.get("link") || "";
        const next = link.match(/page_info=([^&>]+)[^>]*>;\s*rel="next"/);
        url = next ? `${apiBase}/products.json?limit=250&published_status=any&fields=id,tags&page_info=${next[1]}` : null;
      }
    } else if (entity === "orders") {
      url = `${apiBase}/orders.json?limit=250&status=any`;
      while (url) {
        const r = await fetch(url, { headers });
        const data = await r.json();
        ids = [...ids, ...(data.orders || []).map(i => i.id)];
        const link = r.headers.get("link") || "";
        const next = link.match(/page_info=([^&>]+)[^>]*>;\s*rel="next"/);
        url = next ? `${apiBase}/orders.json?limit=250&status=any&page_info=${next[1]}` : null;
      }
    } else if (entity === "customers") {
      url = `${apiBase}/customers.json?limit=250`;
      while (url) {
        const r = await fetch(url, { headers });
        const data = await r.json();
        ids = [...ids, ...(data.customers || []).map(i => i.id)];
        const link = r.headers.get("link") || "";
        const next = link.match(/page_info=([^&>]+)[^>]*>;\s*rel="next"/);
        url = next ? `${apiBase}/customers.json?limit=250&page_info=${next[1]}` : null;
      }
    }

    let deleted = 0, failed = 0;
    for (const id of ids) {
      try {
        if (entity === "orders") {
          await fetch(`${apiBase}/orders/${id}/close.json`, { method:"POST", headers, body:"{}" });
        }
        const r = await fetch(`${apiBase}/${entity}/${id}.json`, { method:"DELETE", headers });
        if (r.ok || r.status===200||r.status===204) deleted++;
        else failed++;
      } catch { failed++; }
      await new Promise(r => setTimeout(r, 250));
    }
    return res.status(200).json({ deleted, failed, total: ids.length });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
