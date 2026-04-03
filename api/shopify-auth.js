// api/shopify-auth.js — avvia OAuth, riceve client_id dal frontend via query param
export default function handler(req, res) {
  const { shop, client_id, redirect_uri, scopes } = req.query;
  if (!shop || !client_id) return res.status(400).json({ error: "shop e client_id obbligatori" });

  const state = Math.random().toString(36).slice(2);
  res.setHeader("Set-Cookie", `shopify_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`);

  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${client_id}&scope=${scopes || "read_products,write_products,read_orders,write_orders,read_customers,write_customers"}&redirect_uri=${encodeURIComponent(redirect_uri)}&state=${state}`;
  res.redirect(authUrl);
}
