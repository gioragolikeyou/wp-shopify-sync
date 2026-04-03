// api/shopify-callback.js — scambia il codice con token
// client_secret arriva dal sessionStorage via query param (mai nel codice)
export default async function handler(req, res) {
  const { shop, code, error, client_id, client_secret, app_url } = req.query;
  const APP_URL = app_url || "https://wp-shopify-sync.vercel.app";

  if (error) return res.redirect(`${APP_URL}/?shopify_error=${encodeURIComponent(error)}`);
  if (!shop || !code || !client_id || !client_secret)
    return res.redirect(`${APP_URL}/?shopify_error=${encodeURIComponent("Parametri OAuth mancanti")}`);

  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id, client_secret, code }),
    });
    if (!tokenRes.ok) throw new Error(`Token exchange fallito: ${tokenRes.status}`);
    const { access_token } = await tokenRes.json();
    res.redirect(`${APP_URL}/?shopify_connected=1&shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(access_token)}`);
  } catch (err) {
    res.redirect(`${APP_URL}/?shopify_error=${encodeURIComponent(err.message)}`);
  }
}
