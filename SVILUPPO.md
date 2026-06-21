# WP → Shopify Sync Console — Diario di Sviluppo

## Stack e Deploy

- **Frontend**: React + Vite (`src/App.jsx`)
- **Backend**: Vercel Serverless Functions (`api/*.js`)
- **Repository**: https://github.com/gioragolikeyou/wp-shopify-sync
- **Deploy**: https://wp-shopify-sync.vercel.app

---

## Struttura File

```
sync-console/
├── api/
│   ├── wc.js                    # Proxy WooCommerce (Basic Auth, prodotti/ordini/clienti/categorie)
│   ├── wc-variations-bulk.js    # Fetch varianti bulk server-side (chunk da 2)
│   ├── shopify.js               # Proxy Shopify Admin API (upsert + dedup clienti/ordini/prodotti)
│   ├── shopify-auth.js          # Avvia OAuth Shopify
│   ├── shopify-callback.js      # Riceve codice OAuth, scambia con token
│   ├── shopify-delete.js        # Cancella entità Shopify (preview + cancellazione)
│   └── shopify-collections.js   # Crea/aggiorna custom collections da categorie WC
├── src/
│   ├── App.jsx                  # Console React completa
│   └── main.jsx
├── package.json
├── vite.config.js
├── vercel.json
└── index.html
```

---

## Funzionalità Implementate

### Console (App.jsx)
- Multi-store con credenziali salvate in localStorage
- **⚙️ Impostazioni App**: Client ID + Secret OAuth Shopify
- **✏️ Modifica store**: WC URL/key/secret + Shopify domain + Access Token
- **▼ Opzioni fetch**: limite record, filtro data dal/al, filtro categoria
- Tab: Dati Live | Mapping | Validazione | Simulazione | Sync Log
- Progress bar paginazione (WC max 100/pagina, loop automatico)
- Bottone ✕ Stop per interrompere fetch/push
- **Dedup ordini** via tag `wc_order_{id}` (salta se già importato)
- **Dedup prodotti** via tag `wc_product_{id}` (PUT se esiste, POST se nuovo)
- **Dedup clienti** via ricerca per email (PUT se esiste, POST se nuovo)
- **🗂 Crea Collezioni**: crea/aggiorna custom_collections Shopify da categorie WC
- **Auto-sync collezioni** dopo ogni push prodotti
- **👁 Anteprima cancellazione**: lista prodotti che verrebbero cancellati senza toccare niente
- **🗑 Cancella**: prodotti (solo con tag `wc_product_*`), ordini, clienti, collezioni

### Autenticazione WooCommerce
- `wc.js` usa **Basic Auth** (`Authorization: Basic base64(key:secret)`) per tutti gli endpoint
- Le varianti vengono fetched **direttamente dal browser** (bypassa IP Vercel, evita rate limiting)
- CORS abilitato sul sito WC tramite plugin o `functions.php`

### Token Shopify — Flusso Attuale
L'OAuth via Vercel ha problemi con i cookie tra redirect. **Soluzione attuale**: token generato con script locale:

```bash
kill $(lsof -ti:3456) && node ~/Desktop/get-token.mjs
```

Lo script (`~/Desktop/get-token.mjs`) avvia un server su porta 3456, apre il browser per OAuth, stampa il token `shpat_...` nel terminale. Il token va incollato nel campo **Access Token Shopify** del form store.

**Prerequisito**: `http://localhost:3456/callback` deve essere whitelistato negli URL di reindirizzamento dell'app Shopify.

### Credenziali App Shopify (Flaminia Barosini — test)
- WC URL: `https://www.flaminiabarosini.com/`
- Shopify domain: `flaminia-barosini.myshopify.com`
- App Shopify: **SyncWP** (Dev Dashboard Partners)
- Client ID: `IL TUO CLIENT ID`
- Client Secret: `IL TUO SECRET ID`

---

## Mapping Prodotti

| Campo WC | Campo Shopify | Note |
|---|---|---|
| `name` | `title` | |
| `description` | `body_html` | fallback su `short_description` |
| `_custom_description_copy` | `meta:custom.custom_description` | rich_text_field |
| `tags` | `tags` | array oggetti → stringa nomi |
| `sku` | `variants.sku` | |
| `regular_price` | `variants.price` | fallback su `price` padre se 0 |
| `sale_price` | `variants.compare_at_price` | solo se presente |
| `stock_quantity` | `variants.inventory_quantity` | con `inventory_management: "shopify"` |
| `categories[0].name` | `product_type` | |
| `categories[0].slug` | `meta:custom.categoria_slug` | |
| `_categories_names` | `meta:custom.filter_categorie` | list.single_line_text_field |
| `attribute:pa_collezioni` | `meta:custom.filter_collezioni` | list.single_line_text_field |
| `attribute:pa_materiale` | `meta:custom.filter_materiale` | list.single_line_text_field |
| `_yoast_title` | `global.title_tag` | da yoast_head_json |
| `_yoast_description` | `global.description_tag` | da yoast_head_json |
| `images[]` | `images[]` | array URL immagini |
| Tag automatico | `wc_product_{id}` | per dedup e cancellazione selettiva |

