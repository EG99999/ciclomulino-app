# Piano del coach → Open Trainer (via OneDrive)

`tools/coach-to-piano.mjs` legge il piano del coach (quello di `get_plan`) e scrive `piano-app.json` nella cartella dati di Open Trainer
(per esempio `OneDrive\...\Open Trainer`). OneDrive lo porta sugli altri PC; Open Trainer lo legge da solo (cartella dati o account Microsoft)
e lo mostra nella pagina «Allenamenti».

Regole:
- Si converte solo la bici indoor (titolo, id o descrizione con «ciclomulino», «indoor», «rullo» o «trainer»), da oggi in poi, entro 45 giorni.
- I watt sono sempre quelli del coach: target `power` (low/high) o `power_zone` (zone di potenza del coach). Una seduta con la sola FC viene saltata
  (con il motivo) e non si inventa nulla. Opzione `--hr-fallback`: la zona FC diventa la stessa zona di potenza, in watt, e il tetto FC resta come avviso.
- Il file viene riscritto solo se il piano è cambiato. Un `piano-app.json` che non porta `"source": "coach-sync"` (fatto a mano) non si tocca, salvo `--overwrite`.
  Un piano vuoto non si scrive mai.
- Ogni seduta convertita è controllata con lo stesso lettore dell'app (`js/plan.js`): se l'app la rifiuterebbe, qui viene saltata.

Uso:

    node tools/coach-to-piano.mjs --in piano-coach.json --out "<cartella dati>\piano-app.json" --ftp 289 --zones 0,162,216,261,302,348,438 --hr-zones 97,116,135,154,174 [--hr-fallback] [--days 45] [--all-bike] [--overwrite]

Le sedute del coach devono avere, su ogni passo, un target in watt; la FC va nella nota del passo (per esempio «tetto FC 135»): l'app la mostra come avviso.

## Dalla chat di Claude (senza il PC)

Open Trainer legge anche il piano del coach così com'è, senza conversione a mano: basta un file `piano-app.json` fatto così

    { "ftp": 289, "zones": [0,162,216,261,302,348,438], "hrZones": [97,116,135,154,174], "sessions": [ ...le sedute bici di get_plan, copiate identiche... ] }

(`ftp`, `zones` e `hrZones` sono facoltativi; senza di loro valgono la FTP delle impostazioni e le zone classiche. Dove una seduta ha solo la FC, i watt sono quelli della
stessa zona: FC sotto 135 = zona 2.) Lo scrive la chat di Claude con i connettori «Coach Elia» (piano) e «Microsoft 365» (carica il file nella cartella OneDrive
«Apps/Open Trainer»); l'app lo converte da sola all'avvio e ogni 10 minuti.
