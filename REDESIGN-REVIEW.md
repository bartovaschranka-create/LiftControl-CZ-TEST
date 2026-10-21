# Dispečink a technický průkaz — návrh k vizuálnímu schválení

PR #53, repozitář `bartovaschranka-create/LiftControl-CZ-TEST`, větev `agent/machine-passport-redesign`. Předchozí vizuální provedení bylo nahrazeno; tato varianta **není vizuálně schválená**. Žádné sloučení ani nasazení. Další podstránky se upraví teprve po schválení této etapy.

## Rozsah prezentace

Vizuální kompozice nyní vychází z konkrétních PNG `01_KARTA_STROJE.png` a `02_DISPECINK.png` dodaných v `LiftControl_Codex_redesign_komplet_PR53.zip`. Před odesláním byly prohlédnuty a rozpracovaná volnější varianta byla upravena na světlý identifikační pás, tři technické sloupce a kompaktní dispečerské moduly s obdélníkovým číslováním a žlutou linkou. Obrázky formuláře a ostatních protokolů jsou podklady pro pozdější etapu; v této etapě se nepřepisují.

Dispečink přidává sedmidenní pás pouze se skutečnými počty plánovaných úkolů, tabulku termínů z kontrol/revizí a odkazy na původní úkony. U termínů se bere nejnovější dostupný záznam pro výrobní číslo a druh agendy; starší import nesmí vytvořit druhý termín vedle novější revize.

- Nová horní navigace LiftControlu s vlastním monogramem LC, bez log Zeppelin/Cat. Doplňkové původní ovládání je dostupné v horním menu Nástroje; levý panel se nepoužívá.
- Hlavní stránka jako pracovní dispečink: hledání výrobního čísla, původní vstupy do formulářů, kompaktní tabulka evidence, otevřené servisní požadavky bez omezení na 48 hodin, čtecí souhrn agendy a původní plán techniků. Původní filtrované události za 48 pracovních hodin zůstávají v rozbalovacím seznamu.
- Digitální technický průkaz je samostatná stránka pod horní navigací, nikoli tmavý panel v modálním okně. Identita stroje je oddělená od referenčního náhledu, technické hodnoty jsou v dokumentačním rastru, pracovní režimy v tabulce, historie a opravy v řádcích. Fotografie upřednostňuje výrobní číslo; případný fallback je přesně stejný normalizovaný model a nejbližší doložený rok výroby, vždy označený jako ilustrační.
- Antracit, černá, teplá bílá a žlutá; rovné hrany, tabulky, linky, systémové písmo, bez statistických dlaždic a dekorativních stínů. Mobil používá posuvnou horní navigaci a jeden sloupec.
- Samostatné seznamy, formuláře a další podstránky zatím nemají nový obsahový design. Původní formuláře, jejich události a ovládací ID jsou zachované. Prezentační adaptér přesouvá existující DOM uzly, nekopíruje jejich funkční implementaci.

## Referenční roky výroby — opraveno

Volby ročníku pocházejí pouze z polí **rok výroby**, nikdy z dat kontrol. Evidované ročníky a parametry mají dohledatelný zdroj v původní revizi, čtvrtletní kontrole nebo přiložené evidenci revizí. Parametry se čtou z jednoho konkrétního zdrojového záznamu; chybějící hodnoty se neslepují z jiných ročníků ani neodhadují.

Je-li pro výrobní číslo rok výroby doložený, identita stroje jej ukazuje i při volbě jiného referenčního roku. Když rok doložený není, identita stále říká „Neznámý — nedoložen“. Výchozí orientační náhled použije nejčastější doložený rok stejného modelu v evidenci, přičemž každé výrobní číslo přispěje nejvýše jedním rokem podle nejnovějšího dostupného doloženého záznamu. Při shodném počtu nebo vzorku jediného stroje se žádný ročník automaticky nevnucuje; zůstává ruční volba orientačního náhledu. Pokud doložený ročník není ani u stejného modelu, žádný se nevymýšlí. Ruční volba jiného roku je výslovně odlišena od výchozího nejčastějšího ročníku.

Volba ročníku pouze překresluje čtecí náhled. Nemění revizi, kontrolu, skutečný rok výroby, přednastavení formuláře ani localStorage. Nevolá ukládání ani funkce doplňování formulářových výchozích parametrů. Obálky ukazují jen uložené hodnoty, bez odvozených křivek; infolinka je samostatný odkaz, její hodnoty se do stroje nepřenášejí.

