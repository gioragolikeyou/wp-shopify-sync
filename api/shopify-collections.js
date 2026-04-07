// api/shopify-collections.js
// Crea collezioni e tag su Shopify a partire dalle categorie WC
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { shopify_domain, shopify_token, collections, wc_products } = req.body;
  if (!shopify_domain || !shopify_token) return res.status(400).json({ error: "Parametri mancanti" });

  const domain  = shopify_domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const apiBase = `https://${domain}/admin/api/2024-01`;
  const headers = { "X-Shopify-Access-Token": shopify_token, "Content-Type": "application/json" };

  // 1. Recupera tutti i prodotti Shopify con tag wc_product per matchare gli ID
  let shopifyProducts = [];
  try {
    let url = `${apiBase}/products.json?limit=250&fields=id,title,tags`;
    while (url) {
      const r = await fetch(url, { headers });
      const d = await r.json();
      shopifyProducts = [...shopifyProducts, ...(d.products || [])];
      const link = r.headers.get("link") || "";
      const next = link.match(/page_info=([^&>]+)[^>]*>;\s*rel="next"/);
      url = next ? `${apiBase}/products.json?limit=250&fields=id,title,tags&page_info=${next[1]}` : null;
    }
  } catch {}

  // Match WC product → Shopify product by title
  const titleToShopifyId = {};
  shopifyProducts.forEach(p => { titleToShopifyId[p.title.toLowerCase().trim()] = p.id; });

  const results = [];

  // 2. Crea/aggiorna collezioni
  for (const col of (collections || [])) {
    try {
      // Cerca collezione esistente
      const searchRes = await fetch(`${apiBase}/custom_collections.json?title=${encodeURIComponent(col.title)}&limit=1`, { headers });
      const searchData = await searchRes.json();
      let collectionId;

      if (searchData.custom_collections?.length > 0) {
        collectionId = searchData.custom_collections[0].id;
      } else {
        const createRes = await fetch(`${apiBase}/custom_collections.json`, {
          method: "POST", headers,
          body: JSON.stringify({ custom_collection: { title: col.title, published: true } }),
        });
        const createData = await createRes.json();
        collectionId = createData.custom_collection?.id;
      }

      if (!collectionId) { results.push({ title: col.title, error: "Creazione fallita" }); continue; }

      // Associa prodotti per nome
      let added = 0;
      for (const name of (col.product_names || [])) {
        const shopifyId = titleToShopifyId[name.toLowerCase().trim()];
        if (!shopifyId) continue;
        const collectRes = await fetch(`${apiBase}/collects.json`, {
          method: "POST", headers,
          body: JSON.stringify({ collect: { collection_id: collectionId, product_id: shopifyId } }),
        });
        if (collectRes.ok || collectRes.status === 422) added++; // 422 = già associato
        await new Promise(r => setTimeout(r, 150));
      }
      results.push({ title: col.title, collection_id: collectionId, added });
    } catch (err) {
      results.push({ title: col.title, error: err.message });
    }
    await new Promise(r => setTimeout(r, 200));
  }

  return res.status(200).json({ results });
}
