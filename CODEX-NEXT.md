# Pokračování pro Codex

Vizuální návrh byl schválen a funkce jsou již napojené ve větvi agent/workspace-role-navigation, draft PR #54 v bartovaschranka-create/LiftControl-CZ-TEST. Aktuální stav a přesné testy jsou v UI-REVIEW.md. Revizní pracoviště je oddělený vstup vedle nastavení, RZ zdroj a tisk se nemění.

Zachovej test-isolation.js, CSP, prefix místních úložišť a oddělení cache. TEST a produkce sdílejí doctype-test; cloudové připojení nesmí být zapnuto bez samostatného skutečně izolovaného testovacího backendu. Žádné migrace ani změny produkce. Testovací ukládání je pouze místní. Aktualizuj stávající draft PR; bez výslovného pokynu nic neslučuj ani nenasazuj.
