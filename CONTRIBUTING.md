# Contribuire a Open Trainer

Grazie! Questo è un progetto personale e gratuito: le proposte sono benvenute, i tempi di risposta non sono garantiti.

## Prima di iniziare
- Per problemi di **sicurezza** non aprire una issue: segui [SECURITY.md](SECURITY.md).
- Per un bug, descrivi cosa è successo, il browser (Edge o Chrome) e il trainer. Se serve il **log di debug** (Impostazioni → DEBUG, spento di serie), **le issue sono pubbliche**: aprilo prima con un editor di testo e allega solo l'estratto che serve. Contiene watt, cadenza, FC, tempi, nomi dei dispositivi Bluetooth e dei piani, versione del browser e scheda video; non contiene password né token, ma controlla comunque.
- Per una funzione nuova, apri prima una issue: così evitiamo lavoro inutile.

## Come si lavora
- Nessun passaggio di compilazione e **nessuna dipendenza npm** nel sito: JavaScript a moduli ES, CSS semplice. Le librerie incluse (three.js) restano in `js/vendor/` e vanno elencate in [NOTICE.md](NOTICE.md).
- Prova in locale: `avvia.bat` (serve Node) oppure `node serve.mjs` → http://localhost:8080/ (il Bluetooth funziona su https o localhost).
- Test: `npm test` deve passare tutto. Ogni correzione di un difetto porta un test che fallisce senza la correzione. Un trainer Bluetooth finto nei test deve avere **solo** i metodi dell'API vera.
- Non aggiungere script o caratteri caricati da altri siti, né chiamate di rete nuove senza una buona ragione (la CSP le blocca). Qualunque cosa arrivi da file o dal cloud va validata (vedi `js/settings.js`, `js/plan.js`).
- Niente chiavi, token, password, file personali (piano, storico, `.fit`) nei commit. Niente loghi o grafica ufficiale di marchi di terzi.
- I testi dell'interfaccia sono in italiano.

## Licenza dei contributi
Inviando una modifica accetti che sia rilasciata con la stessa licenza del progetto, **AGPL-3.0-or-later** (vedi [LICENSE](LICENSE)). Mantieni in cima ai file l'intestazione `SPDX-License-Identifier`.
