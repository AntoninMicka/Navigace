const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const { parseStringPromise } = require('xml2js');

const app = express();
const PORT = process.env.PORT || 3000;
const NDIC_API_KEY = process.env.NDIC_API_KEY || null; // API klíč pro api.dopravniinfo.cz
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const DISABLE_BACKEND_CACHE = process.env.DISABLE_BACKEND_CACHE === 'true'; // Vypnutí cache

// Statické servírování souborů ze složky, kde je spuštěn server
app.use(express.static(path.join(__dirname)));

function hasValidLngLat(lng, lat) {
    return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

app.get('/api/route', async (req, res) => {
    const { fromLng, fromLat, toLng, toLat, profile } = req.query;
    const coords = [fromLng, fromLat, toLng, toLat].map(Number);
    const [startLng, startLat, destLng, destLat] = coords;

    const validProfiles = ['driving', 'foot', 'bicycle'];
    const routeProfile = validProfiles.includes(profile) ? profile : 'driving';

    if (!hasValidLngLat(startLng, startLat) || !hasValidLngLat(destLng, destLat)) {
        res.status(400).json({ code: 'InvalidCoordinates', message: 'Route coordinates must be valid numbers.' });
        return;
    }

    let osrmUrl;
    const coordsStr = `${startLng},${startLat};${destLng},${destLat}`;
    const params = 'overview=full&geometries=geojson&steps=true';
    if (routeProfile === 'foot') {
        osrmUrl = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordsStr}?${params}`;
    } else if (routeProfile === 'bicycle') {
        osrmUrl = `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coordsStr}?${params}`;
    } else {
        osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?${params}`;
    }

    try {
        const response = await fetch(osrmUrl, { headers: { 'User-Agent': 'TacticalNav/1.0 (Node.js backend)' } });
        const data = await response.json();

        if (!response.ok) {
            res.status(response.status).json(data);
            return;
        }

        res.json(data);
    } catch (err) {
        res.status(502).json({ code: 'RoutingProxyError', message: err.message });
    }
});

app.get('/api/nearest', async (req, res) => {
    const lng = Number(req.query.lng);
    const lat = Number(req.query.lat);
    const profile = req.query.profile;

    const validProfiles = ['driving', 'foot', 'bicycle'];
    const routeProfile = validProfiles.includes(profile) ? profile : 'driving';

    if (!hasValidLngLat(lng, lat)) {
        res.status(400).json({ code: 'InvalidCoordinates', message: 'Nearest coordinates must be valid numbers.' });
        return;
    }

    let osrmUrl;
    if (routeProfile === 'foot') {
        osrmUrl = `https://routing.openstreetmap.de/routed-foot/nearest/v1/driving/${lng},${lat}?number=1`;
    } else if (routeProfile === 'bicycle') {
        osrmUrl = `https://routing.openstreetmap.de/routed-bike/nearest/v1/driving/${lng},${lat}?number=1`;
    } else {
        osrmUrl = `https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=1`;
    }

    try {
        const response = await fetch(osrmUrl, { headers: { 'User-Agent': 'TacticalNav/1.0 (Node.js backend)' } });
        const data = await response.json();

        if (!response.ok) {
            res.status(response.status).json(data);
            return;
        }

        res.json(data);
    } catch (err) {
        res.status(502).json({ code: 'NearestProxyError', message: err.message });
    }
});

// --- Cache pro reálné dopravní události (Geoportál ŘSD / NDIC) ---
let eventsCache = [];
let lastEventsFetch = 0;
const EVENTS_CACHE_TTL = 5 * 60 * 1000; // Platnost cache: 5 minut

