# Collegare OneDrive (facoltativo)

L'app può leggere il piano da OneDrive e salvarci i `.FIT`. Vede **solo la sua cartella dedicata** (`OneDrive/Apps/Open Trainer`), non il resto del tuo OneDrive. Non servono server né password: l'accesso è quello normale di Microsoft.

## 1. Registra l'app (una volta sola, gratis, 5 minuti — la fa chi pubblica l'app)
1. Vai su <https://entra.microsoft.com> con un account Microsoft → **Applicazioni** → **Registrazioni app** → **Nuova registrazione**.
2. Nome: `Open Trainer` (il nome diventa il nome della cartella in `Apps/`).
3. Tipi di account supportati: **solo account Microsoft personali** (oppure «qualsiasi directory organizzativa e account personali»).
4. URI di reindirizzamento: scegli la piattaforma **Applicazione a pagina singola (SPA)** e inserisci, uno alla volta:
   - `http://localhost:8080/` (per provare in locale)
   - `https://<tuo-utente>.github.io/ciclomulino-app/` (il sito pubblicato; con la barra finale)
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
