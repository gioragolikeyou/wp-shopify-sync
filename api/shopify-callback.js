import { parse } from "cookie";

export default async function handler(req, res) {
  const { shop, code, state, error } = req.query;
  const cookies = parse(req.headers.cookie || "");
  let oauthData = {};
  try { oauthData = JSON.parse(decodeURIComponent(cookies.shopify_oauth || "{}")); } catch {}

  const { client_id, client_secret, app_url } = oauthData;
  const APP_URL = app_url || "https://wp-shopify-sync.vercel.app";

  if (error) return res.redirect(`${APP_URL}/?shopify_error=${encodeURIComponent(error)}`);
  if (!shop || !code) return res.redirect(`${APP_URL}/?shopify_error=missing_params`);
  if (!client_id || !client_secret) return res.redirect(`${APP_URL}/?shopify_error=missing_credentials_cookie`);

  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id, client_secret, code }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.access_token) {
      return res.redirect(`${APP_URL}/?shopify_error=${encodeURIComponent(JSON.stringify(data))}`);
    }
    res.redirect(`${APP_URL}/?shopify_connected=1&shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(data.access_token)}`);
  } catch (err) {
    res.redirect(`${APP_URL}/?shopify_error=${encodeURIComponent(err.message)}`);
  }
}
