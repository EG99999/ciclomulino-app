// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Anti-clickjacking: se la pagina viene caricata dentro il frame di un altro sito la nascondo e provo a uscirne.
// (GitHub Pages non permette di impostare l'intestazione X-Frame-Options, quindi lo faccio qui.)
if (window.top !== window.self) {
  document.documentElement.style.display = 'none';
  try { window.top.location.href = window.self.location.href; } catch { /* frame di un altro sito: resta nascosta */ }
}