## Bezpečnost a neměnnost aplikace

Testovací i ostrá aplikace mají stejné Firebase umístění. Žádný živý cloudový záznam, fotografii, synchronizaci ani uložená nastavení jsme při ověřování neměnili. Browserové testy používají nový profil, blokované service workery, pouze lokální GET souborů a blokaci všech externích požadavků.

Původní `index.html` má jen **pět prezentačních vložení**: CSS, dva JS soubory, kontejner průkazu a volání vykreslení. `unchanged-app.test.cjs` ověřuje, že po jejich odstranění je celý původní soubor shodný s `origin/main` po normalizaci konců řádků. To zahrnuje kompletní protokol RZ, jeho tisk, formuláře, našeptávače, výchozí technické parametry i Firebase/localStorage implementaci. Nové CSS je pouze pro obrazovku a cíleně pro navigační shell, hlavní stránku a průkaz.

Workflow se nadále spouští jen při push do `main` nebo ručně. Změna jen přidává kopírování prezentačních souborů do artefaktu. Pracovní větev nic nenasazuje; PR se neslučuje a workflow se ručně nespouští.

## Ověření

```
node tests/inline-syntax.test.cjs
node tests/unchanged-app.test.cjs
node --check assets/machine-passport.js
node --check assets/dispatch-ui.js
node tests/machine-passport.test.cjs
node tests/dispatch-ui.test.cjs
node tests/build-safe-preview.cjs
git diff --check
```

Browserové testy vyžadují Playwright v `CODEX_NODE_MODULES` a místní Edge. Ověřují roky výroby místo dat kontrol, neměnnost skutečné identity/uložených záznamů/localStorage, neznámý rok a modalitu podle jedinečných sériových čísel, přepnutí orientačního roku, výběr a označení fotek, escapování, původní akce a směrování formulářů, jedinečnost ID, zachované našeptávání a vstupy pro fotografie, samostatnou stránku průkazu a šířky 320/375/390/768/1440. Nejde o živý test ukládání ani fyzických mobilů.

## Náhledy k posouzení

Odchylky od kompozičních předloh jsou záměrně přiznané: přiložená offline záloha neobsahuje dostupnou fotografii ukázkového stroje, skutečný diagram obálky ani QR štítek. Žádný z těchto podkladů není nahrazen ilustrací nebo fiktivním QR. Nepřevzaly se ukázkové firemní značky, přihlášená osoba, přeprava/předání/vracení ani údajná dostupnost flotily — aplikace pro ně nemá odpovídající doložený model. Místo nich se zobrazují skutečné úkoly, závady, díly a evidované termíny. Historie zůstává členěná podle existujících druhů záznamů; výstupy RZ se nemění.

`build-safe-preview.cjs` vytvoří do sousední složky `artifacts`:

- `dispatch-preview.html`, `dispatch-preview-desktop.png`, `dispatch-preview-mobile.png`
- `machine-passport-preview.html`, `machine-passport-preview-desktop.png`, `machine-passport-preview-mobile.png`
- `dispatch-preview-narrow.png`, `machine-passport-preview-narrow.png` (320 px)

Snímky se skutečnými daty ze zálohy zůstávají pouze v lokální složce `artifacts`; do veřejného repozitáře se nepublikují. Statický lokální rozcestník zpřístupňuje obě obrazovky a PC/mobil/320px snímky bez Firebase. Přiložené originální předlohy ani jejich fiktivní data se do repozitáře nekopírují.

Jde o statické exporty skutečně vykresleného DOM se skutečnou přiloženou zálohou a evidencí revizí. Časový přehled používá den vytvoření náhledu; archivní záznamy nejsou vydávány za aktuální živá data. U dne bez uloženého plánu se zobrazí prázdný stav. Export neobsahuje aplikační skripty, Firebase, formulářové akce ani externí fotografie. CSP zakazuje skripty, síť a formuláře; původní akce jsou vypnuté, odkazy mezi oběma statickými návrhy fungují bez JS. Dostupný snímek v záloze pro ukázkový stroj není — náhled to poctivě uvádí. Žádný veřejný běžící náhled ani změna do testovacího `main` nebyly nasazeny.
