# Taktická Navigace & Open Traffic Companion — Sloučený TODO

## 1. Vize a Koncept
Vytvořit komunitní navigační/dopravní aplikaci inspirovanou vojenskými a cyberpunk systémy (ATAK, MIL-STD-2525).
Aplikace bude plnohodnotná mapová PWA (Progressive Web App) běžící v prohlížeči bez nutnosti složitého backendu.

**Cílové platformy:**
- PWA (instalovatelné na Android/iOS/Desktop přes prohlížeč)
- HUD režim (zrcadlené webové UI)
- Zobrazitelné v jakémkoliv moderním prohlížeči

---

## 2. Architektura a Rozhodnutí
### Frontend (PWA)
- [x] **Rozhodnutí:** Samostatná PWA aplikace
- [x] **Technologie:** HTML/JS/CSS (Vanilla nebo Vue/React) + Service Workers
- [x] **Mapový engine:** MapLibre GL JS (ideální pro vektorové "dark/tactical" styly) nebo OpenLayers

### Backend (PWA + Realtime Server)
- [x] **Frontend Jádro:** Statický hosting (Vercel, GitHub Pages) pro rychlé načtení PWA
- [x] **Úložiště:** Klientské `IndexedDB` a `Cache API` pro offline radary a mapové dlaždice
- [ ] **Realtime sync (BFT & Eventy):** Lehký Node.js (WebSockets/Socket.io) nebo MQTT broker (např. Mosquitto) pro Blue Force Tracking (trakování přátel) a crowdsourcing událostí

---

## 3. Zdroje Dat a Agregace
### Oficiální API (Government/Global)
- [ ] DATEX II integrace
- [x] NDIC / Dopravniinfo.cz / Městská open data
- [x] Vyřešit CORS pro volání API z prohlížeče (vyřešeno vlastním Node.js proxy serverem)
- [x] Parser + polling + lokální cache

### Databáze radarů
- [ ] SCDB / OSM speed cameras
- [ ] Import GPX / CSV / GeoJSON
- [ ] Deduplikace záznamů

### Komunitní hlášení (Crowdsourcing)
- [ ] Vlastní reporting událostí
- [ ] Trust scoring (spolehlivost uživatele)
- [ ] Anti-spam & expiration handling

---

## 4. Datový Model & Taktické Názvosloví (MIL-STD)
- [ ] Navrhnout sjednocené (unified) event schéma
- [ ] Mapování standardních událostí na vojenské pojetí:

| Běžná událost | Taktické označení | MIL-STD Styl |
|---|---|---|
| Uživatel | Friendly asset | Friendly mobile unit |
| Policie | Hostile patrol / Enforcement | Hostile law enforcement unit |
| Radar / Úsekovka | Sensor emplacement | Enemy sensor |
| Zácpa / Kolona | Mobility collapse / Denied area | Mobility denied |
| Nehoda | Disabled vehicle | Hazard marker |
| Uzavírka | Route denial | Obstruction |
- [x] Čerpací stanice | Refuel point / Logistics | Logistics point |

*Poznámka: Spřátelené jednotky (přátelé) budou na mapě trakovány v reálném čase prostřednictvím modulu BFT (Blue Force Tracking).*

---

## 5. Navigační a Event Engine
### Taktická Navigace
- [x] Výpočet trasy (routing API), ETA, navigace po trase a dynamický přepočet při sjetí
- [x] Geocoding (vyhledávání adres) a preview mód
- [x] Lokální ukládání bodů zájmu (POI)
- [ ] Dynamické přesměrování (hlášení: *"Primary route compromised"*)
- [x] Podpora offline mapových podkladů (cachování vektorových dlaždic přes Service Worker)

### Lokalizace a Filtrování Eventů
- [x] GPS tracking & detekce směru (zlepšení přesnosti pomocí magnetometru/kompasu)
- [ ] Filtrování dle vzdálenosti a rychlosti
- [ ] Ignorování protisměru a relevance podle silnice
- [ ] Mergování podobných incidentů v blízkosti
- [ ] Cooldown proti spamovým alertům

---

## 6. Grafika a UI / UX
### Vizuální styl
- [ ] Taktický grid overlay (ATAK styl)
- [ ] Téma a barvy (Dark tactical, Green/Orange/Red threat vizualizace, Glow efekty)
- [ ] Monospace / military typografie
- [ ] CRT-inspired retro téma (volitelné)

