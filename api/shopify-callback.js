export default async function handler(req, res) {
  const { shop, code, state, error } = req.query;
  const APP_URL = "https://wp-shopify-sync.vercel.app";

  if (error) return res.redirect(`${APP_URL}/?shopify_error=${encodeURIComponent(error)}`);
  if (!shop || !code || !state) return res.redirect(`${APP_URL}/?shopify_error=missing_params`);

  // Decodifica le credenziali dallo state
  let client_id, client_secret, app_url;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
    client_id = decoded.client_id;
    client_secret = decoded.client_secret;
    app_url = decoded.app_url || APP_URL;
  } catch {
    return res.redirect(`${APP_URL}/?shopify_error=invalid_state`);
  }

  if (!client_id || !client_secret) return res.redirect(`${APP_URL}/?shopify_error=missing_credentials`);

  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id, client_secret, code }),
    });
    const data = await tokenRes.json();
    if (!data.access_token) return res.redirect(`${APP_URL}/?shopify_error=${encodeURIComponent(JSON.stringify(data))}`);
    res.redirect(`${app_url}/?shopify_connected=1&shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(data.access_token)}`);
  } catch (err) {
    res.redirect(`${APP_URL}/?shopify_error=${encodeURIComponent(err.message)}`);
  }
}
