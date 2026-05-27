# TODO: Implementace režimu "Přehled trasy" (Overview na velkém displeji)

Tento dokument popisuje kroky k vytvoření dual-map layoutu pro desktop/tablet, kde jedna mapa slouží pro detailní turn-by-turn navigaci a druhá pro celkový statický přehled o trase a situaci.

## Fáze 1: HTML Struktura a CSS Layout
- [x] **Úprava `index.html`:** Přidat kontejner pro druhou mapu (např. `<div id="overview-map-container"><div id="overview-map"></div></div>`).
- [x] **CSS Grid / Flexbox:** Nastavit rozvržení pro velké obrazovky (`@media (min-width: 1200px)`), které vedle sebe umístí postranní panel, hlavní mapu a přehledovou mapu.
- [x] **Responsivita:** Zajistit, aby se `overview-map-container` na mobilních zařízeních skryl (pomocí `display: none`).

## Fáze 2: Inicializace přehledové mapy (MapLibre GL JS)
- [x] **Instance mapy:** V `app.js` vytvořit novou instanci `overviewMap` vázanou na `overview-map` kontejner.
- [x] **Zakázání interakcí (Volitelné):** Vypnout rotaci (`dragRotate: false`, `touchPitch: false`) a nastavit `pitch: 0` a `bearing: 0`, aby mapa zůstala vždy orientovaná na sever jako 2D plán.
- [x] **Synchronizace stylu:** Zajistit, aby `overviewMap` používala stejný styl (`style.json`) jako hlavní mapa.

## Fáze 3: Synchronizace entit a datových vrstev
- [x] **Značka uživatele:** Vytvořit druhý marker (`overviewUserMarker`) a aktualizovat jeho souřadnice uvnitř `handlePositionSuccess` synchronně s hlavním markerem.
- [x] **Taktické značky (BFT, Události, Radary):** Upravit funkce `createBftMarker`, `fetchAndRenderEvents` a `fetchAndRenderRadars` tak, aby přidávaly klony značek (nebo dedikované zjednodušené body) i do `overviewMap`.
- [x] **Geometrie trasy:** Upravit funkci `renderRoute` tak, aby po získání GeoJSON s trasou přidala `Source` a `Layer` pro vykreslení trasy na obou mapách.

## Fáze 4: Logika kamery a Fit Bounds
- [x] **Kamera hlavní mapy:** Zůstává vázána na sledování uživatele (zoom ~16, pitch 45, dynamický bearing).
- [x] **Kamera přehledové mapy (Při spuštění navigace):** Využít metodu `overviewMap.fitBounds()` na základě GeoJSON souřadnic vypočtené trasy, aby byla vidět celá cesta od startu do cíle s lehkým paddingem.
- [x] **Kamera přehledové mapy (Během jízdy):** Volitelně aktualizovat střed mapy podle polohy uživatele, ale zachovat oddálený zoom (~10-12), nebo ji nechat staticky na celkové trase.

## Fáze 5: Uživatelské rozhraní a HUD pro overview
- [ ] **Přehledový panel:** Do rohu přehledové mapy přidat informační widget s celkovými daty (Zbývající vzdálenost, celková ETA do cíle).
- [ ] **Zvýraznění rizik:** Na přehledové mapě vykreslit okolo hrozeb na trase (nehody, zácpy) výraznější indikátory (např. červené zóny), které na oddálené mapě nezapadnou.
- [ ] **Performance optimalizace:** Zajistit, aby se nevykreslovaly zbytečně detailní textové labely (`app6-amplifiers`) na přehledové mapě, pokud je příliš oddálená, čímž se ušetří výkon.