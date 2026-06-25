# LiftControl CZ Manuals API

Backend API pro modul **Manuály** v aplikaci LiftControl CZ.

## Cíl

Endpoint dohledá oficiální manuál výrobce JLG nebo Genie, stáhne PDF pouze z povolené domény, vytěží textovou vrstvu a vrátí bezpečný strukturovaný výsledek pro frontend.

API nesmí vymýšlet servisní postupy. Pokud postup není doložitelný textem z manuálu, vrací `not_found`, `warn` nebo prázdné `steps`.

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
  "task": "diagnostika závady"
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
  "serialRange": "",
  "originalUrl": "https://www.jlg.com/...",
  "steps": [],
  "safety": [],
  "message": "Při rozporu má vždy přednost originální manuál výrobce.",
  "variants": []
}
```

## Environment Variables

Zkopíruj `.env.example` a nastav hodnoty ve Vercel projektu:

```text
BRAVE_SEARCH_API_KEY=
ALLOWED_ORIGINS=https://bartovaschranka-create.github.io
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
MAX_PDF_BYTES=15728640
DOWNLOAD_TIMEOUT_MS=15000
```

`BRAVE_SEARCH_API_KEY` nesmí být ve frontendu, v `index.html`, v GitHub Pages ani v repozitáři.

`OPENAI_API_KEY` je volitelný. Bez něj API nevrací přeložené kroky, pokud je neumí doložit a strukturovat. To je záměrná ochrana proti halucinacím.

## Oficiální Zdroje

Povoleno:

- `https://genielift.com`
- `https://manuals.genielift.com`
- `https://jlg.com`

Domény typu `jlg.com.example.com` nebo `manuals.genielift.com.evil.example` jsou odmítnuté.

## Bezpečnost

Backend kontroluje:

- pouze HTTPS URL,
- povolené domény podle výrobce,
- doménu po každém přesměrování,
- zákaz localhostu a IP adres,
- maximální počet redirectů,
- maximální velikost PDF,
- timeout stahování,
- omezení request body,
- CORS jen pro povolené originy,
- bezpečné chybové odpovědi bez úniku klíčů.

## Lokální Test

```bash
npm install
npm test
npm run check
npm audit
```

Projekt zatím nemá externí npm závislosti.

## Nasazení Na Vercel

1. Vytvoř samostatný Vercel projekt z adresáře:

```text
backend/manuals-api
```

2. Nastav environment variables ve Vercelu.
3. Deploy.
4. Výsledná URL bude například:

```text
https://liftcontrol-manuals-api.vercel.app/api/manuals/search
```

Tuto URL pak nastav ve frontendu do:

```js
window.LIFTCHECK_MANUALS_API_URL = 'https://.../api/manuals/search';
```

Produkční URL nevkládej, dokud skutečně neexistuje.

## Poznámka K PDF

Současná implementace zpracuje PDF s dostupnou textovou vrstvou. Pokud PDF textovou vrstvu nemá, API vrátí `not_found`. OCR zatím není součástí backendu.

## Povinné Upozornění

Každá úspěšná odpověď musí obsahovat:

```text
Při rozporu má vždy přednost originální manuál výrobce.
```
