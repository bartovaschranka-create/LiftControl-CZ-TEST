# Stav PR54

Aktuální požadavek je dokončit TEST a po ověření izolace sloučit PR54 a nasadit GitHub Pages výhradně v LiftControl-CZ-TEST. Detail implementace a testů: UI-REVIEW.md. Technická data se pouze čtou; RZ a původní ukládací rutiny zůstávají beze změn. Produkci nikdy neupravovat.

Zachovej CSP, test-isolation.js, místní TEST namespace a izolované cache. LIFTCONTROL_TEST_BUILD musí být pr54-2026-10-21-v3. Nepovolovat cloud do společného doctype-test. Infolinka zůstává samostatný odkaz, API spojení je blokované. Chybějící technické údaje nevymýšlet.
