# Open Trainer

Allenamento indoor sul ciclomulino, nel browser, nello stile dei giochi di ciclismo: percorsi veri in 3D, carico **ERG che si adatta a te**, statistiche a schermo e file `.FIT` a fine seduta. Nasce per l'**Elite Suito-T** (Bluetooth FTMS) e per la frequenza cardiaca da un orologio Garmin in modalità broadcast o da una fascia.

*English: a free, open-source web app for indoor cycling (Web Bluetooth, FTMS smart trainers). Adaptive ERG, 3D routes, FIT export. No account and no server of ours: your data stays in your browser (and, only if you choose, in your own OneDrive). Interface in Italian.*

**Provalo subito:** https://eg99999.github.io/ciclomulino-app/ (Edge o Chrome su Windows; serve il Bluetooth)

## Cosa fa
- Si collega al trainer via Bluetooth e imposta i watt (ERG). Se pedali sotto 60 rpm il carico scende al 50% da solo, quando recuperi torna al 100%.
- Pausa automatica quando ti fermi, riconnessione se il segnale cade, salvataggio anti-crash.
- Quattro stili 3D (voxel, low-poly retrò, diorama, HD-2D), percorsi reali della provincia di Brescia e GPX importati, ciclocomputer simulato.
- Test FTP (rampa e 20 minuti), creatore di workout, storico, esportazione `.FIT` da importare su Garmin Connect.
- Facoltativo: sincronizzazione tra PC con il tuo account Microsoft (solo una cartella dedicata di OneDrive).
- Modalità debug (spenta di serie) che registra tutto ciò che entra e esce, utile per capire come si comporta il tuo trainer.

## Stato
Versione di prova, in verifica col trainer vero. Il Bluetooth è stato provato con trainer simulati nei test; la verifica sul Suito-T reale è in corso. Altri trainer FTMS potrebbero funzionare, ma non sono verificati.

## Privacy
Nessun account nostro, nessun server nostro, nessuna statistica, nessun cookie di tracciamento. Impostazioni, storico e percorsi importati restano nel tuo browser; se scegli una cartella dati, i file entrano ed escono da lì.

**Con l'accesso Microsoft (facoltativo)** impostazioni (compresi nome, peso, altezza e FTP), storico e percorsi importati vengono salvati nella cartella `Apps/Open Trainer` del tuo OneDrive e copiati sugli altri tuoi computer. Un GPX può rivelare dove abiti. L'app legge anche il nome del tuo account Microsoft; non vede né salva la tua password.

**Registro di debug**: spento di serie. Se lo accendi contiene watt, cadenza, FC, tempi, tasti premuti, nomi dei dispositivi Bluetooth e dei piani, versione del browser e scheda video; non contiene password né token. Resta nel browser. Se accendi anche «Salva il log anche nella cartella dati» finisce nella cartella scelta, e se quella è dentro OneDrive viene caricato su Microsoft. Prima di allegarlo a una segnalazione pubblica leggilo.

Il sito è servito da GitHub Pages, che vede il tuo indirizzo IP come ogni sito.

## Per sviluppatori
Sito statico (JavaScript a moduli ES, nessuna dipendenza npm). In locale: `node serve.mjs` oppure `avvia.bat`. Test: `npm test`. Dettagli tecnici, formato del piano e note di sicurezza: [LEGGIMI.md](LEGGIMI.md). Come contribuire: [CONTRIBUTING.md](CONTRIBUTING.md). Segnalare una vulnerabilità: [SECURITY.md](SECURITY.md).

## Licenza e marchi
Copyright (C) 2026 Gatti Elia. Software libero con licenza **GNU AGPL-3.0 o successiva** ([LICENSE](LICENSE)). Componenti di terzi, dati dei percorsi (OpenStreetMap, ODbL) e marchi: [NOTICE.md](NOTICE.md). Open Trainer non è affiliato a Garmin, Zwift, Elite, Microsoft né ad altri marchi citati.
