export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { shopify_domain, shopify_token, entity, preview } = req.body;
  if (!shopify_domain || !shopify_token || !entity)
    return res.status(400).json({ error: "Parametri mancanti" });

  const domain  = shopify_domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const apiBase = `https://${domain}/admin/api/2024-01`;
  const headers = { "X-Shopify-Access-Token": shopify_token, "Content-Type": "application/json" };

  try {
    let items = []; // { id, label } — label usato per la preview
    let url;

    if (entity === "products") {
      // Recupera tutti i prodotti con titolo e tag
      let allProducts = [];
      url = `${apiBase}/products.json?limit=250&published_status=any&fields=id,title,tags`;
      while (url) {
        const r = await fetch(url, { headers });
        const data = await r.json();
        (data.products || []).forEach(p => allProducts.push(p));
        const link = r.headers.get("link") || "";
        const next = link.match(/page_info=([^&>]+)[^>]*>;\s*rel="next"/);
        url = next ? `${apiBase}/products.json?limit=250&published_status=any&fields=id,title,tags&page_info=${next[1]}` : null;
      }
      // Filtra quelli con tag wc_product_* (importati dalla console)
      const tagged = allProducts.filter(p => p.tags && p.tags.includes("wc_product_"));
      if (tagged.length > 0) {
        // Usa solo i prodotti taggati
        tagged.forEach(p => items.push({ id: p.id, label: `🏷 ${p.title || String(p.id)}` }));
      } else {
        // Nessun tag trovato: mostra TUTTI i prodotti come avviso
        allProducts.forEach(p => items.push({ id: p.id, label: `⚠ ${p.title || String(p.id)} (no tag)` }));
      }
    } else if (entity === "orders") {
      url = `${apiBase}/orders.json?limit=250&status=any&fields=id,name,tags`;
      while (url) {
        const r = await fetch(url, { headers });
        const data = await r.json();
        (data.orders || []).forEach(o => items.push({ id: o.id, label: o.name || String(o.id) }));
        const link = r.headers.get("link") || "";
        const next = link.match(/page_info=([^&>]+)[^>]*>;\s*rel="next"/);
        url = next ? `${apiBase}/orders.json?limit=250&status=any&fields=id,name,tags&page_info=${next[1]}` : null;
      }
    } else if (entity === "customers") {
      url = `${apiBase}/customers.json?limit=250&fields=id,email,first_name,last_name`;
      while (url) {
        const r = await fetch(url, { headers });
        const data = await r.json();
        (data.customers || []).forEach(c => items.push({ id: c.id, label: `${c.first_name||""} ${c.last_name||""} <${c.email||""}>`.trim() }));
        const link = r.headers.get("link") || "";
        const next = link.match(/page_info=([^&>]+)[^>]*>;\s*rel="next"/);
        url = next ? `${apiBase}/customers.json?limit=250&fields=id,email,first_name,last_name&page_info=${next[1]}` : null;
      }
    } else if (entity === "collections") {
      url = `${apiBase}/custom_collections.json?limit=250&fields=id,title`;
      while (url) {
        const r = await fetch(url, { headers });
        const data = await r.json();
        (data.custom_collections || []).forEach(c => items.push({ id: c.id, label: c.title || String(c.id) }));
        const link = r.headers.get("link") || "";
        const next = link.match(/page_info=([^&>]+)[^>]*>;\s*rel="next"/);
        url = next ? `${apiBase}/custom_collections.json?limit=250&fields=id,title&page_info=${next[1]}` : null;
      }
    }

    // ── MODALITÀ PREVIEW: lista senza cancellare ─────────────────────────────
    if (preview) {
      const hasTagged = items.some(i => i.label.startsWith("🏷"));
      const allUntagged = items.length > 0 && items.every(i => i.label.startsWith("⚠"));
      return res.status(200).json({
        preview: true,
        total: items.length,
        items: items.slice(0, 100),
        warning: allUntagged
          ? "Nessun prodotto ha il tag wc_product_* — questi sono TUTTI i prodotti Shopify. Cancellare manualmente o reimportare con il tool aggiornato."
          : null,
      });
    }

    // ── MODALITÀ CANCELLAZIONE EFFETTIVA ─────────────────────────────────────
    let deleted = 0, failed = 0;
    for (const { id } of items) {
      try {
        if (entity === "orders") {
          await fetch(`${apiBase}/orders/${id}/close.json`, { method:"POST", headers, body:"{}" });
        }
        const endpoint = entity === "collections"
          ? `${apiBase}/custom_collections/${id}.json`
          : `${apiBase}/${entity}/${id}.json`;
        const r = await fetch(endpoint, { method:"DELETE", headers });
        if (r.ok || r.status === 200 || r.status === 204) deleted++;
        else failed++;
      } catch { failed++; }
      await new Promise(r => setTimeout(r, 250));
    }
    return res.status(200).json({ deleted, failed, total: items.length });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
