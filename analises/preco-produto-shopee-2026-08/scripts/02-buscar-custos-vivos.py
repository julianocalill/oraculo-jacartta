# Busca custos AO VIVO na API Tiny v3 para os SKUs usados no de-para.
# Usa o access_token já armazenado em olist_oauth_tokens (o sync de pedidos o
# renova de hora em hora). NÃO tocar no refresh_token — ele é rotativo.
# Rodar com o .env do Oráculo carregado: set -a && source .env && set +a
# Entradas: skus-usados.json (lista de SKUs) · Saída: olist-live-costs.json
import os, json, time, urllib.request, urllib.parse

S = os.environ.get("ANALISE_DIR", ".")
sb, key = os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
row = json.loads(urllib.request.urlopen(urllib.request.Request(
    f"{sb}/rest/v1/olist_oauth_tokens?select=access_token&order=updated_at.desc&limit=1",
    headers={"apikey": key, "Authorization": f"Bearer {key}"})).read())[0]
base = os.environ["OLIST_API_BASE_URL"].rstrip("/")
hdr = {os.environ.get("OLIST_API_AUTH_HEADER", "Authorization"):
           f"{os.environ.get('OLIST_API_AUTH_PREFIX', 'Bearer')} {row['access_token']}",
       "Accept": "application/json", "User-Agent": "curl/8.4.0"}

def get(url, tries=4):
    for i in range(tries):
        try:
            return json.loads(urllib.request.urlopen(
                urllib.request.Request(url, headers=hdr), timeout=30).read())
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(3 * (i + 1)); continue
            if e.code == 404: return None
            raise
    return None

skus = json.load(open(f"{S}/skus-usados.json"))
live, falhas = {}, []
for i, sku in enumerate(skus):
    lst = get(f"{base}/produtos?codigo={urllib.parse.quote(sku)}&limit=5")
    time.sleep(0.25)
    itens = (lst or {}).get("itens") or []
    alvo = next((it for it in itens
                 if str(it.get("sku", "")).strip().upper() == sku.strip().upper()),
                itens[0] if itens else None)
    d = get(f"{base}/produtos/{alvo['id']}") if alvo else None
    if alvo: time.sleep(0.25)
    if not d:
        falhas.append(sku); continue
    pr = d.get("precos") or {}
    live[sku] = {"precoCusto": pr.get("precoCusto"),
                 "precoCustoMedio": pr.get("precoCustoMedio"),
                 "tipo": d.get("tipo"), "situacao": d.get("situacao"),
                 "nome": d.get("descricao") or d.get("nome"),
                 "kit": d.get("kit") or []}
    if (i + 1) % 50 == 0: print(f"{i+1}/{len(skus)}...", flush=True)

json.dump(live, open(f"{S}/olist-live-costs.json", "w"), ensure_ascii=False)
print("ok:", len(live), "| falhas:", falhas)