app.get('/api/events', async (req, res) => {
    const centerLat = Number(req.query.lat) || 49.817;
    const centerLng = Number(req.query.lng) || 15.473;
    const now = Date.now();
    
    let currentEvents = eventsCache;

    // Pokud je cache vypnutá, prázdná nebo starší než 5 minut, stáhneme čerstvá data z ŘSD
    if (DISABLE_BACKEND_CACHE || eventsCache.length === 0 || now - lastEventsFetch > EVENTS_CACHE_TTL) {
        if (NDIC_API_KEY) {
            try {
                const apiUrl = 'https://api.dopravniinfo.cz/v1/situations?area=republic';
                const response = await fetch(apiUrl, {
                    headers: {
                        'X-Api-Key': NDIC_API_KEY,
                        'User-Agent': 'TacticalNav/1.0'
                    }
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();

                const newEvents = data.map(evt => {
                    // API vrací typy jako 'accident', 'roadworks', 'closure'
                    // Pro naši aplikaci mapujeme 'roadworks' na 'closure'
                    let eventType = evt.type === 'accident' ? 'accident' : 'closure';
                    
                    return {
                        id: evt.id,
                        type: eventType,
                        lat: evt.location.latitude,
                        lng: evt.location.longitude,
                        description: evt.title
                    };
                }).filter(evt => hasValidLngLat(evt.lng, evt.lat));

                if (newEvents.length > 0) {
                    currentEvents = newEvents;
                    if (!DISABLE_BACKEND_CACHE) {
                        eventsCache = newEvents;
                        lastEventsFetch = now;
                    }
                    console.log(`[SYS] Stáhnuto ${currentEvents.length} událostí z api.dopravniinfo.cz${DISABLE_BACKEND_CACHE ? ' (bez cache)' : ''}.`);
                } else {
                    console.log('[WARN] Z api.dopravniinfo.cz se nepodařilo stáhnout žádná data. Zůstává předchozí stav.');
                }
            } catch (err) {
                console.log(`[WARN] Chyba při stahování z api.dopravniinfo.cz: ${err.message}`);
            }
        } else {
            // Pokud API klíč není nastaven, zalogujeme varování jen jednou za čas
            if (now - lastEventsFetch > 60000) { // Každou minutu
                 console.log(`=========================================`);
                 console.log(`[WARN] Chybí API klíč pro dopravní informace (NDIC_API_KEY).`);
                 console.log(`[INFO] Používají se pouze testovací (mock) data.`);
                 console.log(`=========================================`);
                 lastEventsFetch = now; // Resetovat časovač, aby se zpráva neopakovala pořád
            }
        }
    }

    // Odeslat filtrovaná data
    if (currentEvents.length > 0) {
        // Ořízneme odesílaná data pouze na události v okruhu zhruba 50 km od uživatele,
        // abychom do mobilu nepřenášeli tisíce nehod z druhého konce republiky.
        const localEvents = currentEvents.filter(evt => {
            return Math.abs(evt.lat - centerLat) < 0.5 && Math.abs(evt.lng - centerLng) < 0.5;
        });
        res.json(localEvents);
        return;
    }

    // --- Fallback (pokud není API klíč nastaven nebo nejsou data) ---
    // Vracíme prázdné pole, abychom se zbavili testovacích značek.
    res.json([]);
});

// --- Cache pro Radary (OpenStreetMap Overpass API) ---
let radarsCache = [];
let lastRadarsFetch = 0;
const RADARS_CACHE_TTL = 24 * 60 * 60 * 1000; // Platnost cache: 24 hodin

app.get('/api/radars', async (req, res) => {
    // Výchozí souřadnice (např. Pardubice / střed ČR)
    const centerLat = Number(req.query.lat) || 49.817;
    const centerLng = Number(req.query.lng) || 15.473;
    const now = Date.now();
    
    let currentRadars = radarsCache;

    if (DISABLE_BACKEND_CACHE || now - lastRadarsFetch > RADARS_CACHE_TTL || radarsCache.length === 0) {
        try {
            // Hledáme jak klasické radary (node), tak úseková měření (často relace nwr)
            const overpassQuery = `[out:json][timeout:120][bbox:48.55,12.09,51.06,18.86];(node["highway"="speed_camera"];nwr["enforcement"="average_speed"];);out center;`;
            const overpassUrl = `https://overpass-api.de/api/interpreter`;
            
            const response = await fetch(overpassUrl, {
                method: 'POST',
                body: "data=" + encodeURIComponent(overpassQuery),
                headers: { 
                    'User-Agent': 'TacticalNav/1.0 (Node.js backend)',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            if (data && data.elements) {
                currentRadars = data.elements.map(node => {
                    const tags = node.tags || {};
                    const isAverage = tags['camera:type'] === 'average' || tags['enforcement'] === 'average_speed';
                    return {
                        id: `osm-rad-${node.id}`,
                        type: isAverage ? 'average_camera' : 'radar',
                        lat: node.lat || (node.center && node.center.lat),
                        lng: node.lon || (node.center && node.center.lon),
                        description: isAverage ? 'Úsekové měření' : 'Senzor (Radar)'
                    };
                }).filter(rad => rad.lat && rad.lng);
                
                if (!DISABLE_BACKEND_CACHE) {
                    radarsCache = currentRadars;
                    lastRadarsFetch = now;
                }
                console.log(`[SYS] Stáhnuto ${currentRadars.length} radarů z OSM${DISABLE_BACKEND_CACHE ? ' (bez cache)' : ''}.`);
            }
        } catch (err) {
            console.log(`[WARN] Chyba při stahování z OSM Overpass: ${err.message}`);
        }
    }

    // Odeslat radary v okruhu zhruba 50 km od uživatele
    const localRadars = currentRadars.filter(rad => {
        return Math.abs(rad.lat - centerLat) < 0.5 && Math.abs(rad.lng - centerLng) < 0.5;
    });
    res.json(localRadars);
});

// --- Cache pro POI / Čerpací stanice (OpenStreetMap Overpass API) ---
let poisCache = [];
let lastPoisFetch = 0;
const POIS_CACHE_TTL = 24 * 60 * 60 * 1000; // Platnost cache: 24 hodin

app.get('/api/pois', async (req, res) => {
    const centerLat = Number(req.query.lat) || 49.817;
    const centerLng = Number(req.query.lng) || 15.473;
    const now = Date.now();
    
    let currentPois = poisCache;

    if (DISABLE_BACKEND_CACHE || now - lastPoisFetch > POIS_CACHE_TTL || poisCache.length === 0) {
        try {
            // Přidáme i nabíjecí stanice (EV) a vytáhneme detaily
            const overpassQuery = `[out:json][timeout:120][bbox:48.55,12.09,51.06,18.86];(nwr["amenity"="fuel"];nwr["amenity"="charging_station"];nwr["amenity"="hospital"];nwr["amenity"="police"];);out center;`;
            const overpassUrl = `https://overpass-api.de/api/interpreter`;
            const response = await fetch(overpassUrl, {
                method: 'POST',
                body: "data=" + encodeURIComponent(overpassQuery),
                headers: { 
                    'User-Agent': 'TacticalNav/1.0 (Node.js backend)',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                }
            });
            
            const rawText = await response.text();
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} - ${rawText.substring(0, 300)}`);
            }
            
            let data;
            try {
                data = JSON.parse(rawText);
            } catch (e) {
                throw new Error(`Odpověď není platný JSON. Surový text: ${rawText.substring(0, 500)}`);
            }
            
            if (data && data.elements) {
                if (data.elements.length === 0) {
                    console.log(`[SYS] Overpass API nevrátilo žádná POI data. Detailní výpis odpovědi:`);
                    console.log(JSON.stringify(data, null, 2));
                    console.log(`[DEBUG] Použitý dotaz: ${overpassQuery}`);
                }
                currentPois = data.elements.map(node => {
                    const tags = node.tags || {};
                    const amenity = tags.amenity || 'fuel';
                    let type = 'fuel';
                    let description = 'Týl (Palivo)';
                    
                    if (amenity === 'charging_station') {
                        type = 'fuel';
                        description = 'Týl (EV Nabíječka)';
                    } else if (amenity === 'fuel') {
                        let fuelTypes = [];
                        if (tags['fuel:diesel'] === 'yes') fuelTypes.push('Diesel');
                        if (tags['fuel:octane_95'] === 'yes') fuelTypes.push('N95');
                        if (tags['fuel:octane_98'] === 'yes') fuelTypes.push('N98');
                        if (tags['fuel:lpg'] === 'yes') fuelTypes.push('LPG');
                        if (tags['fuel:cng'] === 'yes') fuelTypes.push('CNG');
                        if (tags['fuel:adblue'] === 'yes') fuelTypes.push('AdBlue');
                        if (fuelTypes.length > 0) description += ` [${fuelTypes.join(', ')}]`;
                    } else if (amenity === 'hospital' || amenity === 'clinic') {
                        type = 'medical';
                        description = 'Medevac (Nemocnice)';
                    } else if (amenity === 'police') {
                        type = 'police';
                        description = 'Sbor (Policie)';
                    }
                    return {
                        id: `osm-poi-${node.id}`,
                        type: type,
                        lat: node.lat || (node.center && node.center.lat),
                        lng: node.lon || (node.center && node.center.lon),
                        description: description
                    };
                }).filter(poi => poi.lat && poi.lng); // Vyřadit cokoli bez GPS pozice
                
                if (!DISABLE_BACKEND_CACHE) {
                    poisCache = currentPois;
                    lastPoisFetch = now;
                }
                console.log(`[SYS] Stáhnuto ${currentPois.length} POI z OSM${DISABLE_BACKEND_CACHE ? ' (bez cache)' : ''}.`);
            }
        } catch (err) {
            console.log(`[WARN] Chyba při stahování POI z OSM: ${err.message}`);
        }
    }

    const localPois = currentPois.filter(poi => Math.abs(poi.lat - centerLat) < 0.3 && Math.abs(poi.lng - centerLng) < 0.3);
    res.json(localPois);
});

// Fallback pro SPA / PWA - všechny neznámé routy pošlou index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Načtení SSL certifikátů (pokud existují)
let httpsServer;
try {
    const privateKey = fs.readFileSync(path.join(__dirname, 'server.key'), 'utf8');
    const certificate = fs.readFileSync(path.join(__dirname, 'server.cert'), 'utf8');
    const credentials = { key: privateKey, cert: certificate };
    httpsServer = https.createServer(credentials, app);
} catch (err) {
    console.log(`=========================================`);
    console.log(`[WARN] SSL certifikáty (server.key, server.cert) nenalezeny.`);
    console.log(`[WARN] HTTPS server se nespustí. Pro testování polohy na mobilu je HTTPS nutné!`);
    console.log(`[TIP]  Pro jejich vygenerování spusťte v terminálu tento příkaz:`);
    console.log(`       openssl req -nodes -new -x509 -keyout server.key -out server.cert -days 365`);
    console.log(`=========================================`);
}

// Inicializace Socket.io
const io = new Server();
const bftUsers = {}; // Paměť pro pozice uživatelů

io.on('connection', (socket) => {
    console.log(`[BFT] Uživatel připojen: ${socket.id}`);
    
    socket.on('position_update', (data) => {
        // Uložení/aktualizace pozice uživatele
        bftUsers[socket.id] = { id: socket.id, ...data };
        // Rozeslání všem připojeným klientům
        io.emit('bft_update', Object.values(bftUsers));
    });

    socket.on('disconnect', () => {
        console.log(`[BFT] Uživatel odpojen: ${socket.id}`);
        delete bftUsers[socket.id];
        io.emit('bft_update', Object.values(bftUsers)); // Aktualizace mapy po odpojení
    });
});

// Spuštění HTTP serveru
const httpServer = http.createServer(app);
io.attach(httpServer);
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`[SYS] HTTP Server běží na portu ${PORT}`);
    console.log(`[SYS] Lokální přístup: http://localhost:${PORT}`);
    console.log(`=========================================`);
    console.log(`[WARN] Pro testování GPS na mobilu potřebujete HTTPS!`);
});

// Spuštění HTTPS serveru (pokud byly načteny certifikáty)
if (httpsServer) {
    io.attach(httpsServer);
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log(`[SYS] HTTPS Server běží na portu ${HTTPS_PORT}`);
        console.log(`[SYS] Lokální přístup: https://localhost:${HTTPS_PORT}`);
        console.log(`[TIP] Na mobilu otevřete: https://<IP_VAŠEHO_PC>:${HTTPS_PORT}`);
    });
}
