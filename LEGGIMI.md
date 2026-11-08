# Open Trainer

È un sito (PWA). Due modi per usarlo:

1. **Online (consigliato)**: pubblicato su GitHub Pages, indirizzo `https://<tuo-utente>.github.io/ciclomulino-app/`.
   Si apre in Edge/Chrome, il Bluetooth funziona perché è https, e dal menu del browser si può «Installa app» (finestra a schermo intero, funziona anche offline).
   Pubblicazione (la fai tu): copia questa cartella nel repo `ciclomulino-app`, commit e push, poi su GitHub → Settings → Pages → Branch `main`, cartella `/ (root)`.
   Il file `piano-app.json` NON viene caricato online (è in `.gitignore`): lo trascini nell'app e resta nel tuo browser.
2. **In locale** (senza internet): doppio clic su `avvia.bat` (serve Node) → http://localhost:8080/.

Test automatici: `npm test`.
Tasti: Spazio avvia/pausa (in modalità tastiera: salta) · → salta step · V vista 3ª/1ª persona · M menu · F schermo intero · N suoni.
Modalità tastiera (menu): ↑ pedala, ↓ frena, ← → sterza, Spazio salta, P pausa, Esc esci.
Anti-crash: la seduta si salva ogni 5 s nel browser; al riavvio compare «Seduta interrotta».
Non verificato: service worker/installazione (il browser di prova non lo supporta), BLE in seduta lunga, import del .FIT su Garmin Connect, 60 FPS su monitor vero.

## Percorsi reali (provincia di Brescia)
- Nel menu → PERCORSO scegli: Chiari → Brescia, Giro del lago d'Iseo da Chiari, Franciacorta da Chiari, oppure «Generato dal workout».
- Strada, curve, pendenza e quota sono quelle del tracciato; i watt restano quelli del workout. Passando da un paese compare il nome; l'ambiente grafico segue quota e paesi.
- **I tuoi percorsi veri**: da Garmin Connect apri l'attività → ingranaggio → «Esporta in GPX» (o TCX), poi trascina il file nell'app (o «Importa GPX/TCX»). Il coach ha solo l'altimetria, non le coordinate.
- I tre percorsi di partenza sono costruiti con `node tools/build-routes.mjs` (serve internet): tracciato © OpenStreetMap contributors (ODbL), quote EU-DEM Copernicus. Sono percorsi plausibili su strade ciclabili, non le tue tracce.
- «Partenza»: scegli da quale paese iniziare (es. un workout da 45' fa circa 20 km: per il lago parti da Tavernola o Lovere). Il tracciato si ripete a fine giro.
- Cartella `tools/`: `build-routes.mjs` rigenera i percorsi, `env-hints.mjs` aggiunge montagna/colline in base ai paesi.

## Primo accesso, tutorial, OneDrive
- Al primo avvio parte la **configurazione iniziale** (nome, come ricevi gli allenamenti, attrezzatura, bici e suoni) e poi il **tutorial** guidato. Si rilanciano da Menu → Aiuto.
- **OneDrive** (facoltativo): vedi `GUIDA-ONEDRIVE.md`. Il piano entra da `Apps/Open Trainer/piano-app.json`, i `.FIT` escono in `Apps/Open Trainer/fit/`.
- Il creatore di workout (fase 2) non c'è ancora: per ora i workout tuoi si importano come file `.json`.

## Open Trainer: schermate e funzioni (7 nov 2026)
Home (logo, VAI, ingranaggio) → Cosa pedaliamo? (piano, crea evento, pedalata libera, test FTP ramp e 20', tastiera) → Collega → pedali.
Impostazioni: profilo (peso → W/kg, FTP personale), bici (marca, modello, colori, ruote), ciclista (maglia, motivo, casco, emblemi, scritta, tua immagine), gioco, audio, grafica, dati.
Cartella dati: Impostazioni → Dati → «Scegli la cartella» e scegli la tua cartella OneDrive dei dati (per esempio `OneDrive\005-ALLENAMENTI\Open Trainer`): piano-app.json e workouts\ entrano; .FIT, storico.json e ftp-test.json escono. OneDrive sincronizza da solo.
Test FTP: dopo il test puoi salvare la FTP nelle impostazioni (il piano del coach non si tocca) e viene scritto `ftp-test.json` nella cartella dati.
Pedalata libera col trainer vero: modalità a pendenza FTMS (non verificata sul Suito-T; se non risponde passa a un carico fisso con ↑/↓).

## Grafica 3D (7-8 nov 2026)
Stili: Voxel, Low-poly retrò (PS1), Diorama isometrico, HD-2D. Si scelgono da Impostazioni → Grafica, nella configurazione iniziale o mentre pedali con i tasti 1-4. Il vecchio Pixel 2D non si sceglie più: resta solo come ripiego automatico se il browser non ha WebGL o il 3D dà problemi.
La strada segue il percorso scelto (curve, pendenze, paesi, ambiente), con traffico, pedoni, animali, buche, lavori, incroci, uccelli e clacson. Il ciclista indossa la tua divisa (motivo, emblema, scritta, immagine) sulla bici scelta.
La libreria 3D è Three.js r128 (MIT) copiata in `js/vendor/three.min.js`: l'app funziona anche offline.
Non verificato: prestazioni su un PC reale con scheda grafica normale (nel browser di prova 60 FPS), uso col Suito-T e con la fascia/orologio veri.

## Revisione generale (8 nov 2026)
Corretti dopo una revisione del codice: ripresa dopo un blocco anche per test e pedalata libera (si torna alla schermata di pedalata con percorso e partenza di prima), piano o workout trascinato durante la seduta (si applica quando esci, non rovina la seduta), trainer o fascia ricollegati senza doppioni, pedalata libera in pausa che manda un solo comando al trainer, tastiera → piano senza residui, mantenimento schermo acceso, .FIT grandi in coda per OneDrive, memoria delle nuvolette 3D, schede delle impostazioni, ripiego senza WebGL. 69 test automatici passano; provati nel browser: tutte le schede impostazioni, pedalata libera con simulatore, gioco con tastiera e cambio stile (tasti 1-4), ramp test fino in fondo (35'), blocco simulato e ripresa, 3D disattivato (ripiego 2D).
Non provato: Bluetooth vero (anche i comandi di pendenza FTMS sul Suito-T), accesso Microsoft vero, scelta cartella su disco vero, audio, installazione come app.
