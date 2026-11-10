# Open Trainer

È un sito (PWA). Due modi per usarlo:

1. **Online (consigliato)**: pubblicato su GitHub Pages, indirizzo `https://<tuo-utente>.github.io/ciclomulino-app/`.
   Si apre in Edge/Chrome, il Bluetooth funziona perché è https, e dal menu del browser si può «Installa app» (finestra a schermo intero, funziona anche offline).
   Pubblicazione (la fai tu): copia questa cartella nel repo `ciclomulino-app`, commit e push, poi su GitHub → Settings → Pages → Branch `main`, cartella `/ (root)`.
   Il file `piano-app.json` NON viene caricato online (è in `.gitignore`): lo trascini nell'app e resta nel tuo browser.
2. **In locale** (senza internet): doppio clic su `avvia.bat` (serve Node) → http://localhost:8080/.

Test automatici: `npm test`.
Tasti: Spazio avvia/pausa (in modalità tastiera: salta) · → salta step · V vista 3ª/1ª persona · C pagina del ciclocomputer · M menu · F schermo intero · N suoni.
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
Cartella dati: Impostazioni → Dati → «Scegli la cartella» e scegli la tua cartella OneDrive dei dati (per esempio `OneDrive\Open Trainer`): piano-app.json e workouts\ entrano; .FIT, storico.json e ftp-test.json escono. OneDrive sincronizza da solo.
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

