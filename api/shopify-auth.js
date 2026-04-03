// api/shopify-auth.js — avvia il flusso OAuth Shopify
// GET /api/shopify-auth?shop=mio-negozio.myshopify.com

const CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID     || "2379492e27d60b3cca02782e3845dc43";
const REDIRECT_URI  = process.env.SHOPIFY_REDIRECT_URI  || "https://wp-shopify-sync.vercel.app/api/shopify-callback";
const SCOPES        = "read_products,write_products,read_orders,write_orders,read_customers,write_customers";

export default function handler(req, res) {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: "Parametro shop mancante" });

  const domain = shop.includes(".myshopify.com") ? shop : `${shop}.myshopify.com`;
  const state  = Math.random().toString(36).slice(2); // nonce anti-CSRF

  // Salva state in cookie temporaneo
  res.setHeader("Set-Cookie", `shopify_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`);

  const authUrl = `https://${domain}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;
  res.redirect(authUrl);
}
