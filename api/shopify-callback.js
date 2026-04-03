const CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const APP_URL       = process.env.APP_URL || "https://wp-shopify-sync.vercel.app";

export default async function handler(req, res) {
  const { shop, code, state, error } = req.query;
  if (error) return res.redirect(`${APP_URL}/?shopify_error=${encodeURIComponent(error)}`);
  if (!shop || !code) return res.status(400).json({ error: "Parametri mancanti" });
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
    });
    if (!tokenRes.ok) throw new Error("Token exchange fallito");
    const { access_token } = await tokenRes.json();
    res.redirect(`${APP_URL}/?shopify_connected=1&shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(access_token)}`);
  } catch (err) {
    res.redirect(`${APP_URL}/?shopify_error=${encodeURIComponent(err.message)}`);
  }
}
