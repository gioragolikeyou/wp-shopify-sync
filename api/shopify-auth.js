export default function handler(req, res) {
  const { shop, client_id, client_secret, app_url } = req.query;
  if (!shop || !client_id || !client_secret)
    return res.status(400).json({ error: "Parametri mancanti" });

  const SCOPES = "read_products,write_products,read_orders,write_orders,read_customers,write_customers";
  const BASE = app_url || "https://wp-shopify-sync.vercel.app";
  
  // Passa le credenziali nel state (base64 encoded)
  const stateData = Buffer.from(JSON.stringify({ client_id, client_secret, app_url: BASE })).toString("base64url");
  const REDIRECT_URI = `${BASE}/api/shopify-callback`;

  res.redirect(`https://${shop}/admin/oauth/authorize?client_id=${client_id}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${stateData}`);
}
