# LiftControl CZ Manuals API

Backend API pro modul **Manualy** v aplikaci LiftControl CZ.

## Cil

Endpoint dohleda oficialni manual vyrobce JLG nebo Genie, stahne PDF pouze z povolene domeny, vytahne textovou vrstvu po skutecnych strankach a vrati bezpecny strukturovany vysledek pro frontend.

API nesmi vymyslet servisni postupy. Pokud postup neni dolozitelny textem z manualu a konkretni strankou, vraci `not_found`, `warn` nebo prazdne `steps`.

## Endpoint

```http
POST /api/manuals/search
Content-Type: application/json
```

Request:

```json
{
  "maker": "JLG",
  "model": "450AJ",
  "serial": "0300...",
  "task": "diagnostika zavady"
}
```

Response:

```json
{
  "status": "ok",
  "maker": "JLG",
  "model": "450AJ",
  "serial": "0300...",
  "manualTitle": "JLG 450AJ Service Maintenance Manual",
  "manualType": "service",
  "serialRange": "serial number 0300000000 and up",
  "originalUrl": "https://www.jlg.com/...",
  "steps": [
    {
      "text": "Cesky krok dolozeny manualem.",
      "sourceQuote": "Exact English quote from the manual.",
      "page": 42
    }
  ],
  "safety": [],
  "sources": [
    {
      "page": 42,
      "quote": "Exact English quote from the manual."
    }
  ],
  "message": "Pri rozporu ma vzdy prednost originalni manual vyrobce.",
  "variants": []
}
```

## Environment Variables

Zkopiruj `.env.example` a nastav hodnoty ve Vercel projektu:

```text
BRAVE_SEARCH_API_KEY=
ALLOWED_ORIGINS=https://bartovaschranka-create.github.io
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
MAX_PDF_BYTES=15728640
DOWNLOAD_TIMEOUT_MS=15000
```

`BRAVE_SEARCH_API_KEY` je povinny pro hledani manualu. Nesmí byt ve frontendu, v `index.html`, v GitHub Pages ani v repozitari.

`OPENAI_API_KEY` je fakticky nutny pro vraceni ceskeho strukturovaneho postupu. Bez OpenAI backend zustane v bezpecnem fallbacku: zobrazi nalezeny manual, varianty a upozorneni, ale nevrati servisni kroky.

## PDF Parser

Backend pouziva `pdfjs-dist` legacy build pro Node 20/Vercel. Parser vraci samostatny objekt pro kazdou stranku:

```json
[
  { "page": 1, "text": "..." },
  { "page": 2, "text": "..." }
]
```

OCR se nepouziva. Pokud PDF nema citelnou textovou vrstvu, API vrati `not_found`.

## Overeni modelu a vyrobniho cisla

Pred strukturovanim postupu API kontroluje:

- titulni a prvni stranky,
- stranky obsahujici vyrazy jako `serial number`, `serial range`, `S/N`, `from serial`, `before serial`,
- shodu modelu,
- dolozeny rozsah vyrobnich cisel, pokud je v manualu uveden.

Vysledky:

- `ok`: model odpovida a vyrobni cislo je v dolozenem rozsahu, nebo manual jednoznacne uvadi produktovou radu bez serial omezeni,
- `warn`: model pravdepodobne odpovida, ale rozsah vyrobniho cisla nelze prokazatelne overit,
- `not_found`: model nebo vyrobni cislo prokazatelne neodpovida.

`serialRange` musi byt citace nebo vyrez z manualu, ne odhad AI.

## Validace AI vystupu

OpenAI odpoved je vyzadovana jako striktni JSON schema. Kazdy krok i bezpecnostni bod musi mit:

```json
{
  "text": "cesky krok",
  "sourceQuote": "exact English quote",
  "page": 42
}
```

Backend overuje:

- stranka existuje,
- `sourceQuote` je prave na uvedene strance,
- citace neni prilis kratka nebo obecna,
- citace odpovida hledanemu ukonu nebo bezpecnostnimu upozorneni,
- pri pochybnosti se konkretni krok zahodi,
- pokud nezbyde zadny overeny krok, vysledek je `not_found`.

## Oficialni zdroje

Povoleno:

- `https://genielift.com`
- `https://manuals.genielift.com`
- `https://jlg.com`

Domeny typu `jlg.com.example.com` nebo `manuals.genielift.com.evil.example` jsou odmitnute.

## Bezpecnost

Backend kontroluje:

- pouze HTTPS URL,
- povolene domeny podle vyrobce,
- domenu po kazdem presmerovani,
- zakaz localhostu a IP adres,
- maximalni pocet redirectu,
- maximalni velikost PDF,
- timeout stahovani,
- omezeni request body,
- CORS jen pro povolene originy,
- bezpecne chybove odpovedi bez uniku klicu.

## Lokalni test

```bash
pnpm install
pnpm test
pnpm run check
pnpm audit --prod
```

## Nasazeni na Vercel

Backend zatim nenasazuj, dokud neni PR zkontrolovane.

Po schvaleni:

1. Vytvor samostatny Vercel projekt z adresare:

```text
backend/manuals-api
```

2. Nastav environment variables ve Vercelu.
3. Deploy.
4. Vysledna URL bude napriklad:

```text
https://liftcontrol-manuals-api.vercel.app/api/manuals/search
```

Tuto URL pak nastav ve frontendu do:

```js
window.LIFTCHECK_MANUALS_API_URL = 'https://.../api/manuals/search';
```

Produkcni URL nevkladej, dokud skutecne neexistuje.

## Povinne upozorneni

Kazda odpoved musi obsahovat:

```text
Pri rozporu ma vzdy prednost originalni manual vyrobce.
```
