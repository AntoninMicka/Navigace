# TODO — Open Traffic Companion / Custom Navigation Layer

## 0. Cíl projektu
Vytvořit lehkou aplikaci nad:
- OsmAnd
- případně vlastní mapovou vrstvou

která:
- agreguje realtime dopravní události
- upozorňuje na radary/nehody/uzavírky
- používá vlastní zvuky a ikony
- umožňuje budoucí crowdsourcing

---

# 1. Rozhodnutí architektury

## TODO
- [x] Rozhodnout:
  - **Primárně:** Nasazení do cloudu (Node.js) jako Web App / PWA
  - **Sekundárně (Později):** Nativní Android wrapper (Capacitor/Cordova) nad existujícím webovým jádrem, aby bylo možné udržet běh sledování polohy (BFT) na pozadí při zhasnutém displeji.

- [ ] Rozhodnout:
  - overlay companion app
  - nebo samostatná navigace

- [ ] Definovat MVP scope

---

# 2. Datový model

## TODO
- [ ] Navrhnout unified event schema
- [ ] Definovat event typy:
  - radar
  - úsekové měření
  - nehoda
  - práce
  - uzávěra
  - kolona
  - police
  - počasí
  - nebezpečí

---

# 3. Zdroje dat

## Government APIs
- [ ] DATEX II
- [ ] NDIC / Dopravniinfo.cz
- [ ] městská open data
- [ ] parser + polling + cache

## Radar databáze
- [ ] SCDB
- [ ] OSM speed cameras
- [ ] import GPX/CSV/GeoJSON
- [ ] deduplikace

## Budoucí crowdsourcing
- [ ] vlastní reporting
- [ ] expiration
- [ ] trust scoring
- [ ] anti-spam

---

# 4. Lokalizace a relevance

## TODO
- [ ] GPS tracking
- [ ] heading detection
- [ ] speed filtering
- [ ] distance filtering
- [ ] ignorovat protisměr
- [ ] relevance podle silnice

---

# 5. Event engine

## TODO
- [ ] prioritizace eventů
- [ ] merge podobných incidentů
- [ ] expiration handling
- [ ] cooldown proti spam alertům

---

# 6. Audio systém

## TODO
- [ ] custom voice pack systém
- [ ] OGG/WAV playback
- [ ] TTS fallback
- [ ] volume ducking

## Audio témata
- [ ] standard
- [ ] synthwave
- [ ] military
- [ ] retro GPS

---

# 7. Grafika a UI

## Overlay HUD
- [ ] floating overlay
- [ ] minimal distraction mode
- [ ] overlay permissions

## UI prvky
- [ ] ikona události
- [ ] vzdálenost
- [ ] směr
- [ ] ETA

## Theme systém
- [ ] SVG icon pack systém
- [ ] dark/night mode
- [ ] high contrast mode

---

# 8. Integrace s OsmAnd

## TODO
- [ ] intent API
- [ ] deeplinky
- [ ] externí POI
- [ ] custom alerts

---

# 9. Android systémové části

## TODO
- [ ] foreground service (přes Capacitor Background Geolocation plugin)
- [ ] auto-start after reboot
- [ ] battery optimization handling
- [ ] background location persistence
- [ ] Android Auto research

---

# 10. Datové úložiště

## TODO
- [ ] SQLite schema
- [ ] event cache
- [ ] offline persistence

---

# 11. Síťová vrstva

## TODO
- [ ] REST client
- [ ] retry logic
- [ ] delta updates
- [ ] compression

---

# 12. Privacy

## TODO
- [ ] offline-first
- [ ] minimal telemetry
- [ ] GDPR considerations

---

# 13. MVP roadmap

## Fáze 0
- [x] CI/CD: Automatické nasazení z GitHubu přes GitHub Actions
- [ ] Nasazení backendu do Google Cloud / VPS
- [ ] Volitelné nastavení backend cache (DISABLE_BACKEND_CACHE=true) a WebSocket persistence (No CPU throttling).
- [ ] Zabezpečené HTTPS spojení

## Fáze 1
- [x] GPS a kompas (Web API)
- [ ] radar databáze
- [ ] audio alerty

## Fáze 2
- [ ] DATEX II
- [ ] nehody
- [ ] uzávěry
- [ ] overlay HUD

## Fáze 3
- [ ] themes
- [ ] SVG ikonky
- [ ] smart filtering

## Fáze 4
- [ ] crowdsourcing
- [ ] komunitní backend

---

# 14. Technologie

| Vrstva | Doporučení |
|---|---|
| Core | C++ |
| UI | Qt/QML |
| Storage | SQLite |
| API | REST/JSON |
| Audio | OGG |
| Map layer | OsmAnd |

---

# 15. Rizika

## TODO
- [ ] Android permissions
- [ ] battery optimizations
- [ ] overlay restrictions
- [ ] Android Auto omezení
- [ ] licensing traffic dat