### Prodotti Variabili
- Fetch varianti **diretto dal browser** (query params, CORS richiesto sul WC)
- Loop sequenziale con 150ms di pausa tra richieste
- Costruzione `options[]` e `variants[]` con prezzi/SKU/stock per variante
- Fallback prezzo: `sale_price` → `regular_price` → `price` variante → `price` prodotto padre

### Metafield Types
- `custom.custom_description` → `rich_text_field` (JSON strutturato)
- `custom.filter_categorie/collezioni/materiale` → `list.single_line_text_field` (array JSON)
- `custom.product_media_second_image` → **skippato** (è file_reference, non mappabile via URL)
- `global.title_tag` e `global.description_tag` → `single_line_text_field`

---

## Mapping Ordini

| Campo WC | Campo Shopify | Note |
|---|---|---|
| `id` | `name` | |
| `date_created` | `created_at` | |
| `billing.email` | `email` | |
| `status` | `financial_status` | mappato con STATUS_MAP |
| `total` | `total_price` | |
| `line_items[]` | `line_items[]` | placeholder se vuoti |
| `coupon_lines[]` | `discount_codes[]` | |
| `billing.*` | `billing_address.*` | |
| — | `tags` | `wc_order_{id}` per dedup |
| — | `send_receipt` | `false` — non manda email ai clienti |
| — | `send_fulfillment_receipt` | `false` |

**Status map**: `completed→paid`, `processing→pending`, `on-hold→pending`, `cancelled→voided`, `refunded→refunded`, `pending→pending`, `checkout-draft→pending`, `failed→voided`

---

## Mapping Clienti

| Campo WC | Campo Shopify | Note |
|---|---|---|
| `email` | `email` | usato anche per dedup |
| `first_name` | `first_name` | |
| `last_name` | `last_name` | |
| `billing.phone` | `phone` | |
| `billing.*` | `addresses.*` | |
| `date_created` | `meta:custom.data_registrazione` | |
| `orders_count` | `meta:custom.num_ordini` | |
| `total_spent` | `meta:custom.totale_speso` | |

---

## Fix Applicati (Cronologia)

1. **Tag WC** — `tags` da array oggetti `[{id,name,slug}]` → stringa nomi
2. **Categorie come tag** — tutte le categorie WC nei tag Shopify (non solo la prima)
3. **`wc_product_` tag** — spostato dopo il mapping loop (non veniva sovrascritto)
4. **`inventory_management`** — spostato dopo il mapping loop
5. **Retry su timeout** — 3 tentativi con backoff, check post-timeout
6. **Dedup prodotti** — check `wc_product_*` prima del push (PUT vs POST)
7. **Preview cancellazione** — lista prodotti senza cancellarli
8. **SEO Yoast** — legge da `yoast_head_json` (non da `meta:_yoast_wpseo_*` che sono vuoti)
9. **Metafield custom_description** — `rich_text_field` con JSON strutturato
10. **list.single_line_text_field** — filtri come array JSON `["valore"]`
11. **Skip product_media_second_image** — è `file_reference`, non mappabile
12. **Auto-sync collezioni** — dopo ogni push prodotti
13. **Upsert prodotti** — PUT se esiste (aggiorna), POST se nuovo
14. **Basic Auth WC** — sostituisce query params (401 su HTTPS)
15. **Varianti dirette dal browser** — bypassa rate limiting IP Vercel
16. **CORS WC** — plugin CORS abilitato su `flaminiabarosini.com`
17. **send_receipt: false** — nessuna email ai clienti sugli ordini
18. **metafields ordini** — da `{}` a `[]`
19. **Prezzo varianti** — fallback su `price` prodotto padre se 0

---

## Workflow Deploy

```bash
cd ~/Desktop/sync-console
git add .
git commit -m "messaggio"
git push
```

Vercel si aggiorna automaticamente in 30-60 secondi dopo ogni push.

### Script Utili

```bash
# Token Shopify
kill $(lsof -ti:3456) && node ~/Desktop/get-token.mjs

# Verifica fix nel file locale
grep -n "termine" ~/Desktop/sync-console/src/App.jsx

# Push forzato
git push --force
```

---

## Prossimi Sviluppi / Roadmap App Store

### Bug aperti
- Alcuni prodotti con colore zirconi non importano varianti (attributo non standard)
- OAuth Shopify via Vercel non funziona (cookie tra redirect) — usare script locale

### Per pubblicazione Shopify App Store
- OAuth multi-tenant (credenziali per utente, non in localStorage)
- Database per store/mapping/log (es. Supabase o PlanetScale)
- UI semplificata per utenti non tecnici
- Hosting dedicato (Vercel Pro o Railway)
- Privacy policy + ToS
- Review Shopify (4-8 settimane)

### Piani abbonamento ipotizzati
- **Starter** — fino a 50 prodotti
- **Growth** — fino a 200 prodotti
- **Pro** — fino a 1000 prodotti
- **Enterprise** — oltre 1000 (su richiesta)
