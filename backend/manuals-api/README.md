# LiftControl CZ Manuals API

Backend API pro modul **Manuály** v aplikaci LiftControl CZ.

## Cíl

Endpoint dohledá oficiální manuál výrobce JLG nebo Genie, stáhne PDF pouze z povolené domény, vytáhne textovou vrstvu po skutečných stránkách a vrátí bezpečný strukturovaný výsledek pro frontend.

API nesmí vymýšlet servisní postupy. Pokud postup není doložitelný textem z manuálu a konkrétní stránkou, vrací `not_found`, `warn` nebo prázdné `steps`.

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
  "serialRange": "serial number 0300000000 and up",
  "originalUrl": "https://www.jlg.com/...",
  "steps": [
    {
      "text": "Český krok doložený manuálem.",
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
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_TIMEOUT_MS=90000
OPENAI_MAX_PAGES=5
OPENAI_MAX_CHARS=12000
MAX_PDF_BYTES=15728640
DOWNLOAD_TIMEOUT_MS=15000
FIREBASE_STORAGE_BUCKET=doctype-test.firebasestorage.app
FIREBASE_MANUALS_URL_BASE=
FIREBASE_MANUALS_MAX_PDF_BYTES=157286400
MANUAL_INDEX_MAX_BYTES=26214400
LOCAL_MANUALS_ROOT=C:\Users\bartos\Desktop\manuály
LOCAL_MAX_PDF_BYTES=157286400
```

`BRAVE_SEARCH_API_KEY` je povinný pro hledání manuálu. Nesmí být ve frontendu, v `index.html`, v GitHub Pages ani v repozitáři.

`OPENAI_API_KEY` je fakticky nutný pro vrácení českého strukturovaného postupu. Bez OpenAI backend zůstane v bezpečném fallbacku: zobrazí nalezený manuál, varianty a upozornění, ale nevrátí servisní kroky.

`LOCAL_MANUALS_ROOT` je volitelná backendová cesta ke staženým PDF manuálům. Pro JLG backend nejdřív zkusí lokální katalog `manuals/jlg/index.json` a teprve potom Brave Search. PDF soubory se neukládají do frontendu ani do `index.html`. Velké PDF manuály necommituj do repozitáře; katalog obsahuje jen názvy souborů a modely.

`LOCAL_MAX_PDF_BYTES` je samostatný limit pro lokální PDF, protože některé stažené JLG service manuály mají přes 100 MB. Internetové stahování dál používá `MAX_PDF_BYTES`.

## Firebase Storage manuals

JLG PDF manuals are referenced from the catalog `manuals/jlg/index.json` by `storagePath`.
The current Firebase Storage upload keeps the selected JLG PDF files in the bucket root, for example:

```text
450AJ bez pvc.pdf
450AJ pvc2307.pdf
520aj pvc2207.pdf
```

A future cleaner layout can use `manuals/jlg/service/<file>.pdf`, but the catalog should match the real uploaded `gs://` object paths so the PDFs do not need to be uploaded again.

The backend resolves each `storagePath` to:

```text
https://firebasestorage.googleapis.com/v0/b/<FIREBASE_STORAGE_BUCKET>/o/<encoded-storage-path>?alt=media
```

Source priority:

1. Firebase URL from the catalog or generated from `storagePath`.
2. Local file from `LOCAL_MANUALS_ROOT` for development only.
3. Brave Search as fallback.

Do not store PDF files in GitHub, GitHub Pages, the frontend build, or `index.html`.
`FIREBASE_MANUALS_URL_BASE` is optional and only needed if the manuals are later served through a custom Firebase/Google Storage download base.
`FIREBASE_MANUALS_MAX_PDF_BYTES` sets the trusted Firebase catalog PDF size limit; JLG service manuals can be much larger than the generic web-search PDF limit.

## Textové indexy velkých manuálů

Velké JLG service manuály mohou být příliš velké pro přímé PDF zpracování ve Vercel serverless funkci. Backend proto před stažením PDF nejdřív zkusí načíst textový index po stránkách.

Výchozí umístění indexu k PDF v katalogu je vždy vedle skutečného `storagePath` PDF:

```text
PDF storagePath: 450AJ pvc2307.pdf
Index storagePath: 450AJ pvc2307.pages.json
```

Pokud budou PDF později přesunuta do složky, index se odvodí stejně:

```text
PDF storagePath: manuals/jlg/service/450AJ pvc2307.pdf
Index storagePath: manuals/jlg/service/450AJ pvc2307.pages.json
```

Formát JSON:

```json
{
  "version": 1,
  "manual": "JLG 450AJ Service Manual PVC 2307",
  "maker": "JLG",
  "model": "450AJ",
  "models": ["450 AJ", "450AJ"],
  "manualType": "service",
  "edition": "PVC 2307",
  "issueDate": "",
  "serialRange": "B300000000 and up",
  "pages": [
    {
      "page": 436,
      "title": "Tilt Sensor Calibration",
      "chapter": "JLG Control System",
      "keywords": ["tilt sensor", "calibration", "level sensor", "angle sensor"],
      "text": "...",
      "images": [
        {
          "figure": "Figure 7-18",
          "bbox": "",
          "caption": "Tilt Sensor"
        }
      ],
      "embedding": []
    }
  ]
}
```

`text` zůstává čistý text vytažený z PDF stránky a používá se pro citace. `title`, `chapter` a `keywords` pomáhají rychleji najít správnou stránku, ale nenahrazují zdrojovou citaci z manuálu.

Pokud bude index uložen jinde, přidej do záznamu v `manuals/jlg/index.json` pole `indexStoragePath` nebo `indexUrl`.

Jednorázové vytvoření indexu z lokálně staženého PDF:

```bash
node scripts/build-manual-index.mjs "C:\Users\bartos\Desktop\manualy_JLG_k_nahrani\450AJ pvc2307.pdf" "450AJ pvc2307.pages.json" --manual "JLG 450AJ Service Manual PVC 2307" --maker JLG --model 450AJ --models "450 AJ,450AJ" --manual-type service --edition "PVC 2307" --serial-range "B300000000 and up"
```

Volitelné vytvoření embeddingů při indexaci:

```bash
set OPENAI_API_KEY=<klic>
node scripts/build-manual-index.mjs "C:\Users\bartos\Desktop\manualy_JLG_k_nahrani\450AJ pvc2307.pdf" "450AJ pvc2307.pages.json" --manual "JLG 450AJ Service Manual PVC 2307" --maker JLG --model 450AJ --embeddings
```

Vytvořený `.pages.json` nahraj do Firebase Storage například sem:

```text
450AJ pvc2307.pages.json
```

Za běhu backend vyhledává nejdřív v indexu. Originální PDF stáhne až ve chvíli, kdy index neexistuje, nebo když budoucí PDF výstup bude potřebovat originální obrázky/stránky.

## PDF Parser

Backend používá `pdfjs-dist` legacy build pro Node 20/Vercel. Parser vrací samostatný objekt pro každou stránku:

```json
[
  { "page": 1, "text": "..." },
  { "page": 2, "text": "..." }
]
```

OCR se nepoužívá. Pokud PDF nemá čitelnou textovou vrstvu, API vrátí `not_found`.

## Ověření modelu a výrobního čísla

Před strukturováním postupu API kontroluje:

- titulní a první stránky,
- stránky obsahující výrazy jako `serial number`, `serial range`, `S/N`, `from serial`, `before serial`,
- shodu modelu,
- doložený rozsah výrobních čísel, pokud je v manuálu uveden.

Výrobní číslo se nerozhoduje pouhým spojením číslic. Backend ho rozdělí na:

- prefix / produktovou řadu,
- číselnou pořadovou část,
- případný suffix,
- normalizovanou původní hodnotu.

Pokud manuál uvádí alfanumerický prefix, musí odpovídat. Například rozsah `GS30D-15000 and up` nesmí projít pro stroj `GS30E-16000` jen proto, že má podobné číslice. Pokud rozsah nejde bezpečně rozebrat, výsledek je maximálně `warn`, ne `ok`.

Výsledky:

- `ok`: model odpovídá a výrobní číslo je v doloženém rozsahu, nebo manuál jednoznačně uvádí produktovou řadu bez serial omezení,
- `warn`: model pravděpodobně odpovídá, ale rozsah výrobního čísla nelze prokazatelně ověřit,
- `not_found`: model nebo výrobní číslo prokazatelně neodpovídá.

`serialRange` musí být citace nebo výřez z manuálu, ne odhad AI.

## Validace AI výstupu

OpenAI odpověď je vyžadována jako striktní JSON schema. Každý krok i bezpečnostní bod musí mít:

```json
{
  "text": "český krok",
  "sourceQuote": "exact English quote",
  "page": 42
}
```

Backend nejdřív ověří:

- stránka existuje,
- `sourceQuote` je právě na uvedené stránce,
- citace není příliš krátká nebo obecná,
- citace odpovídá hledanému úkonu nebo bezpečnostnímu upozornění.

Potom běží druhý oddělený validační krok přes OpenAI. Ten neposuzuje celý manuál, ale pouze vztah:

- český krok,
- přesná citace,
- zdrojová stránka.

Validátor vrací striktní JSON:

```json
{
  "supported": true,
  "reason": ""
}
```

Krok projde pouze tehdy, když je český text překladem nebo úzkou parafrází citace. Nesmí přidat nové úkony, nástroje, hodnoty ani bezpečnostní pokyny. Při chybě, nejistotě nebo nulovém počtu ověřených kroků backend vrátí `not_found`.

## Oficiální zdroje

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

## Lokální test

```bash
pnpm install
pnpm test
pnpm run check
pnpm audit --prod
```

## Nasazení na Vercel

Backend zatím nenasazuj, dokud není PR zkontrolované.

Po schválení:

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

## Povinné upozornění

Každá odpověď musí obsahovat:

```text
Při rozporu má vždy přednost originální manuál výrobce.
```
