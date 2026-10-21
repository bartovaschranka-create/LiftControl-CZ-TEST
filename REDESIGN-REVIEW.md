# Karta stroje — úzký redesign

Cíl: `bartovaschranka-create/LiftControl-CZ-TEST`, pracovní větev `agent/machine-passport-redesign`, PR do `main` tohoto **testovacího repozitáře**. Ostrý repozitář `LiftCheck-CZ` se nepublikuje ani neslučuje.

## Bezpečnost dat a nasazení

Testovací aplikace používá stejné Firebase umístění jako ostrá aplikace (`doctype-test` a stejné kolekce/prefixy). Název TEST nezajišťuje izolaci. Žádný živý formulář ani cloudový zápis nebyl při ověřování použit.

Workflow `.github/workflows/pages-static.yml` spouští nasazení při push do `main` nebo ručním spuštění. Pracovní větev není nasazovací cíl. PR se neslučuje, workflow se ručně nespouští. Doplněn pouze seznam kopírovaných prezentačních souborů pro případné pozdější schválené nasazení.

Původní `index.html` se mění pouze čtyřmi vloženími: CSS, JS, kontejner a vykreslení. Ukládání, konfigurace, původní akce karty a protokol RZ včetně tisku zůstávají beze změny. Test `unchanged-app.test.cjs` kontroluje rovnost původního zdroje po odstranění těchto čtyř vložení.

## Rozsah

Antracitový pasport se žlutými akcenty, teplým pozadím a seznamy historie bez zaoblených karet. Změna je omezena na kartu stroje; dispečink a samostatné formuláře jsou další etapa.

Referenční rok je **rok kontroly**, nikoli rok výroby. Volí nejnovější dostupnou revizi/kontrolu daného roku pro stejné výrobní číslo, bez změny uložených dat či formulářových výchozích hodnot. Každý náhled uvádí konkrétní zdroj. Chybějící technické hodnoty se nedoplňují katalogovým odhadem. Obálky ukazují pouze uložené hodnoty, žádné odvozené křivky. Infolinka je odkaz na existující Plošinový poradce; její hodnoty se automaticky neimportují.

Fotografie: nejnovější dostupný přehledový snímek ze čtvrtletních kontrol podle výrobního čísla. Fallback je přesně stejný normalizovaný typ a nejbližší doložený rok výroby; je označen jako ilustrační. Bez známého roku výroby se fallback neodhaduje.

## Ověření

- `node tests/inline-syntax.test.cjs`
- `node tests/unchanged-app.test.cjs`
- `node --check assets/machine-passport.js`
- `node tests/machine-passport.test.cjs`
- `git diff --check`

Browserový test vyžaduje Playwright v `CODEX_NODE_MODULES` a místní Edge. Používá nový profil, blokované service workery a povoluje pouze GET místních souborů z tohoto checkoutu. Všechny externí požadavky jsou blokované. Ověřuje neměnnost záznamů a localStorage při přepínání roku, chybějící údaje, escapování, pořadí fotek, mobilní/tabletové/desktopové šířky a původní směrování akcí karty. Nejde o živý test synchronizace ani fyzických zařízení.

`node tests/build-safe-preview.cjs` vytvoří do sousední složky `artifacts` statický HTML náhled a desktopový/mobilní PNG ze skutečného záznamu přiložené zálohy. Export neobsahuje aplikační JavaScript; CSP zakazuje síť, skripty a formuláře, ovládací akce jsou vypnuté. V záloze nejsou parametry této čtvrtletní kontroly ani dostupná fotografie; náhled je poctivě označuje jako chybějící. Veřejný běžící náhled změny nebyl nasazen, aby se nepřipojoval ke sdílenému produkčnímu úložišti.
