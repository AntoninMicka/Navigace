# Taktická Navigace & Open Traffic Companion — Sloučený TODO

## 1. Vize a Koncept
Vytvořit komunitní navigační/dopravní aplikaci inspirovanou vojenskými a cyberpunk systémy (ATAK, MIL-STD-2525).
Aplikace bude buď lehký overlay (např. nad OsmAnd) nebo plnohodnotná mapová vrstva s vlastní navigací.

**Cílové platformy:**
- Android app (případně i HUD režim)
- Android Auto
- Volitelný PWA / Web klient pro dispečink (budoucnost)

---

## 2. Architektura a Rozhodnutí
### Koncept aplikace
- [ ] **Rozhodnout:** Overlay companion app (spolupráce s OsmAnd) NEBO samostatná navigace?
- [ ] **Technologie (Frontend):** Android native / Qt/QML (doporučeno) / Flutter / PWA
- [ ] **Mapový engine (pokud standalone):** OsmAnd (přes API), MapLibre GL, OpenRouteService, Valhalla, GraphHopper

### Backend (Crowdsourcing & Agregace)
- [ ] **Jádro:** Node.js nebo Python FastAPI
- [ ] **Databáze:** PostgreSQL + PostGIS (geodata), Redis (cache)
- [ ] **Realtime:** MQTT / WebSocket pro synchronizaci událostí

---

## 3. Zdroje Dat a Agregace
### Oficiální API (Government/Global)
- [ ] DATEX II integrace
- [ ] NDIC / Dopravniinfo.cz / Městská open data
- [ ] Parser + polling + lokální cache

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
| Čerpací stanice | Refuel point / Logistics | Logistics point |

---

## 5. Navigační a Event Engine
### Taktická Navigace
- [ ] Výpočet trasy, ETA, alternativní trasy
- [ ] Dynamické přesměrování (hlášení: *"Primary route compromised"*)
- [ ] Podpora offline mapových podkladů

### Lokalizace a Filtrování Eventů
- [ ] GPS tracking & detekce směru (heading detection)
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

### Overlay & HUD (při použití s OsmAnd)
- [ ] Floating overlay a žádost o Android permissions
- [ ] Minimal distraction mode
- [ ] HUD režim pro jízdu v noci (zrcadlení na sklo, bearing indikátory)

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

## 8. Integrace na Android a Systém
### Jádro
- [ ] Foreground service
- [ ] Auto-start po rebootu
- [ ] Vynucení/řešení battery optimization (Doze mode)
- [ ] Background location tracking
- [ ] Android Auto (Zjednodušené taktické UI, velké ovládací prvky, voice-first)

### Propojení s OsmAnd (pokud použito jako companion)
- [ ] Intent API & deeplinky
- [ ] Vkládání externích POI do mapy
- [ ] Custom alerts pro OsmAnd

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
- [ ] "Convoy mode" pro bezpečné cestování ve skupině přátel

---

## 11. Rozšířené Funkce a Budoucnost (Fáze 4+)
- [ ] AI-generované taktické brífinky před jízdou
- [ ] Predikce dopravy a overlay hrozeb počasí (Weather threat overlays)
- [ ] Car-to-car mesh komunikace
- [ ] Interoperabilita s reálným ATAKem (experimentálně)
- [ ] SDR / radio integrace (experimentálně)

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
- [ ] Získávání GPS polohy
- [ ] Offline databáze radarů (importovaná statická data)
- [ ] Jednoduché audio alerty na POI

### Fáze 2 (Data a UI)
- [ ] DATEX II + stahování nehod a uzavírek
- [ ] Overlay HUD nebo základní OSM/MapLibre mapa
- [ ] Implementace MILSTD ikon a UI

### Fáze 3 (Taktický feeling)
- [ ] Theme systém (CRT, barvy, fonty)
- [ ] Smart filtering (protisměr, relevance na silnici)
- [ ] Pokročilý Audio systém (Voice packy, TTS)

### Fáze 4 (Komunita a Android Auto)
- [ ] Komunitní backend pro real-time sdílení
- [ ] Gamifikace (Achievementy, Reputation)
- [ ] Android Auto integrace