## Novità del 9 nov 2026
- **Ruota**: Impostazioni → Bici → Ruota. Di serie 700x28C = 2136 mm (altre misure nell'elenco o a mano). La velocità «reale» si calcola dai giri della ruota se il trainer li manda (servizio Bluetooth CSC), altrimenti si usa la velocità che manda il trainer (FTMS). **Non verificato sul Suito-T**: dopo la prima pedalata vera, Impostazioni → Bici dice da dove arriva il dato.
- **Ciclocomputer** (Impostazioni → Computer): riquadro a schermo e/o sul manubrio in prima persona (se sono attivi entrambi, in prima persona si vede solo quello sul manubrio). Fino a 6 pagine da 4 a 6 valori ciascuna: velocità virtuale, reale, media e massima; watt istantanei, 3", 10", media step e seduta, massimi, NP; cadenza; FC e FC media; % FTP; W/kg; pendenza; distanza; tempo e tempo step; D+; kJ; ora. Pagina successiva: clic sul riquadro o tasto C.
- **Traffico**: negli allenamenti (piano, test FTP, pedalata libera) il ciclista ha sempre la precedenza e sta a destra: auto e mezzi lo superano larghi, le auto agli incroci aspettano sul bordo, buche e lavori li evita da solo. Nessuno scontro, mai.
- **Gioco** (modalità tastiera): 3 vite, tutto vale (auto, ciclisti, trattori, auto agli incroci, buche, lavori). Dopo un urto si riparte dall'ultimo checkpoint (a ogni paese o ogni 2 km) con 3 secondi senza colpi; a zero vite compare «Game over» con distanza e tempo. Il gioco non salva .FIT né storico.
- **Più PC con lo stesso account Microsoft**: oltre a piano e workout, ora si sincronizzano impostazioni (tranne quelle proprie del PC: collegamenti, cartella, volume, qualità grafica), storico delle sedute (si uniscono, nessuna si perde) e percorsi importati (max 6). File in `Apps/Open Trainer`: `impostazioni.json`, `storico.json`, `percorsi/`. Regola: vince l'ultima modifica; un PC che entra per la prima volta adotta ciò che trova sul cloud. Durante una seduta non cambia niente.
- Primo avvio: «Benvenuto su Open Trainer»; tolte le frasi lampeggianti dal titolo.
Non provato: Bluetooth vero (giri ruota/CSC e velocità del Suito-T), sincronizzazione con due account/PC veri (provata solo con un OneDrive finto nei test), ripiego Pixel 2D con le nuove regole del traffico (la logica è la stessa del 3D ed è coperta dai test).

## Modalità debug / scatola nera (9 nov 2026)
Impostazioni → **DEBUG** (spento di serie; si accende da lì). Registra **ogni dato che entra e che esce**, una riga per evento (file `.jsonl`), solo sul tuo PC, senza inviare niente a nessuno:
- **Entrata**: ogni pacchetto Bluetooth grezzo (byte in esadecimale + valori letti) di trainer (potenza, cadenza, velocità, stato, risposte ai comandi) e FC; giri ruota se il trainer li manda; tasti e clic (mai il contenuto dei campi di testo); rete (solo indirizzo senza parametri, esito, tempo); piano/GPX importati; sincronizzazioni.
- **Uscita**: ogni comando al trainer (decisione, byte, esito, tempo) e quelli volutamente non inviati; cosa decide l'ERG; file .FIT (nome, byte, impronta, giri); salvataggi; scritture in cartella/OneDrive.
- **Stato ogni secondo**: watt, cadenza, FC, km/h reali, carico richiesto, fattore ERG, timer della cadenza bassa/alta, step, pausa, FPS, tempo di disegno, memoria.
- **Dispositivo**: al primo collegamento elenca servizi e caratteristiche Bluetooth, le funzioni supportate dal trainer (FTMS Feature), produttore/modello/firmware, batteria.
- **Errori e prestazioni**: errori, console, blocchi > 100 ms, 3D perso, divieti della politica di sicurezza, GPU.
- Dal log si tolgono (con un filtro a elenco, non infallibile): token, codici di accesso, parametri degli indirizzi. Non vengono registrati: nome, peso, altezza, FC massima, Client ID, contenuto dei campi di testo, nomi dei file GPX, testo dei riquadri di stato. Restano: nomi dei dispositivi Bluetooth e dei piani, versione del browser, scheda video, fuso orario.

Dove finisce: nel browser (ultimi log, recuperabili da Impostazioni → DEBUG) **e**, solo se accendi anche «Salva il log anche nella cartella dati», in `debug/ot-<data>.jsonl` (aggiornato ogni 30 s e a fine seduta; restano gli ultimi 10 file). Se la cartella è dentro OneDrive il log viene caricato su Microsoft. Da Impostazioni → DEBUG puoi anche scaricarlo a mano, aggiungere una nota o cancellare i log.
In gara: **B** segna un punto nel log (con watt, cadenza, step in quel momento) · **I** apre il pannello live (pacchetti al secondo, ultimo comando, ERG, FPS). Il puntino rosso «REC» in alto a sinistra dice che sta registrando.
Trovato con questa revisione (c'era dall'inizio, mai visto perché il trainer finto dei test era troppo permissivo): il Control Point usava `startIndications()`, che nel Web Bluetooth non esiste → con un trainer vero il collegamento sarebbe fallito sempre. Ora usa `startNotifications()` (che attiva anche le indicazioni) e il trainer finto dei test non ha più `startIndications`.
Per spegnerlo: Impostazioni → DEBUG. Codice: `js/debug.js` (registratore), tracce Bluetooth in `js/ble.js`, ganci in `js/main.js`; prove in `test/debug.test.js`. «Cancella i dati locali» cancella anche i log nel browser (non i file nella cartella).

## Sicurezza (8 nov 2026)
Revisione completa del codice (lettura indipendente + prove) e correzioni. Cosa protegge l'app:
- **File importati non fidati** (impostazioni, piano, workout, GPX/TCX): ogni valore è controllato per tipo e intervallo prima di essere usato o mostrato; testi e colori non conformi vengono scartati. Un file malevolo non può eseguire codice, bloccare il browser (ripetizioni enormi, tracce con milioni di punti) né mandare watt assurdi al trainer (tetto 2000 W e 4×FTP; il trainer riceve sempre valori dentro limiti sicuri).
- **Sito pubblicato:** Content-Security-Policy (solo script del sito; collegamenti permessi: il sito stesso e Microsoft per OneDrive; i caratteri sono ospitati nel sito, in `fonts/`, licenza OFL), nessun referrer inviato, protezione dal «clickjacking» (la pagina non funziona dentro il frame di un altro sito), HTTPS obbligatorio.
- **Accesso Microsoft:** PKCE + state casuale con scadenza di 10 minuti, il codice sparisce dalla barra dell'indirizzo prima dello scambio, permesso solo sulla cartella dell'app, «Esci» e «Cancella dati locali» eliminano token, coda dei .FIT, cartella collegata e copie in cache.
- **Service worker:** vede solo i file del sito, mai Microsoft né indirizzi con parametri.
- **Server locale (avvia.bat):** solo 127.0.0.1, solo i file del sito (non .git, note, piano personale), rifiuta richieste con un indirizzo diverso da localhost.
- **Privacy:** nessun tracciamento, nessuna statistica; i dati restano nel browser (e nella tua cartella/OneDrive se li colleghi). Senza OneDrive il sito non fa nessuna richiesta a terzi (i due caratteri, Press Start 2P e VT323, sono scaricati una volta da Google Fonts e ospitati nel sito).
- I test automatici di sicurezza (`test/security.test.js`, `test/onedrive.test.js`, `test/features.test.js`) controllano queste difese a ogni modifica. Anche i dati che arrivano da OneDrive (impostazioni, storico, percorsi) sono trattati come non fidati e ripuliti campo per campo.
Da sapere: i token Microsoft stanno nel browser di questo sito (localStorage): chi ha accesso al tuo PC o al tuo account GitHub potrebbe usarli, quindi tieni attiva la verifica in due passaggi su GitHub e Microsoft. Non provato: login Microsoft vero con la nuova CSP, installazione dell'app con il nuovo service worker.

## Seconda revisione di sicurezza (9-10 nov 2026)
Tre revisioni indipendenti in sola lettura (accesso Microsoft e sito, file importati, privacy e verità dei testi). Nessun difetto che permetta di eseguire codice; trovati e corretti, ciascuno con un test (`test/hardening.test.js`, `test/hardening2.test.js`):
- **File piccoli che bloccavano il browser:** un piano con ripetizioni annidate vuote (68 byte) o con milioni di step, un GPX con `<ele<ele…` (tempo quadratico) o con punti a cavallo dell'antimeridiano (milioni di punti), messaggi d'errore a milioni. Ora: budget su tutto il file, ogni giro di ripetizione conta, massimo 100 messaggi, regex a tempo lineare, longitudine sul cammino più breve.
- **FTP senza limite:** `{"ftp":2000}` (o il refuso 2710) generava test a 700-1000 W. Ora la FTP personale vale solo tra 50 e 600 W (impostazioni, cloud, campo, risultato del test).
- **Dati non fidati:** percorsi da OneDrive o localStorage (luoghi, ambienti, nome, id), storico, workout e seduta da ripristinare vengono ricostruiti/validati invece di copiati; tetti di dimensione prima di leggere piano, workout e storico da cartella e cloud; orario remoto «nel futuro» ignorato.
- **OneDrive:** percorsi con `.`/`..`/vuoti rifiutati, stesso criterio per scrivere e cancellare i workout, errore di login mostrato solo con frasi fisse (e solo se c'è un accesso in corso), «Esci» durante un rinnovo non lascia collegati.
- **Debug e privacy:** spento di serie; la scrittura nella cartella dati è un secondo consenso con rotazione di 10 file; niente peso, altezza, FC massima, nomi dei file GPX, testo dei riquadri di stato; redazione più robusta; «Cancella i dati locali» pulisce anche i log. Testi di README, SECURITY e dell'app allineati a ciò che il codice fa davvero (anche il caricamento su OneDrive di nome, peso, altezza, FTP e GPX).
- **Altro:** nome del `.FIT` con i secondi, storico nella cartella unito invece che sovrascritto, CSP con `style-src-attr`, service worker che scarica sempre dalla rete, attribuzione OpenStreetMap/Copernicus visibile in gara e in Informazioni.
Da fare / non verificato: `*.sharepoint.com` nella CSP e lo scope `User.Read` si possono togliere solo dopo un login Microsoft vero (guardare gli host usati in DevTools); l'origine `utente.github.io` è condivisa con ogni altro sito Pages dell'account (meglio un dominio proprio); three.js r128 (2021) andrebbe aggiornato.