### UI Komponenty a HUD
- [ ] App shell struktura pro PWA (Fullscreen zážitek)
- [ ] Tlačítko pro HUD mód (CSS `transform: scaleY(-1);` pro odraz na čelní sklo)
- [x] Wake Lock API implementace (`navigator.wakeLock`) aby displej nezhasínal během jízdy a ošetření probuzení (Visibility API)
- [ ] Plně responzivní layout (CSS Grid / Flexbox, Mobile-first)
- [ ] Adaptivní informační panely (na malém displeji dynamicky vyjíždějící/skryté, na velkém trvalé zobrazení po stranách)

---

## 7. Audio Systém
- [ ] Přehrávání OGG/WAV zvuků
- [ ] TTS (Text-to-Speech) fallback pro čtení dynamických textů
- [ ] Volume ducking (ztlumení hudby při hlášení)

### Voice Packy (Hlasy)
- [ ] NATO commander (*"Hostile enforcement unit ahead"*)
- [ ] AWACS operator / Helicopter pilot (*"Proceeding through contested sector"*)
- [ ] Cyberpunk AI assistant
- [ ] Cold-war Soviet operator
- [ ] Retro GPS

---

## 8. PWA a Webová Integrace
### Jádro
- [ ] `manifest.json` s ikonami a `display: standalone`
- [x] Service Worker pro offline podporu a caching
- [ ] Geolocation API (`navigator.geolocation.watchPosition`) s handlingem ztráty signálu
- [ ] *Omezení:* Android Auto nepodporuje čisté PWA - nutno počítat s použitím přímo na telefonu/tabletu na palubní desce


---

## 9. Soukromí a Bezpečnost (Privacy)
- [ ] Offline-first přístup
- [ ] Minimální telemetrie (GDPR considerations)
- [ ] Možnost anonymního komunitního reportingu
- [ ] End-to-end optional mode pro zprávy

---

## 10. Gamifikace a "Zábavné" Prvky (Fun Extras)
### Herní mechaniky
- [ ] DEFCON traffic scale (škála dopravní zátěže)
- [ ] Driver reputation / Intel reliability
- [ ] Achievementy (např. *"Zero-stop extraction"*, *"Urban stealth maneuver"*)

### Taktický / Absurdní flavor
- [ ] Falešný šifrovaný rádiový provoz (ambientní zvuky)
- [ ] Vtipy o dronovém průzkumu (Drone reconnaissance jokes)
- [ ] "GPS degraded" mód (simulace výpadků/rušení)
- [ ] Taktický hudební podkres (Tactical soundtrack mode)
- [ ] BFT (Blue Force Tracking) / "Convoy mode" pro bezpečné cestování a vizualizaci pozic ve skupině přátel (místnosti chráněné heslem)
- [ ] Skupinový taktický textový chat v rámci BFT

---

## 11. Rozšířené Funkce a Budoucnost (Fáze 4+)
- [ ] AI-generované taktické brífinky před jízdou
- [ ] Predikce dopravy a overlay hrozeb počasí (Weather threat overlays)
- [ ] WebRTC car-to-car peer-to-peer komunikace pro varování nablízko

---

## 12. Brainstorming Názvů Aplikace
- RoadOps
- Convoy
- TacNav
- RouteCommand
- CIVTAK Drive
- Overwatch Navigation
- BlackRoute
- GridNav
- VectorOps
- Asphalt Command

---

## 13. Sloučená Roadmapa (MVP)
### Fáze 1 (Základní senzory)
- [ ] Získávání GPS polohy přes Web API (`watchPosition`)
- [ ] Databáze radarů v IndexedDB
- [ ] Jednoduché audio alerty na POI

### Fáze 2 (Data a UI)
- [ ] Zobrazení MapLibre GL JS mapy s dark/tactical stylem
- [x] Načítání veřejných API (doprava/nehody) - funkční mock proxy
- [ ] Implementace MILSTD ikon jako mapových markerů

### Fáze 3 (Taktický feeling)
- [ ] Theme systém (CRT, barvy, fonty)
- [ ] Smart filtering (protisměr, relevance na silnici)
- [ ] Pokročilý Audio systém (Web Audio API, TTS přes `window.speechSynthesis`)

### Fáze 4 (Komunita)
- [ ] Komunitní backend pro real-time sdílení
- [ ] BFT (Blue Force Tracking) – systém skupin (místností) chráněných heslem pro živé sdílení polohy
- [ ] Skupinový chat
- [ ] Gamifikace (Achievementy, Reputation)