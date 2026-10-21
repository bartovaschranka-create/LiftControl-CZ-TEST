> Historical first-stage proposal; superseded by UI-REVIEW.md after visual approval.

# Pracovní prostředí — etapa 1, návrh k vizuálnímu schválení

Samostatná větev `agent/workspace-role-navigation` vychází z testovacího `main` na `fa32e1dd957df930689eb3e857675978ddf039e0` (sloučený PR #53). Cíl nového draft PR je výhradně `bartovaschranka-create/LiftControl-CZ-TEST`. Neslučovat a nenasazovat před schválením této etapy. Předchozí souhlas s nasazením PR #53 se na tuto novou etapu nepřenáší.

## Zjištěný model

Klient načítá Firebase `doctype-test`, stejný projekt/kolekce jako dosud. Název TEST není izolace dat. V souvisejícím klientském kódu není přihlašovací tok, Firebase Auth ani vyhodnocování rolí Technik/Vedoucí/Revizní technik. Existuje pouze lokální `liftcontrol_last_entered_by`; `getEnteredByDefault()` navíc obsahuje výchozí jméno a není důkazem identity. Nové UI proto neoznačuje toto jméno za přihlášeného uživatele, nepředstírá ověřenou roli a nenabízí správu účtů.

Tři prostředí jsou pouze **prezentační pracovní režimy**, dostupné nad stejnými původními funkcemi a oprávněními. Skrytá záložka není zabezpečení. Nemění se databázové role, oprávnění ani Security Rules; serverový autorizační model se netestoval živými operacemi.

## Co se mění

- Společný přehled: výběr tří pracovních prostředí, aktuální datum, obnovený původní svátek, pravdivá informace o nedostupnosti ověřeného přihlášení a přístup k původnímu nastavení. Žádné současné seznamy všech strojů, revizí, závad či dokumentů. Osobní úkoly se bez ověřené identity nepřiřazují odhadem.
- Svátek: přesunutý původní uzel `homeNameDayBox`, plně zachovaný lokální kalendář `CZECH_NAMEDAYS` a `getLightHolidayText()`. Žádná nová síťová služba ani druhý kalendář.
- Technik: vyhledávání/evidence, původní čtvrtletní kontrola a archiv, závady, opravy, historie, dokumentace a QR skener. Bez revizní agendy v hlavním pracovním menu. „Moje stroje“ se nepředstírají bez existující vazby vlastnictví/přiřazení.
- Vedoucí: existující evidence, termíny, otevřené závady, opravy, provedené práce a historie změn. Správa uživatelů je výslovně označená jako nepodporovaná, bez tlačítek pro nové operace. Žádné nové editování kmenové evidence.
- Revizní technik: původní nová revize, existující uložené rozpracované revize (`draft`), původní archiv/historie/protokoly včetně náhledu, tisku a exportu a společné technické podklady. Bez samostatných provozních menu čtvrtletních kontrol a oprav.
- V pracovním prostředí je vždy otevřená jen jedna sekce. Původní nativní obrazovky se vracejí do zvoleného prostředí. Technický průkaz zůstává společný a beze změny.

## Znovupoužité funkce / co vyžaduje další práci

| Funkce | Provedení této etapy |
| --- | --- |
| Kontroly, závady, opravy, fotky, QR | Volají se původní handlery; žádná druhá implementace |
| Vyhledávání a společný průkaz | Přesouvají se existující uzly se zachováním událostí a ID |
| Termíny a otevřené požadavky | Znovu použitý čtecí přehled z PR #53, jen v příslušné sekci |
| Nová/rozpracovaná/uložená revize | Původní formulář, záznamy, archiv a generátory |
| Osobní úkoly / moje stroje | Vyžadují doloženou identitu a existující vazby; nepředstírají se |
| Skutečné role / správa účtů | Vyžadují samostatnou analýzu a schválení autorizačního modelu |
| Nová správa kmenových údajů stroje | Nepřidává se; dostupná je současná evidence a průkaz |
| Akce průkazu specifické pro role | Další etapa po schválení; technická data ani referenční ročníky se nyní nemění |
| Rozsáhlé překreslení formulářů a protokolů | Mimo rozsah první etapy |

## Rozepsaná práce

Přepnutí prostředí nevolá sběr/uložení/reset formuláře. Otevřené původní modální uzly se dočasně skryjí bez změny jejich polí, podpisů, souborových vstupů či pracovních objektů. Návrat do původního prostředí nabízí „Pokračovat v rozepsané práci“, který obnoví stejné uzly. Proti přepsání sdíleného formuláře jiným prostředím se nové akce pozastaví do obnovení rozpracované práce. Jde pouze o stav v paměti; nevytváří se nový persistence model ani příslib přežití pádu/reloadu. Původní funkce ukládání konceptů zůstávají zachované.

## Bezpečnost a přesný rozsah zdroje

`index.html` má proti nasazenému `fa32e1d` jen dva nové prezentační odkazy (CSS + JS). Test ověřuje rovnost celého zbytku souboru: Firebase, ukládání, původní kalendář, formuláře, technická přednastavení, RZ generátor, obsah, tiskové styly a export se nezměnily. Nové CSS je omezené na obrazovku. Workflow jen doplňuje kopírování dvou souborů; trigger zůstává `main`/ruční. Žádné živé zápisy, mazání, migrace ani změny produkčního repozitáře.

Starší test `unchanged-app.test.cjs` nyní používá pevný původní commit místo pohyblivého `origin/main`, aby byl použitelný i po sloučení PR #53. Nový test porovnává právě nasazený základ `fa32e1d`.

## Ověření a náhledy

```
node --check assets/workspace-ui.js
node tests/inline-syntax.test.cjs
node tests/unchanged-app.test.cjs
node tests/workspace-ui.test.cjs
node tests/machine-passport.test.cjs
node tests/dispatch-ui.test.cjs
node tests/build-workspace-preview.cjs
git diff --check
```

Browserové testy: Playwright v `CODEX_NODE_MODULES`, místní Edge, čistý profil, vypnuté service workery, povoleny jen místní GET souborů. Veškerá externí síť je blokovaná. Pokryto: shoda původního zdroje/RZ, původní offline svátek, pravdivá identita, unikátní ID, oddělená menu, původní směrování, žádná nová správa uživatelů, zachování a obnova rozepsaných polí, společný průkaz, návrat z původní stránky, neměnné záznamy/localStorage a šířky 320/390/768/1440. Původní dispatch adaptér se navíc testuje samostatně, společná karta má svou původní regresi.

Statický export vytvoří do lokální sousední složky `artifacts` čtyři HTML (`workspace-home`, `workspace-technician`, `workspace-manager`, `workspace-inspector`) a osm PC/mobilních PNG. Obsahuje skutečný dostupný lokální přehled, nikoli fingovaného přihlášeného uživatele. Export nemá skripty/Firebase, všechny akce ukládání jsou vypnuté a CSP zakazuje síť i formuláře. Snímky skutečných evidenčních dat se do veřejného PR nepublikují.

Živé ukládání/synchronizace Firebase, serverová oprávnění, fyzické telefony a fotoaparáty ani odolnost nového navigačního stavu proti zavření prohlížeče nebyly testovány. Nejsou tím prohlášeny za nové funkce. Nový PR zůstává draft bez sloučení a nasazení.
