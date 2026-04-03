export default function handler(req, res) {
  const { shop, client_id, client_secret, app_url } = req.query;
  if (!shop || !client_id || !client_secret)
    return res.status(400).json({ error: "shop, client_id e client_secret obbligatori" });

  const SCOPES = "read_products,write_products,read_orders,write_orders,read_customers,write_customers";
  const BASE   = app_url || "https://wp-shopify-sync.vercel.app";
  const REDIRECT_URI = BASE + "/api/shopify-callback";
  const state  = Math.random().toString(36).slice(2);

  res.setHeader("Set-Cookie", `shopify_oauth=${encodeURIComponent(JSON.stringify({client_id,client_secret,app_url:BASE,state}))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`);
  res.redirect(`https://${shop}/admin/oauth/authorize?client_id=${client_id}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`);
}
