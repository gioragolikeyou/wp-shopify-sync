export default async function handler(req, res) {
  const { shop, code, error } = req.query;
  const APP_URL = "https://wp-shopify-sync.vercel.app";

  if (error) return res.redirect(`${APP_URL}/?shopify_error=${encodeURIComponent(error)}`);
  if (!shop || !code) return res.redirect(`${APP_URL}/?shopify_error=missing_shop_or_code`);

  // Leggi cookie manualmente senza dipendenze
  const cookieHeader = req.headers.cookie || "";
  const cookieMatch = cookieHeader.match(/shopify_oauth=([^;]+)/);
  let oauthData = {};
  try { oauthData = JSON.parse(decodeURIComponent(cookieMatch?.[1] || "{}")); } catch {}

  const { client_id, client_secret } = oauthData;
  if (!client_id || !client_secret) return res.redirect(`${APP_URL}/?shopify_error=cookie_missing`);

  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id, client_secret, code }),
    });
    const data = await tokenRes.json();
    if (!data.access_token) return res.redirect(`${APP_URL}/?shopify_error=${encodeURIComponent(JSON.stringify(data))}`);
    res.redirect(`${APP_URL}/?shopify_connected=1&shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(data.access_token)}`);
  } catch (err) {
    res.redirect(`${APP_URL}/?shopify_error=${encodeURIComponent(err.message)}`);
  }
}
