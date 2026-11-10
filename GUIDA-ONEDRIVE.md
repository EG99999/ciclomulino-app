# Collegare OneDrive (facoltativo)

L'app può leggere il piano da OneDrive e salvarci i `.FIT`. Dei tuoi file vede **solo la sua cartella dedicata** (`OneDrive/Apps/Open Trainer`), non il resto del tuo OneDrive; legge anche il nome del tuo account Microsoft. Non servono server né password: l'accesso è quello normale di Microsoft.

> Chi pubblica una **propria copia** dell'app (fork) deve fare questa registrazione da sé e mettere il proprio Client ID in `js/config.js`: quello del progetto originale funziona solo con i suoi indirizzi.

## 1. Registra l'app (una volta sola, gratis, 5 minuti — la fa chi pubblica l'app)
1. Vai su <https://entra.microsoft.com> con un account Microsoft → **Applicazioni** → **Registrazioni app** → **Nuova registrazione**.
2. Nome: `Open Trainer` (il nome diventa il nome della cartella in `Apps/`).
3. Tipi di account supportati: **solo account Microsoft personali**. È l'unica scelta che funziona: l'app usa l'endpoint «consumers» di Microsoft, quindi gli account di lavoro o di scuola non sono supportati.
4. URI di reindirizzamento: scegli la piattaforma **Applicazione a pagina singola (SPA)** e inserisci:
   - `https://<tuo-utente>.github.io/ciclomulino-app/` (il sito pubblicato; con la barra finale), oppure il tuo dominio.
   - **Non** mettere `http://localhost:8080/` in questa registrazione di produzione: il Client ID è pubblico e qualunque programma in ascolto su quella porta, sul computer di un utente, potrebbe presentarsi come «Open Trainer». Per provare in locale fai una **seconda registrazione** (per esempio «Open Trainer sviluppo») con solo quell'indirizzo e incolla il suo Client ID in Impostazioni → Dati.
5. Crea. Nella pagina **Panoramica** copia l'**ID applicazione (client)**: è un codice tipo `1a2b3c4d-…`. **Non è un segreto**, non serve nessun «client secret».
6. **Autorizzazioni API** → Microsoft Graph → *Autorizzazioni delegate*: `Files.ReadWrite.AppFolder`, `User.Read`, `offline_access`.

## 2. Dai il Client ID all'app
- Apri `js/config.js` e metti il codice in `MS_CLIENT_ID` (così funziona per tutti gli utenti del sito), **oppure**
- ognuno lo incolla in Impostazioni → Dati → Accesso Microsoft (campo «Client ID Microsoft»).

## 3. Accedi e usa
Impostazioni → Dati → **Accedi con Microsoft** → scegli l'account → accetta. Poi:
- **Piano (entra)**: metti `piano-app.json` in `OneDrive/Apps/Open Trainer/` (la cartella compare dopo il primo salvataggio dell'app: premi «Carica il piano attuale» una volta). L'app lo ricontrolla all'avvio e ogni 10 minuti e lo applica quando cambia (non durante una seduta).
- **Workout tuoi (entrano)**: file `.json` in `Apps/Open Trainer/workouts/` (stesso formato: una o più `sessions`, oppure una seduta con `blocks`). Compaiono nell'elenco delle sedute.
- **.FIT (escono)**: a fine seduta l'app li salva in `Apps/Open Trainer/fit/`. Se sei offline vengono messi in coda e caricati alla prossima sincronizzazione.

## Cose da sapere
- Per i siti a pagina singola Microsoft fa scadere l'accesso dopo **24 ore**: una volta al giorno può servire ripremere «Accedi con Microsoft» (è un click, niente password se sei già dentro a Microsoft).
- Se non vuoi OneDrive non cambia niente: trascini `piano-app.json` come prima e tutto resta nel browser.
- «Esci» nel menu cancella il permesso salvato nel browser. Per revocarlo del tutto: <https://account.live.com/consent/Manage>.
- Limite: i file caricati dall'app sono al massimo 4 MB (un `.FIT` di 3 ore ne occupa circa 0,3).
- **Più PC (stesso account)**: l'app tiene in `Apps/Open Trainer` anche `impostazioni.json` (le tue impostazioni, compresi nome, peso, altezza e FTP, senza quelle proprie di ogni PC), `storico.json` (le sedute, unite tra i PC) e `percorsi/` (i GPX/TCX importati, max 6). Ogni PC li legge e li aggiorna da solo; vince l'ultima modifica.
