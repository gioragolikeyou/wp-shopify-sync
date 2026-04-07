import { useState, useMemo, useCallback, useRef, useEffect } from "react";

// ─── API ─────────────────────────────────────────────────────────────────────
async function wcFetchPage({ wp_url, wp_key, wp_secret, entity, page, category, after, before }) {
  const res = await fetch("/api/wc", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wp_url, wp_key, wp_secret, entity, per_page: 100, page, category, after, before }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error + (json.detail ? ` — ${json.detail}` : ""));
  return json;
}

async function wcFetchVariations({ wp_url, wp_key, wp_secret, product_id }) {
  const res = await fetch("/api/wc", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wp_url, wp_key, wp_secret, entity: "product_variations", product_id, per_page: 100, page: 1 }),
  });
  const json = await res.json();
  if (!res.ok) return [];
  return json.data || [];
}

async function shopifyPush({ shopify_domain, shopify_token, entity, payload }) {
  const res = await fetch("/api/shopify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shopify_domain, shopify_token, entity, payload }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error + (json.detail ? ` — ${JSON.stringify(json.detail).slice(0,120)}` : ""));
  return json;
}

// ─── STORAGE ─────────────────────────────────────────────────────────────────
const LS = {
  get: (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set: (k, v)   => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const newStore = (id) => ({ id, name:`Store ${id}`, wp_url:"", wp_key:"", wp_secret:"", shopify_domain:"", shopify_token:"" });

const DEFAULT_MAPPING = {
  products: { id:"", name:"title", description:"body_html", short_description:"", tags:"tags", sku:"variants.sku", regular_price:"variants.price", sale_price:"variants.compare_at_price", stock_quantity:"variants.inventory_quantity", "categories[0].name":"product_type", "categories[0].slug":"meta:custom.categoria_slug", weight:"meta:custom.weight", "dimensions.length":"meta:custom.dim_length", "dimensions.width":"meta:custom.dim_width", "dimensions.height":"meta:custom.dim_height" },
  orders: { id:"name", date_created:"created_at", "billing.email":"email", status:"financial_status", total:"total_price", shipping_total:"shipping_price", payment_method:"payment_gateway", customer_note:"note", "billing.first_name":"billing_address.first_name", "billing.last_name":"billing_address.last_name", "billing.address_1":"billing_address.address1", "billing.city":"billing_address.city", "billing.postcode":"billing_address.zip", "billing.country":"billing_address.country_code", "billing.phone":"billing_address.phone" },
  customers: { id:"", email:"email", first_name:"first_name", last_name:"last_name", "billing.phone":"phone", "billing.address_1":"addresses.address1", "billing.city":"addresses.city", "billing.postcode":"addresses.zip", "billing.country":"addresses.country_code", date_created:"meta:custom.data_registrazione", orders_count:"meta:custom.num_ordini", total_spent:"meta:custom.totale_speso" },
};

const SHOPIFY_TARGETS = {
  products:  ["","title","body_html","vendor","product_type","tags","variants.sku","variants.price","variants.compare_at_price","variants.inventory_quantity","meta:custom.categoria","meta:custom.categoria_slug","meta:custom.weight","meta:custom.dim_length","meta:custom.dim_width","meta:custom.dim_height"],
  orders:    ["","name","created_at","email","financial_status","fulfillment_status","total_price","shipping_price","payment_gateway","note","billing_address.first_name","billing_address.last_name","billing_address.address1","billing_address.city","billing_address.zip","billing_address.country_code","billing_address.phone"],
  customers: ["","email","first_name","last_name","phone","note","accepts_marketing","addresses.address1","addresses.city","addresses.zip","addresses.country_code","meta:custom.data_registrazione","meta:custom.num_ordini","meta:custom.totale_speso","meta:custom.tipo_cliente"],
};

const META_TYPES = ["single_line_text_field","multi_line_text_field","number_integer","number_decimal","boolean","date","date_time","url","json","color","weight","rating"];
const STATUS_MAP = { completed:"paid", processing:"pending", "on-hold":"pending", cancelled:"voided", refunded:"refunded", pending:"pending", "checkout-draft":"pending", failed:"voided", "pending-payment":"pending" };

function flattenWC(row) {
  const flat = { ...row };
  ["billing","shipping"].forEach(k => { if (row[k]&&typeof row[k]==="object") Object.entries(row[k]).forEach(([sk,sv])=>{flat[`${k}.${sk}`]=sv;}); });
  if (row.meta_data) row.meta_data.forEach(m=>{flat[`meta:${m.key}`]=m.value;});
  if (Array.isArray(row.categories)) { row.categories.forEach((cat,i)=>{flat[`categories[${i}].id`]=cat.id;flat[`categories[${i}].name`]=cat.name;flat[`categories[${i}].slug`]=cat.slug;}); flat["_categories_names"]=row.categories.map(c=>c.name).join(", "); }
  if (row.dimensions&&typeof row.dimensions==="object") Object.entries(row.dimensions).forEach(([k,v])=>{flat[`dimensions.${k}`]=v;});
  if (Array.isArray(row.images)) {
    flat["images"] = row.images.map(img=>({src:img.src,alt:img.alt||""}));
    flat["_images_count"] = row.images.length;
  }
  if (Array.isArray(row.line_items)) {
    flat["_line_items"] = row.line_items;
  }
  if (Array.isArray(row._variations)) {
    flat["_variations"] = row._variations;
  }
  // Se description è null usa short_description
  if (!flat["description"] && flat["short_description"]) {
    flat["description"] = flat["short_description"];
  }
  return flat;
}

function validateRow(entity, flat, mapping) {
  const errors=[], warnings=[];
  const get = t => { const f=Object.keys(mapping).find(k=>mapping[k]===t); return f?flat[f]:null; };
  if (entity==="products") { if (!get("title")) errors.push("Titolo mancante"); if (flat["type"] !== "variable" && isNaN(parseFloat(get("variants.price")||get("variants.compare_at_price")))) errors.push("Prezzo non valido"); }
  if (entity==="orders") { if (!get("email")&&!flat["billing.email"]) errors.push("Email mancante"); if (!get("total_price")||isNaN(parseFloat(get("total_price")))) errors.push("Totale non valido"); }
  if (entity==="customers") { if (!get("email")&&!flat.email) errors.push("Email mancante"); }
  Object.entries(mapping).forEach(([f,t])=>{ if (t?.startsWith("meta:")&&!flat[f]) warnings.push(`${f} vuoto → metafield saltato`); });
  return { errors, warnings, ok: errors.length===0 };
}

function buildPayload(entity, row, mapping, metaTypeMap) {
  const flat=flattenWC(row);
  const obj=entity==="products"?{variants:[{}],metafields:[],images:[]}:entity==="orders"?{billing_address:{},line_items:[],metafields:[]}:{addresses:[{}],metafields:[]};

  // Descrizione: usa description, fallback a short_description
  if (entity==="products") {
    if (!obj.body_html && flat["short_description"]) {
      obj.body_html = flat["short_description"];
    }
    // Fix prezzo prodotti semplici: se price è 0 o vuoto ma compare_at_price ha valore, inverti
    const v0 = obj.variants[0];
    if (v0 && (!v0.price || v0.price === "0" || v0.price === "") && v0.compare_at_price) {
      v0.price = v0.compare_at_price;
      delete v0.compare_at_price;
    }
    // Abilita monitoraggio scorte per prodotti semplici
    if (v0 && v0.inventory_quantity !== undefined && v0.inventory_quantity !== null) {
      v0.inventory_management = "shopify";
    }
    // Prodotti variabili: usa le varianti pre-caricate se disponibili
    if (flat["_variations"] && flat["_variations"].length > 0) {
      const vars = flat["_variations"];
      // Attributes / options
      const attrNames = [...new Set(vars.flatMap(v => (v.attributes||[]).map(a => a.name)))].slice(0,3);
      if (attrNames.length > 0) {
        obj.options = attrNames.map(name => ({ name }));
        obj.variants = vars.map(v => {
          const attrMap = Object.fromEntries((v.attributes||[]).map(a=>[a.name, a.option]));
          // Prezzo: se c'è sale_price usa quello come price e regular come compare_at
          // Se non c'è sale_price usa regular_price come price
          const hasDiscount = v.sale_price && v.sale_price !== "" && v.sale_price !== "0";
          const mainPrice = hasDiscount ? v.sale_price : (v.regular_price || v.price || "0");
          const comparePrice = hasDiscount ? v.regular_price : undefined;
          const variant = {
            option1: attrMap[attrNames[0]] || "",
            option2: attrNames[1] ? (attrMap[attrNames[1]] || "") : undefined,
            option3: attrNames[2] ? (attrMap[attrNames[2]] || "") : undefined,
            price: mainPrice,
            compare_at_price: comparePrice,
            sku: v.sku || "",
            inventory_quantity: parseInt(v.stock_quantity) || 0,
            inventory_management: (v.manage_stock && v.stock_quantity !== null) ? "shopify" : null,
          };
          // Rimuovi undefined
          Object.keys(variant).forEach(k => variant[k] === undefined && delete variant[k]);
          return variant;
        });
      }
    }
  }

  // Immagini prodotto
  if (entity==="products" && Array.isArray(flat["images"])) {
    obj.images = flat["images"].map(img=>({src:img.src,alt:img.alt}));
  }

  // Tag identificativo per prodotti importati (usato per cancellazione selettiva)
  if (entity==="products" && flat["id"]) {
    const existingTags = obj.tags ? String(obj.tags) : "";
    const wcTag = `wc_product_${flat["id"]}`;
    obj.tags = existingTags ? `${existingTags},${wcTag}` : wcTag;
  }

  // Coupon/sconti ordine
  if (entity==="orders" && Array.isArray(row.coupon_lines) && row.coupon_lines.length > 0) {
    obj.discount_codes = row.coupon_lines.map(c => ({
      code:   c.code,
      amount: String(parseFloat(c.discount || 0).toFixed(2)),
      type:   "fixed_amount",
    }));
  }

  // Tag con ID ordine WC per evitare duplicati
  if (entity==="orders" && flat["id"]) {
    obj.tags = `wc_order_${flat["id"]}`;
  }

  // Line items ordini (richiesti da Shopify)
  if (entity==="orders") {
    const items = flat["_line_items"];
    if (Array.isArray(items) && items.length > 0) {
      obj.line_items = items.map(item=>({
        title: item.name || String(item.product_id || "Prodotto"),
        quantity: parseInt(item.quantity) || 1,
        price: String(item.subtotal ? (parseFloat(item.subtotal)/parseInt(item.quantity||1)).toFixed(2) : item.price || "0"),
        sku: item.sku || "",
      }));
    } else {
      // Shopify richiede almeno un line item — usa il totale come placeholder
      obj.line_items = [{
        title: "Ordine importato da WooCommerce",
        quantity: 1,
        price: String(flat["total"] || flat["order_total"] || "0"),
      }];
    }
  }
  Object.entries(mapping).forEach(([wpField,target])=>{
    if (!target) return;
    let val=flat[wpField];
    if (val===undefined||val===null||val==="") return;
    if (target==="financial_status") val=STATUS_MAP[val]||"pending";
    if (target==="accepts_marketing") val=["yes","true","1"].includes(String(val).toLowerCase());
    if (target.startsWith("meta:")) { const key=target.replace("meta:custom.",""); const type=metaTypeMap?.[target]||"single_line_text_field"; if (type==="number_integer") val=parseInt(val); else if (type==="number_decimal") val=parseFloat(val); obj.metafields.push({namespace:"custom",key,type,value:val}); }
    else if (target.includes(".")) { const [p,c]=target.split("."); if (p==="variants") obj.variants[0][c]=val; else if (p==="billing_address") obj.billing_address[c]=val; else if (p==="addresses") obj.addresses[0][c]=val; }
    else { obj[target]=val; }
  });
  return obj;
}

const C = { bg:"#0a0e14",surface:"#141920",surface2:"#1a2130",border:"#253040",text:"#d0dcea",muted:"#5a7090",accent:"#4db8ff",green:"#3dd68c",yellow:"#f0b429",red:"#ff5c5c",meta:"#c084fc",field:"#67d7f0",orange:"#ff9d4d",purple:"#818cf8",teal:"#2dd4bf" };
const Badge = ({label,color}) => <span style={{background:color+"25",color,border:`1px solid ${color}44`,borderRadius:4,padding:"1px 7px",fontSize:11,fontFamily:"monospace",fontWeight:600,whiteSpace:"nowrap"}}>{label}</span>;
const ENTITIES = { products:{icon:"📦",label:"Prodotti",color:C.accent}, orders:{icon:"🛒",label:"Ordini",color:C.orange}, customers:{icon:"👤",label:"Clienti",color:C.green} };
const SUBTABS = ["📂 Dati Live","🔗 Mapping","✅ Validazione","🚀 Simulazione","📤 Sync Log"];
const inp = { background:C.bg,color:C.text,border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,fontFamily:"'IBM Plex Mono',monospace",outline:"none",width:"100%",boxSizing:"border-box" };

// ─── APP SETTINGS MODAL ───────────────────────────────────────────────────────
function AppSettingsModal({ settings, onSave, onClose }) {
  const [clientId,     setClientId]     = useState(settings.clientId     || "");
  const [clientSecret, setClientSecret] = useState(settings.clientSecret || "");
  const [appUrl,       setAppUrl]       = useState(settings.appUrl       || window.location.origin);
  const lbl = {color:C.muted,fontSize:11,marginBottom:4};
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.surface,border:`1px solid ${C.purple}44`,borderRadius:10,padding:24,width:500}}>
        <div style={{fontFamily:"'IBM Plex Sans',sans-serif",fontWeight:700,fontSize:15,color:C.purple,marginBottom:6}}>⚙️ Impostazioni App</div>
        <div style={{color:C.muted,fontSize:12,marginBottom:18}}>Configura le credenziali OAuth Shopify per tutti gli store. Salvate solo nel browser.</div>

        <div style={lbl}>Shopify Client ID</div>
        <input style={inp} value={clientId} onChange={e=>setClientId(e.target.value)} placeholder="2379492e27d60b3cca02782e3845dc43" autoFocus/>

        <div style={{...lbl,marginTop:12}}>Shopify Client Secret</div>
        <input style={inp} type="password" value={clientSecret} onChange={e=>setClientSecret(e.target.value)} placeholder="shpss_xxxx"/>
        <div style={{color:C.muted,fontSize:10,marginTop:4}}>⚠️ Salvato solo nel tuo browser, mai nel codice o su server</div>

        <div style={{...lbl,marginTop:12}}>URL App (redirect OAuth)</div>
        <input style={inp} value={appUrl} onChange={e=>setAppUrl(e.target.value)} placeholder="https://wp-shopify-sync.vercel.app"/>
        <div style={{color:C.muted,fontSize:10,marginTop:4}}>Deve corrispondere all'URL configurato nella Dev Dashboard Shopify</div>

        <div style={{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:6,padding:12,marginTop:16,fontSize:11}}>
          <div style={{color:C.yellow,fontWeight:600,marginBottom:6}}>📋 Dove trovare questi valori:</div>
          <div style={{color:C.muted,lineHeight:1.8}}>
            1. Vai su <span style={{color:C.text}}>partners.shopify.com</span><br/>
            2. Apps → SyncWP → Impostazioni<br/>
            3. Copia <span style={{color:C.field}}>ID client</span> e <span style={{color:C.field}}>Segreto</span>
          </div>
        </div>

        <div style={{display:"flex",gap:10,marginTop:20}}>
          <button onClick={()=>onSave({clientId,clientSecret,appUrl})}
            style={{background:C.purple+"22",color:C.purple,border:`1px solid ${C.purple}44`,borderRadius:6,padding:"8px 20px",fontSize:13,fontFamily:"inherit",cursor:"pointer",fontWeight:600,flex:1}}>
            ✓ Salva impostazioni
          </button>
          <button onClick={onClose} style={{background:"none",color:C.muted,border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 16px",fontSize:13,fontFamily:"inherit",cursor:"pointer"}}>
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── STORE MODAL ─────────────────────────────────────────────────────────────
function StoreModal({ store, appSettings, onSave, onClose, onLog }) {
  const [name,           setName]          = useState(store.name           || "");
  const [wp_url,         setWpUrl]         = useState(store.wp_url         || "");
  const [wp_key,         setWpKey]         = useState(store.wp_key         || "");
  const [wp_secret,      setWpSecret]      = useState(store.wp_secret      || "");
  const [shopify_domain, setShopifyDomain] = useState(store.shopify_domain || "");
  const [shopify_token,  setShopifyToken]  = useState(store.shopify_token  || "");
  const sec = {color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:1,margin:"14px 0 6px"};
  const lbl = {color:C.muted,fontSize:11,marginBottom:4};

  const handleOAuth = () => {
    if (!shopify_domain) { alert("Inserisci il dominio Shopify"); return; }
    if (!appSettings.clientId || !appSettings.clientSecret) { alert("Configura prima le Impostazioni App"); return; }
    const shop = shopify_domain.includes(".myshopify.com") ? shopify_domain : `${shopify_domain}.myshopify.com`;
    sessionStorage.setItem("pending_store", JSON.stringify({...store,name,wp_url,wp_key,wp_secret,shopify_domain:shop}));
    window.location.href = `/api/shopify-auth?shop=${shop}&client_id=${encodeURIComponent(appSettings.clientId)}&client_secret=${encodeURIComponent(appSettings.clientSecret)}&app_url=${encodeURIComponent(appSettings.appUrl)}`;
  };

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.surface,border:`1px solid ${C.accent}44`,borderRadius:10,padding:24,width:480,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontFamily:"'IBM Plex Sans',sans-serif",fontWeight:700,fontSize:15,color:C.accent,marginBottom:18}}>✏️ Configura Store</div>
        <div style={lbl}>Nome</div>
        <input style={inp} value={name} onChange={e=>setName(e.target.value)} placeholder="es. Negozio IT" autoFocus/>
        <div style={sec}>WooCommerce</div>
        <div style={lbl}>URL Sito</div>
        <input style={inp} value={wp_url} onChange={e=>setWpUrl(e.target.value)} placeholder="https://miosito.com"/>
        <div style={{...lbl,marginTop:10}}>Consumer Key</div>
        <input style={inp} value={wp_key} onChange={e=>setWpKey(e.target.value)} placeholder="ck_xxxx"/>
        <div style={{...lbl,marginTop:10}}>Consumer Secret</div>
        <input style={inp} type="password" value={wp_secret} onChange={e=>setWpSecret(e.target.value)} placeholder="cs_xxxx"/>
        <div style={sec}>Shopify</div>
        <div style={lbl}>Store Domain</div>
        <input style={inp} value={shopify_domain} onChange={e=>setShopifyDomain(e.target.value)} placeholder="mio-negozio.myshopify.com"/>

        <div style={{...lbl,marginTop:10}}>Access Token Shopify</div>
        <input style={inp} type="password" value={shopify_token} onChange={e=>setShopifyToken(e.target.value)} placeholder="shpat_xxxx"/>
        <div style={{color:C.muted,fontSize:10,marginTop:4}}>Incolla il token dalla Dev Dashboard di Shopify Partners</div>
        {shopify_token && (
          <div style={{marginTop:8,background:C.green+"15",border:`1px solid ${C.green}44`,borderRadius:5,padding:"6px 10px",display:"flex",alignItems:"center",gap:8}}>
            <span style={{color:C.green,fontSize:12}}>✓ Token inserito</span>
            <button onClick={()=>setShopifyToken("")} style={{marginLeft:"auto",background:"none",color:C.red,border:"none",cursor:"pointer",fontSize:11}}>Rimuovi</button>
          </div>
        )}

        <div style={{display:"flex",gap:10,marginTop:20}}>
          <button onClick={()=>onSave({...store,name,wp_url,wp_key,wp_secret,shopify_domain,shopify_token})}
            style={{background:C.green+"22",color:C.green,border:`1px solid ${C.green}44`,borderRadius:6,padding:"8px 20px",fontSize:13,fontFamily:"inherit",cursor:"pointer",fontWeight:600,flex:1}}>✓ Salva</button>
          <button onClick={onClose} style={{background:"none",color:C.muted,border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 16px",fontSize:13,fontFamily:"inherit",cursor:"pointer"}}>Annulla</button>
        </div>
      </div>
    </div>
  );
}

// ─── PROGRESS BAR ─────────────────────────────────────────────────────────────
function ProgressBar({ loaded, total, label }) {
  const pct = total>0?Math.min(100,Math.round((loaded/total)*100)):0;
  return (
    <div style={{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:6,padding:"10px 14px",marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:6,fontSize:12}}>
        <span style={{color:C.accent}}>{label}</span>
        <span style={{color:C.muted}}>{loaded} / {total||"?"} ({pct}%)</span>
      </div>
      <div style={{background:C.border,borderRadius:999,height:6,overflow:"hidden"}}>
        <div style={{background:`linear-gradient(90deg,${C.accent},${C.teal})`,width:`${pct}%`,height:"100%",borderRadius:999,transition:"width 0.3s ease"}}/>
      </div>
    </div>
  );
}

// ─── FETCH OPTIONS ─────────────────────────────────────────────────────────────
function FetchOptions({ opts, onChange, entity, cats, selCategory, onSelectCat, onFetchCats, fetchingCats }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{background:C.surface2,borderBottom:`1px solid ${C.border}`}}>
      <button onClick={()=>setOpen(o=>!o)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",padding:"6px 20px",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8,width:"100%"}}>
        <span style={{color:open?C.accent:C.muted}}>▼ Opzioni fetch</span>
        {opts.limit&&<Badge label={`max ${opts.limit}`} color={C.yellow}/>}
        {opts.after&&<Badge label={`dal ${opts.after}`} color={C.purple}/>}
        {opts.before&&<Badge label={`al ${opts.before}`} color={C.purple}/>}
        {selCategory&&cats.find(c=>c.id===selCategory)&&<Badge label={`🗂 ${cats.find(c=>c.id===selCategory).name}`} color={C.teal}/>}
      </button>
      {open&&(
        <div style={{padding:"12px 20px 16px",display:"flex",gap:20,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div>
            <div style={{color:C.muted,fontSize:10,marginBottom:4}}>LIMITE <span style={{opacity:0.6}}>(vuoto=tutti)</span></div>
            <div style={{display:"flex",gap:5}}>
              {["5","10","50","100","500"].map(n=>(
                <button key={n} onClick={()=>onChange("limit",opts.limit===n?"":n)}
                  style={{background:opts.limit===n?C.yellow+"22":"none",color:opts.limit===n?C.yellow:C.muted,border:`1px solid ${opts.limit===n?C.yellow+"55":C.border}`,borderRadius:4,padding:"3px 10px",fontSize:12,fontFamily:"inherit",cursor:"pointer"}}>{n}</button>
              ))}
              <input type="number" value={opts.limit} onChange={e=>onChange("limit",e.target.value)} placeholder="n"
                style={{background:C.bg,color:C.yellow,border:`1px solid ${C.border}`,borderRadius:4,padding:"3px 8px",fontSize:12,fontFamily:"inherit",width:65,outline:"none"}}/>
            </div>
          </div>
          <div>
            <div style={{color:C.muted,fontSize:10,marginBottom:4}}>DAL</div>
            <input type="date" value={opts.after} onChange={e=>onChange("after",e.target.value)}
              style={{background:C.bg,color:C.purple,border:`1px solid ${C.border}`,borderRadius:4,padding:"4px 8px",fontSize:12,fontFamily:"inherit",outline:"none",colorScheme:"dark"}}/>
          </div>
          <div>
            <div style={{color:C.muted,fontSize:10,marginBottom:4}}>AL</div>
            <input type="date" value={opts.before} onChange={e=>onChange("before",e.target.value)}
              style={{background:C.bg,color:C.purple,border:`1px solid ${C.border}`,borderRadius:4,padding:"4px 8px",fontSize:12,fontFamily:"inherit",outline:"none",colorScheme:"dark"}}/>
          </div>
          {entity==="products"&&(
            <div>
              <div style={{color:C.muted,fontSize:10,marginBottom:4}}>CATEGORIA</div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <select value={selCategory||""} onChange={e=>onSelectCat(e.target.value?parseInt(e.target.value):null)}
                  style={{background:C.bg,color:selCategory?C.teal:C.muted,border:`1px solid ${selCategory?C.teal+"55":C.border}`,borderRadius:4,padding:"4px 8px",fontSize:12,fontFamily:"inherit",minWidth:150,outline:"none"}}>
                  <option value="">Tutte le categorie</option>
                  {cats.map(c=><option key={c.id} value={c.id}>{c.name} ({c.count||0})</option>)}
                </select>
                <button onClick={onFetchCats} disabled={fetchingCats}
                  style={{background:C.teal+"22",color:fetchingCats?C.muted:C.teal,border:`1px solid ${C.teal}44`,borderRadius:4,padding:"4px 10px",fontSize:11,fontFamily:"inherit",cursor:fetchingCats?"not-allowed":"pointer"}}>
                  {fetchingCats?"⏳":cats.length?"🔄":"⬇"} {cats.length?cats.length:"Carica"}
                </button>
              </div>
            </div>
          )}
          <button onClick={()=>{onChange("limit","");onChange("after","");onChange("before","");onSelectCat(null);}}
            style={{background:"none",color:C.red,border:`1px solid ${C.red}33`,borderRadius:4,padding:"4px 10px",fontSize:11,fontFamily:"inherit",cursor:"pointer",alignSelf:"flex-end"}}>✕ Reset</button>
        </div>
      )}
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [appSettings, setAppSettings]   = useState(() => LS.get("app_settings", { clientId:"", clientSecret:"", appUrl: window.location.origin }));
  const [showAppSettings, setShowAppSettings] = useState(false);
  const [stores, setStores]             = useState(() => LS.get("stores", [{...newStore(1),name:"Store Demo"}]));
  const [activeStore, setActive]        = useState(0);
  const [editStore, setEditStore]       = useState(null);
  const [entity, setEntity]             = useState("products");
  const [subtab, setSubtab]             = useState(0);
  const [liveData, setLiveData]         = useState({});
  const [categories, setCategories]     = useState({});
  const [selCategory, setSelCat]        = useState(null);
  const [mappings, setMappings]         = useState(DEFAULT_MAPPING);
  const [metaTypeMap, setMTMap]         = useState({});
  const [syncLogs, setSyncLogs]         = useState([]);
  const [simIndex, setSimIndex]         = useState(0);
  const [fetching, setFetching]         = useState(false);
  const [fetchingCats, setFCats]        = useState(false);
  const [pushing, setPushing]           = useState(false);
  const [progress, setProgress]         = useState(null);
  const [fetchOpts, setFetchOpts]       = useState({limit:"5",after:"",before:""});
  const abortRef                        = useRef(false);

  // Persisti stores
  useEffect(() => { LS.set("stores", stores); }, [stores]);
  useEffect(() => { LS.set("app_settings", appSettings); }, [appSettings]);

  // Gestisce ritorno OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("shopify_connected");
    const shop      = params.get("shop");
    const token     = params.get("token");
    const oauthErr  = params.get("shopify_error");
    if (oauthErr) { addLog("error",`❌ OAuth: ${decodeURIComponent(oauthErr)}`); window.history.replaceState({},""," /"); return; }
    if (connected&&shop&&token) {
      const pending = sessionStorage.getItem("pending_store");
      sessionStorage.removeItem("pending_store");
      const base = pending ? JSON.parse(pending) : newStore(Date.now());
      const updated = {...base, shopify_domain:decodeURIComponent(shop), shopify_token:decodeURIComponent(token)};
      setStores(s => { const idx=s.findIndex(x=>x.id===base.id); if(idx>=0){const n=[...s];n[idx]=updated;return n;} return [...s,updated]; });
      addLog("ok",`✅ Shopify connesso: ${decodeURIComponent(shop)}`);
      window.history.replaceState({},"","/");
    }
  }, []);

  const store    = stores[activeStore];
  const dataKey  = `${store?.id}_${entity}`;
  const data     = liveData[dataKey] || [];
  const cats     = categories[store?.id] || [];
  const mapping  = mappings[entity];
  const metaTgts = [...new Set(Object.values(mapping).filter(v=>v?.startsWith("meta:")))];

  const addLog   = useCallback((type,msg)=>setSyncLogs(l=>[{type,msg,time:new Date().toLocaleTimeString("it")},...l.slice(0,99)]),[]);
  const setMap   = (f,v) => setMappings(m=>({...m,[entity]:{...m[entity],[f]:v}}));
  const setMType = (t,v) => setMTMap(m=>({...m,[t]:v}));
  const setOpt   = (k,v) => setFetchOpts(o=>({...o,[k]:v}));

  const validation = useMemo(()=>data.map(row=>({row,...validateRow(entity,flattenWC(row),mapping)})),[entity,data,mapping]);
  const okCount    = validation.filter(r=>r.ok).length;
  const errCount   = validation.filter(r=>!r.ok).length;
  const warnCount  = validation.reduce((a,r)=>a+r.warnings.length,0);

  const fetchCats = async () => {
    if (!store.wp_url||!store.wp_key){addLog("error","❌ Configura WooCommerce");return;}
    setFCats(true);
    try { const {data:raw}=await wcFetchPage({wp_url:store.wp_url,wp_key:store.wp_key,wp_secret:store.wp_secret,entity:"products/categories",page:1}); setCategories(c=>({...c,[store.id]:raw})); addLog("ok",`✅ ${raw.length} categorie`); }
    catch(e){addLog("error",`❌ ${e.message}`);}
    finally{setFCats(false);}
  };

  const doFetch = async () => {
    if (!store.wp_url||!store.wp_key){addLog("error","❌ Configura WooCommerce");return;}
    setFetching(true); abortRef.current=false;
    const limit=fetchOpts.limit?parseInt(fetchOpts.limit):Infinity;
    addLog("info",`⬇ Fetch ${entity} da ${store.name}…`);
    let allRows=[],page=1,totalPages=1,total=0;
    try {
      do {
        if (abortRef.current){addLog("warn","⚠ Interrotto");break;}
        const res=await wcFetchPage({wp_url:store.wp_url,wp_key:store.wp_key,wp_secret:store.wp_secret,entity,page,category:entity==="products"?selCategory:undefined,after:fetchOpts.after?fetchOpts.after+"T00:00:00":undefined,before:fetchOpts.before?fetchOpts.before+"T23:59:59":undefined});
        allRows=[...allRows,...res.data]; total=res.total; totalPages=res.totalPages;
        setProgress({loaded:Math.min(allRows.length,limit),total:Math.min(total,isFinite(limit)?limit:total),label:`Caricamento ${entity}…`});
        page++;
        if (allRows.length>=limit) break;
        if (page<=totalPages) await new Promise(r=>setTimeout(r,200));
      } while (page<=totalPages);
      let final=isFinite(limit)?allRows.slice(0,limit):allRows;

      // Per i prodotti variabili: carica le varianti
      if (entity==="products") {
        const variableProducts = final.filter(p => p.type === "variable");
        if (variableProducts.length > 0) {
          addLog("info", `🔄 Carico varianti per ${variableProducts.length} prodotti variabili…`);
          const withVariations = await Promise.all(final.map(async p => {
            if (p.type !== "variable") return p;
            try {
              const vars = await wcFetchVariations({ wp_url:store.wp_url, wp_key:store.wp_key, wp_secret:store.wp_secret, product_id: p.id });
              addLog("info", `🔀 Prodotto "${p.name}": ${vars.length} varianti`);
              return { ...p, _variations: vars };
            } catch(e) {
              addLog("error", `❌ Varianti "${p.name}": ${e.message}`);
              return p;
            }
          }));
          final = withVariations;
        }
      }

      setLiveData(d=>({...d,[dataKey]:final}));
      addLog("ok",`✅ ${final.length}${total>final.length?` di ${total}`:""} ${entity} caricati`);
      setSimIndex(0);setSubtab(0);
    } catch(e){addLog("error",`❌ ${e.message}`);}
    finally{setFetching(false);setProgress(null);}
  };

  const syncCollections = async () => {
    if (!store.shopify_token) { addLog("error","❌ Shopify non connesso"); return; }
    if (!data.length) { addLog("error","❌ Prima carica i prodotti da WooCommerce"); return; }
    addLog("info", "🗂 Sincronizzazione collezioni da categorie WC…");
    try {
      // Raggruppa prodotti per categoria
      const collectionsMap = {};
      data.forEach(row => {
        const cats = row.categories || [];
        cats.forEach(cat => {
          if (!collectionsMap[cat.name]) collectionsMap[cat.name] = [];
          collectionsMap[cat.name].push(row.name);
        });
      });

      const collectionsPayload = Object.entries(collectionsMap).map(([title, product_names]) => ({ title, product_names }));
      addLog("info", `🗂 ${collectionsPayload.length} categorie trovate…`);

      const res = await fetch("/api/shopify-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopify_domain: store.shopify_domain,
          shopify_token: store.shopify_token,
          collections: collectionsPayload,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      json.results.forEach(r => {
        if (r.error) addLog("error", `❌ Collezione "${r.title}": ${r.error}`);
        else addLog("ok", `✅ Collezione "${r.title}": ${r.added} prodotti associati`);
      });
    } catch(e) { addLog("error", `❌ ${e.message}`); }
  };

  const doDelete = async () => {
    if (!store.shopify_token) { addLog("error","❌ Shopify non connesso"); return; }
    if (!window.confirm(`⚠️ Sei sicuro di voler cancellare TUTTI i ${entity} da Shopify?

Questa operazione non è reversibile.`)) return;
    addLog("info", `🗑 Cancellazione ${entity} da ${store.shopify_domain}…`);
    try {
      const res = await fetch("/api/shopify-delete", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ shopify_domain:store.shopify_domain, shopify_token:store.shopify_token, entity }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      addLog("ok", `✅ Cancellati ${json.deleted} ${entity}${json.failed>0?`, ${json.failed} falliti`:""}`);
    } catch(e) { addLog("error", `❌ ${e.message}`); }
  };

  const doPush = async () => {
    if (!store.shopify_token){addLog("error","❌ Connetti Shopify via OAuth");return;}
    const toImport=validation.filter(r=>r.ok);
    if (!toImport.length){addLog("error","❌ Nessun record valido");return;}
    setPushing(true);
    addLog("info",`⬆ Importo ${toImport.length} ${entity}…`);
    let ok=0,fail=0,skipped=0;
    for (const {row} of toImport) {
      setProgress({loaded:ok+fail+skipped,total:toImport.length,label:"Importazione in Shopify…"});
      try {
        const payload = buildPayload(entity,row,mapping,metaTypeMap);
        // Per gli ordini: verifica se esiste già tramite tag wc_order_ID
        if (entity==="orders" && row.id) {
          const checkRes = await fetch("/api/shopify", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({shopify_domain:store.shopify_domain, shopify_token:store.shopify_token, entity:"check_order", check_tag:`wc_order_${row.id}`}),
          });
          const checkJson = await checkRes.json();
          if (checkJson.exists) { skipped++; addLog("info",`⏭ Ordine #${row.id} già importato, saltato`); continue; }
        }
        await shopifyPush({shopify_domain:store.shopify_domain,shopify_token:store.shopify_token,entity,payload}); ok++;
      } catch(e){fail++;addLog("error",`❌ ${e.message}`);}
      await new Promise(r=>setTimeout(r,400));
    }
    setProgress(null);
    addLog((fail>0||skipped>0)?"warn":"ok",`${fail>0?"⚠":"✅"} ${ok} ok, ${skipped} saltati, ${fail} falliti`);
    setPushing(false);
  };

  const ec = ENTITIES[entity];

  return (
    <div style={{background:C.bg,minHeight:"100vh",color:C.text,fontFamily:"'IBM Plex Mono','Fira Code',monospace",fontSize:13,display:"flex",flexDirection:"column"}}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>

      {showAppSettings&&<AppSettingsModal settings={appSettings} onSave={s=>{setAppSettings(s);setShowAppSettings(false);}} onClose={()=>setShowAppSettings(false)}/>}
      {editStore!==null&&<StoreModal store={stores[editStore]||newStore(Date.now())} appSettings={appSettings} onSave={s=>{setStores(st=>{const n=[...st];n[editStore]=s;return n;});setEditStore(null);addLog("ok",`✅ "${s.name}" salvato`);}} onClose={()=>setEditStore(null)} onLog={addLog}/>}

      {/* TOP BAR */}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"10px 20px",display:"flex",alignItems:"center",gap:12,flexShrink:0,flexWrap:"wrap",rowGap:8}}>
        <div style={{width:30,height:30,background:"linear-gradient(135deg,#1f6feb,#6d56f0)",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>⚙</div>
        <div>
          <div style={{fontFamily:"'IBM Plex Sans',sans-serif",fontWeight:700,fontSize:13}}>WP → Shopify Sync Console</div>
          <div style={{color:C.muted,fontSize:10}}>Multi-store · OAuth · Paginazione</div>
        </div>

        {/* Store tabs */}
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {stores.map((s,i)=>(
            <button key={s.id} onClick={()=>{setActive(i);setSimIndex(0);setSyncLogs([]);setSelCat(null);}}
              style={{background:activeStore===i?C.accent+"18":"transparent",color:activeStore===i?C.accent:C.muted,border:`1px solid ${activeStore===i?C.accent+"55":C.border}`,borderRadius:5,padding:"4px 11px",fontSize:12,fontFamily:"inherit",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
              🏪 {s.name} {s.shopify_token&&<span style={{color:C.green,fontSize:9}}>●</span>}
            </button>
          ))}
          <button onClick={()=>{const ns=newStore(Date.now());setStores(s=>[...s,ns]);setActive(stores.length);setEditStore(stores.length);}}
            style={{background:"none",color:C.muted,border:`1px dashed ${C.border}`,borderRadius:5,padding:"4px 10px",fontSize:12,fontFamily:"inherit",cursor:"pointer"}}>+ Store</button>
        </div>

        <div style={{marginLeft:"auto",display:"flex",gap:7,alignItems:"center"}}>
          {/* Impostazioni App */}
          <button onClick={()=>setShowAppSettings(true)}
            style={{background:appSettings.clientId?C.purple+"15":"none",color:appSettings.clientId?C.purple:C.muted,border:`1px solid ${appSettings.clientId?C.purple+"44":C.border}`,borderRadius:5,padding:"5px 10px",fontSize:12,fontFamily:"inherit",cursor:"pointer"}} title="Impostazioni OAuth App">
            {appSettings.clientId?"⚙️ App configurata":"⚙️ Configura App"}
          </button>
          <button onClick={doFetch} disabled={fetching}
            style={{background:fetching?C.surface2:C.accent+"22",color:fetching?C.muted:C.accent,border:`1px solid ${fetching?C.border:C.accent+"44"}`,borderRadius:5,padding:"5px 12px",fontSize:12,fontFamily:"inherit",cursor:fetching?"not-allowed":"pointer"}}>
            {fetching?"⏳ Fetching…":"⬇ Da WooCommerce"}
          </button>
          {fetching&&<button onClick={()=>{abortRef.current=true;}} style={{background:C.red+"22",color:C.red,border:`1px solid ${C.red}44`,borderRadius:5,padding:"5px 10px",fontSize:12,fontFamily:"inherit",cursor:"pointer"}}>✕</button>}
          <button onClick={doPush} disabled={pushing||!data.length}
            style={{background:pushing||!data.length?C.surface2:C.green+"22",color:pushing||!data.length?C.muted:C.green,border:`1px solid ${pushing||!data.length?C.border:C.green+"44"}`,borderRadius:5,padding:"5px 12px",fontSize:12,fontFamily:"inherit",cursor:pushing||!data.length?"not-allowed":"pointer"}}>
            {pushing?"⏳ Pushing…":"⬆ Su Shopify"}
          </button>
          {entity==="products" && (
            <>
              <button onClick={syncCollections} disabled={!store?.shopify_token||!data.length}
                style={{background:C.teal+"15",color:store?.shopify_token&&data.length?C.teal:C.muted,border:`1px solid ${store?.shopify_token&&data.length?C.teal+"44":C.border}`,borderRadius:5,padding:"5px 10px",fontSize:12,fontFamily:"inherit",cursor:store?.shopify_token&&data.length?"pointer":"not-allowed"}} title="Crea collezioni da categorie WC">
                🗂 Crea Collezioni
              </button>
              <button onClick={()=>{
                if(!store?.shopify_token) return;
                if(!window.confirm("Cancellare TUTTE le collezioni custom da Shopify?")) return;
                addLog("info","🗑 Cancellazione collezioni…");
                fetch("/api/shopify-delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({shopify_domain:store.shopify_domain,shopify_token:store.shopify_token,entity:"collections"})})
                  .then(r=>r.json()).then(j=>addLog("ok",`✅ Cancellate ${j.deleted} collezioni`))
                  .catch(e=>addLog("error",`❌ ${e.message}`));
              }} disabled={!store?.shopify_token}
                style={{background:C.red+"15",color:store?.shopify_token?C.red:C.muted,border:`1px solid ${store?.shopify_token?C.red+"44":C.border}`,borderRadius:5,padding:"5px 10px",fontSize:12,fontFamily:"inherit",cursor:store?.shopify_token?"pointer":"not-allowed"}} title="Cancella tutte le collezioni da Shopify">
                🗑 Collezioni
              </button>
            </>
          )}
          <button onClick={doDelete} disabled={!store?.shopify_token}
            style={{background:C.red+"15",color:store?.shopify_token?C.red:C.muted,border:`1px solid ${store?.shopify_token?C.red+"44":C.border}`,borderRadius:5,padding:"5px 10px",fontSize:12,fontFamily:"inherit",cursor:store?.shopify_token?"pointer":"not-allowed"}} title={`Cancella tutti i ${entity} da Shopify`}>
            🗑
          </button>
        </div>
      </div>

      <FetchOptions opts={fetchOpts} onChange={setOpt} entity={entity} cats={cats} selCategory={selCategory} onSelectCat={setSelCat} onFetchCats={fetchCats} fetchingCats={fetchingCats}/>

      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        {/* SIDEBAR */}
        <div style={{width:185,background:C.surface,borderRight:`1px solid ${C.border}`,padding:"12px 9px",flexShrink:0,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
          <div style={{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:6,padding:"9px 10px",marginBottom:6}}>
            <div style={{fontFamily:"'IBM Plex Sans',sans-serif",fontWeight:700,fontSize:12,color:C.accent,marginBottom:5}}>🏪 {store?.name}</div>
            <div style={{color:C.muted,fontSize:10,marginBottom:2}}>WC: {store?.wp_url?<span style={{color:C.yellow}}>✓ configurato</span>:<span style={{color:C.red}}>✗ mancante</span>}</div>
            <div style={{color:C.muted,fontSize:10,marginBottom:6}}>Shopify: {store?.shopify_token?<span style={{color:C.green}}>● connesso</span>:<span style={{color:C.red}}>✗ non connesso</span>}</div>
            {cats.length>0&&<div style={{color:C.teal,fontSize:10,marginBottom:6}}>🗂 {cats.length} categorie</div>}
            <button onClick={()=>setEditStore(activeStore)} style={{background:"none",color:C.accent,border:`1px solid ${C.accent}33`,borderRadius:4,padding:"3px 10px",fontSize:11,fontFamily:"inherit",cursor:"pointer",width:"100%"}}>✏️ Modifica</button>
          </div>

          <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:1.5,padding:"4px 5px 5px",fontFamily:"'IBM Plex Sans',sans-serif"}}>Entità</div>
          {Object.entries(ENTITIES).map(([key,cfg])=>{
            const d=liveData[`${store?.id}_${key}`]||[];
            const errs=d.length?d.map(r=>validateRow(key,flattenWC(r),mappings[key])).filter(r=>!r.ok).length:0;
            const act=entity===key;
            return (
              <button key={key} onClick={()=>{setEntity(key);setSubtab(0);setSimIndex(0);}}
                style={{background:act?cfg.color+"18":"transparent",border:`1px solid ${act?cfg.color+"55":C.border+"44"}`,borderRadius:6,padding:"8px 9px",cursor:"pointer",textAlign:"left",display:"flex",flexDirection:"column",gap:2}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{fontSize:14}}>{cfg.icon}</span>
                  <div style={{display:"flex",gap:3}}>{errs>0&&<Badge label={`${errs}!`} color={C.red}/>}{d.length>0&&<Badge label={String(d.length)} color={cfg.color}/>}</div>
                </div>
                <div style={{fontFamily:"'IBM Plex Sans',sans-serif",fontWeight:600,fontSize:12,color:act?cfg.color:C.text}}>{cfg.label}</div>
                <div style={{color:C.muted,fontSize:10}}>{d.length?`${d.length} record`:"Nessun dato"}</div>
              </button>
            );
          })}

          {metaTgts.length>0&&(
            <div style={{marginTop:10,borderTop:`1px solid ${C.border}`,paddingTop:10}}>
              <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:1.2,marginBottom:8,fontFamily:"'IBM Plex Sans',sans-serif"}}>Tipi Metafield</div>
              {metaTgts.map(t=>(
                <div key={t} style={{marginBottom:7}}>
                  <div style={{color:C.meta,fontSize:10,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.replace("meta:custom.","")}</div>
                  <select value={metaTypeMap[t]||"single_line_text_field"} onChange={e=>setMType(t,e.target.value)}
                    style={{width:"100%",background:C.bg,color:C.meta,border:`1px solid ${C.meta}33`,borderRadius:3,padding:"2px 4px",fontSize:10,fontFamily:"inherit"}}>
                    {META_TYPES.map(tp=><option key={tp} value={tp}>{tp}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* MAIN */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,background:C.surface,flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",padding:"0 14px",borderRight:`1px solid ${C.border}`,gap:6}}>
              <span>{ec.icon}</span><span style={{fontFamily:"'IBM Plex Sans',sans-serif",fontWeight:600,color:ec.color,fontSize:13}}>{ec.label}</span>
            </div>
            {SUBTABS.map((t,i)=>(
              <button key={i} onClick={()=>setSubtab(i)} style={{background:"none",border:"none",color:subtab===i?ec.color:C.muted,cursor:"pointer",padding:"10px 15px",fontSize:12,fontFamily:"inherit",borderBottom:subtab===i?`2px solid ${ec.color}`:"2px solid transparent",fontWeight:subtab===i?600:400}}>{t}</button>
            ))}
            <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center",paddingRight:14}}>
              {data.length>0&&<Badge label={`${data.length} live`} color={ec.color}/>}
              {okCount>0&&<Badge label={`${okCount} ok`} color={C.green}/>}
              {errCount>0&&<Badge label={`${errCount} err`} color={C.red}/>}
            </div>
          </div>

          <div style={{flex:1,overflow:"auto",padding:18}}>
            {progress&&<ProgressBar loaded={progress.loaded} total={progress.total} label={progress.label}/>}

            {subtab===0&&(!data.length?(
              <div style={{textAlign:"center",padding:"50px 20px"}}>
                <div style={{fontSize:36,marginBottom:14}}>📡</div>
                <div style={{fontFamily:"'IBM Plex Sans',sans-serif",fontWeight:600,fontSize:15,marginBottom:8}}>Nessun dato</div>
                <div style={{color:C.muted,fontSize:12,marginBottom:20}}>
                  {!appSettings.clientId&&<div style={{color:C.yellow,marginBottom:10}}>⚙️ Prima clicca <strong>"Configura App"</strong> in alto per inserire le credenziali OAuth Shopify</div>}
                  Poi clicca <strong style={{color:C.accent}}>✏️ Modifica</strong> per configurare lo store
                </div>
                <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:16,textAlign:"left",maxWidth:440,margin:"0 auto",fontSize:12}}>
                  <div style={{color:C.yellow,fontWeight:600,marginBottom:8}}>📋 Checklist:</div>
                  {[["App OAuth configurata",appSettings.clientId],["URL WooCommerce",store?.wp_url],["Consumer Key",store?.wp_key],["Consumer Secret",store?.wp_secret],["Shopify connesso",store?.shopify_token]].map(([l,v])=>(
                    <div key={l} style={{display:"flex",gap:8,marginBottom:4}}><span style={{color:v?C.green:C.red}}>{v?"✓":"✗"}</span><span style={{color:v?C.text:C.muted}}>{l}</span></div>
                  ))}
                </div>
              </div>
            ):(
              <div>
                <div style={{color:C.muted,fontSize:11,marginBottom:10}}>✅ {data.length} {entity} caricati</div>
                <div style={{overflowX:"auto",borderRadius:6,border:`1px solid ${C.border}`}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead><tr style={{background:C.surface2}}>{Object.keys(flattenWC(data[0])).slice(0,10).map(f=><th key={f} style={{padding:"6px 10px",textAlign:"left",color:C.field,borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap",fontWeight:500}}>{f}</th>)}</tr></thead>
                    <tbody>{data.slice(0,50).map((row,i)=>{const flat=flattenWC(row);return<tr key={i} style={{borderBottom:`1px solid ${C.border}22`,background:i%2===0?"transparent":"#ffffff04"}}>{Object.keys(flat).slice(0,10).map(f=><td key={f} style={{padding:"5px 10px",color:flat[f]?C.text:C.muted+"55",whiteSpace:"nowrap",maxWidth:150,overflow:"hidden",textOverflow:"ellipsis"}}>{typeof flat[f]==="object"?JSON.stringify(flat[f]).slice(0,40):(flat[f]||<span style={{fontStyle:"italic",fontSize:10}}>vuoto</span>)}</td>)}</tr>;})}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {subtab===1&&(
              <div>
                <div style={{color:C.muted,fontSize:11,marginBottom:10}}>Mappa i campi WooCommerce → Shopify</div>
                <div style={{display:"grid",gap:5}}>
                  {Object.keys(mapping).map(field=>{
                    const target=mapping[field]||"";const isMeta=target.startsWith("meta:");const isCat=field.startsWith("categories")||field==="_categories_names";const isIgnored=!target;
                    return(
                      <div key={field} style={{display:"grid",gridTemplateColumns:"210px 18px 1fr",alignItems:"center",gap:9,background:C.surface,border:`1px solid ${isIgnored?C.border+"33":isCat?C.teal+"44":isMeta?C.meta+"44":ec.color+"44"}`,borderRadius:5,padding:"7px 12px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{color:isCat?C.teal:C.field,fontWeight:500,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{field}</span>{isCat&&<Badge label="cat" color={C.teal}/>}</div>
                        <span style={{color:C.muted,textAlign:"center",fontSize:11}}>→</span>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          <select value={target} onChange={e=>setMap(field,e.target.value)}
                            style={{background:C.surface2,color:isCat?C.teal:isMeta?C.meta:isIgnored?C.muted:ec.color,border:`1px solid ${C.border}`,borderRadius:4,padding:"3px 7px",fontSize:12,fontFamily:"inherit",flex:1,cursor:"pointer"}}>
                            <option value="">— Non importare —</option>
                            {SHOPIFY_TARGETS[entity].filter(Boolean).map(opt=><option key={opt} value={opt}>{opt}</option>)}
                          </select>
                          {isMeta&&<span style={{color:C.meta,fontSize:10}}>{metaTypeMap[target]||"text"}</span>}
                          {isIgnored&&<span style={{color:C.muted,fontSize:10,fontStyle:"italic"}}>ignorato</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {subtab===2&&(!data.length?<div style={{color:C.muted,textAlign:"center",padding:40}}>Prima carica i dati ⬇</div>:(
              <div>
                <div style={{display:"flex",gap:7,marginBottom:12}}><Badge label={`${okCount}/${data.length} validi`} color={C.green}/>{errCount>0&&<Badge label={`${errCount} errori`} color={C.red}/>}{warnCount>0&&<Badge label={`${warnCount} avvisi`} color={C.yellow}/>}</div>
                <div style={{display:"grid",gap:5}}>
                  {validation.map((r,i)=>{const flat=flattenWC(r.row);const label=flat.name||flat.id||`#${i}`;const sub=flat.sku||flat["billing.email"]||"";return(
                    <div key={i} style={{background:C.surface,border:`1px solid ${r.ok?C.green+"33":C.red+"44"}`,borderRadius:5,padding:"8px 13px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:(r.errors.length||r.warnings.length)?5:0}}><span>{r.ok?"✅":"❌"}</span><span style={{fontFamily:"'IBM Plex Sans',sans-serif",fontWeight:600,fontSize:12}}>{label}</span>{sub&&<span style={{color:C.muted,fontSize:11}}>{sub}</span>}</div>
                      {r.errors.map((e,j)=><div key={j} style={{color:C.red,fontSize:11,marginLeft:24,marginBottom:2}}>✗ {e}</div>)}
                      {r.warnings.map((w,j)=><div key={j} style={{color:C.yellow,fontSize:11,marginLeft:24,marginBottom:2}}>⚠ {w}</div>)}
                      {r.ok&&!r.warnings.length&&<div style={{color:C.green,fontSize:11,marginLeft:24}}>Pronto per Shopify</div>}
                    </div>
                  );})}
                </div>
              </div>
            ))}

            {subtab===3&&(!data.length?<div style={{color:C.muted,textAlign:"center",padding:40}}>Prima carica i dati ⬇</div>:(
              <div>
                <div style={{display:"flex",gap:5,marginBottom:12,flexWrap:"wrap"}}>
                  {data.map((row,i)=>{const flat=flattenWC(row);const lbl=flat.name||flat.id||`#${i}`;return<button key={i} onClick={()=>setSimIndex(i)} style={{background:simIndex===i?ec.color+"22":C.surface,color:simIndex===i?ec.color:validation[i]?.ok?C.muted:C.red,border:`1px solid ${simIndex===i?ec.color:C.border}`,borderRadius:4,padding:"3px 10px",fontSize:12,fontFamily:"inherit",cursor:"pointer",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{lbl}</button>;})}
                </div>
                {(()=>{const row=data[simIndex];const payload=buildPayload(entity,row,mapping,metaTypeMap);const vr=validation[simIndex];return(
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                    <div>
                      <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:1,marginBottom:7}}>WooCommerce Input</div>
                      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:12,maxHeight:440,overflow:"auto"}}>
                        {Object.entries(flattenWC(row)).map(([k,v])=><div key={k} style={{display:"flex",gap:7,marginBottom:3}}><span style={{color:k.startsWith("categories")?C.teal:C.field,minWidth:155,flexShrink:0,fontSize:11}}>{k}:</span><span style={{color:v?C.text:C.muted,fontSize:11,wordBreak:"break-all",fontStyle:v?"normal":"italic"}}>{typeof v==="object"?JSON.stringify(v).slice(0,60):String(v||"null")}</span></div>)}
                      </div>
                    </div>
                    <div>
                      <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:1,marginBottom:7,display:"flex",gap:7,alignItems:"center"}}>Shopify Payload {vr?.ok?<Badge label="✓ valido" color={C.green}/>:<Badge label="⚠ errori" color={C.red}/>}</div>
                      <div style={{background:"#0a1a0a",border:`1px solid ${C.green}33`,borderRadius:7,padding:12,maxHeight:440,overflow:"auto"}}>
                        <pre style={{margin:0,fontSize:12,lineHeight:1.65}}>{JSON.stringify(payload,null,2).split("\n").map((line,idx)=>{let c=C.text;if(line.match(/"(namespace|key|type|value)":/))c=C.meta;else if(line.match(/"product_type":/))c=C.teal;else if(line.match(/"(title|email|name)":/))c=ec.color;else if(line.match(/"(sku|price|inventory)":/))c=C.field;return<span key={idx} style={{color:c,display:"block"}}>{line}</span>;})}</pre>
                      </div>
                    </div>
                  </div>
                );})()}
              </div>
            ))}

            {subtab===4&&(
              <div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}><span style={{color:C.muted,fontSize:11}}>{syncLogs.length} eventi</span><button onClick={()=>setSyncLogs([])} style={{background:"none",color:C.red,border:`1px solid ${C.red}33`,borderRadius:4,padding:"2px 9px",fontSize:11,fontFamily:"inherit",cursor:"pointer"}}>🗑 Svuota</button></div>
                {!syncLogs.length?<div style={{textAlign:"center",color:C.muted,padding:40}}><div style={{fontSize:30,marginBottom:8}}>📋</div>Nessun evento</div>:(
                  <div style={{display:"grid",gap:4}}>
                    {syncLogs.map((log,i)=>{const color=log.type==="ok"?C.green:log.type==="error"?C.red:log.type==="warn"?C.yellow:C.muted;return<div key={i} style={{background:C.surface,border:`1px solid ${color}22`,borderRadius:5,padding:"6px 13px",display:"flex",gap:12}}><span style={{color:C.muted,fontSize:11,whiteSpace:"nowrap"}}>{log.time}</span><span style={{color,fontSize:12}}>{log.msg}</span></div>;})}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
