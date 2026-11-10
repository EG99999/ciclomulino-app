# Sicurezza / Security policy

## Come segnalare una vulnerabilità
Usa la **segnalazione privata di GitHub**: nel repository, scheda **Security** → **Report a vulnerability**. Non aprire una issue pubblica con i dettagli e non incollare token, password o dati personali veri (anche nei log di debug).

Il progetto è portato avanti da una persona nel tempo libero: puoi aspettarti una prima risposta **entro circa 7 giorni**; la correzione dipende dalla gravità. Se vuoi, citiamo il tuo nome nel ringraziamento. Chi cerca vulnerabilità in buona fede, senza accedere ai dati di altre persone né danneggiare servizi, non verrà perseguito.

*English: report privately via the repository's **Security** tab → **Report a vulnerability**. Please do not open a public issue with details and never paste real tokens or personal data. This is a volunteer project: expect a first reply within about 7 days.*

## Versioni supportate
Solo l'ultima versione sul ramo `main` e il sito pubblicato da essa.

## Cosa è nel perimetro
L'app web (HTML/JS/CSS), il service worker, il piccolo server locale `serve.mjs`, l'importazione di file (piano, workout, GPX/TCX, impostazioni), l'accesso Microsoft (OAuth 2.0 con PKCE) e la sincronizzazione con OneDrive, il registro di debug.
Fuori perimetro: GitHub Pages, i servizi Microsoft, il browser, il Bluetooth e l'hardware del trainer, attacchi che richiedono già il controllo del tuo computer, ingegneria sociale.

## Com'è pensata la sicurezza
- **Nessun server nostro e nessun account nostro.** I dati (impostazioni, storico, percorsi, registro di debug) restano nel browser e nella cartella che scegli. La sincronizzazione con OneDrive è facoltativa: carica impostazioni (compresi nome, peso, altezza, FTP), storico e percorsi importati nella cartella `Apps/Open Trainer` del tuo OneDrive (permesso `Files.ReadWrite.AppFolder`; l'app legge anche il nome dell'account, permesso `User.Read`). L'app non vede né salva password.
- **Niente codice di terzi dal web**: tutte le librerie e i caratteri sono inclusi nel sito; la Content-Security-Policy (inserita nella pagina, perché GitHub Pages non permette intestazioni HTTP) consente solo il sito stesso e i servizi Microsoft necessari all'accesso.
- **Tutto ciò che arriva da fuori è trattato come non fidato** (file importati, dati da OneDrive o dalla cartella, dati nel `localStorage`): controllo di tipo e intervallo campo per campo, oggetti ricostruiti invece che copiati, limiti di dimensione (piano e workout 2 MB, impostazioni 200 KB, GPX 10 MB, JSON dal cloud 1-3 MB) e di numero (step, ripetizioni, messaggi, file). La FTP personale è accettata solo tra 50 e 600 W e a un trainer non arrivano mai più di 2000 W (né oltre il suo limite dichiarato).
- Il registro di debug (spento di serie) toglie dai testi token, codici di accesso e parametri degli indirizzi. È un filtro a elenco: non è garantito contro ogni forma possibile, per questo non va allegato a segnalazioni pubbliche senza averlo letto.

## Limiti noti (scelte consapevoli, non vulnerabilità)
- **Origine condivisa.** Su GitHub Pages l'indirizzo è `<utente>.github.io`: `localStorage` e IndexedDB (token Microsoft, impostazioni, log) sono visibili a qualunque altra pagina pubblicata sullo stesso account. Per questo l'app va servita da un dominio proprio, o da un account GitHub che non ospita altro.
- Il token di accesso Microsoft è conservato nel `localStorage` del browser: uno script malevolo nella pagina potrebbe leggerlo. Mitigazioni: nessuno script di terzi, CSP stretta, permesso minimo.
- Senza intestazioni HTTP la protezione dall'incorniciamento (anti-clickjacking) è fatta con uno script.
- Il Bluetooth non ha autenticazione applicativa: chi è abbastanza vicino da collegarsi al tuo trainer può farlo; è una proprietà del trainer.

Dettagli della revisione di sicurezza e delle correzioni: sezione «Sicurezza» di [LEGGIMI.md](LEGGIMI.md).
