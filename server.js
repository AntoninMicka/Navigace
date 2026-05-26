const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// Statické servírování souborů ze složky, kde je spuštěn server
app.use(express.static(path.join(__dirname)));

function hasValidLngLat(lng, lat) {
    return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

app.get('/api/route', async (req, res) => {
    const { fromLng, fromLat, toLng, toLat } = req.query;
    const coords = [fromLng, fromLat, toLng, toLat].map(Number);
    const [startLng, startLat, destLng, destLat] = coords;

    if (!hasValidLngLat(startLng, startLat) || !hasValidLngLat(destLng, destLat)) {
        res.status(400).json({ code: 'InvalidCoordinates', message: 'Route coordinates must be valid numbers.' });
        return;
    }

    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${destLng},${destLat}?overview=full&geometries=geojson`;

    try {
        const response = await fetch(osrmUrl);
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

    if (!hasValidLngLat(lng, lat)) {
        res.status(400).json({ code: 'InvalidCoordinates', message: 'Nearest coordinates must be valid numbers.' });
        return;
    }

    const osrmUrl = `https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=1`;

    try {
        const response = await fetch(osrmUrl);
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

    // Pokud je cache prázdná nebo starší než 5 minut, stáhneme čerstvá data z ŘSD
    if (now - lastEventsFetch > EVENTS_CACHE_TTL) {
        try {
            // Geoportál ŘSD nabízí ArcGIS REST API, které umí vracet rovnou GeoJSON (f=geojson).
            // Použijeme query `where=1=1` pro získání všech aktuálních záznamů.
            const rsdAccidentsUrl = 'https://geoportal.rsd.cz/arcgis/rest/services/NDIC/Nehody/MapServer/0/query?where=1%3D1&outFields=*&f=geojson';
            const rsdClosuresUrl = 'https://geoportal.rsd.cz/arcgis/rest/services/NDIC/Uzavirky_a_omezeni/MapServer/0/query?where=1%3D1&outFields=*&f=geojson';

            // Pomocná funkce pro bezpečné stažení a parsování
            const fetchSafeJson = async (url) => {
                const response = await fetch(url, {
                    headers: { 
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/geo+json, application/json, text/plain, */*'
                    }
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const text = await response.text();
                if (!text || !text.trim()) throw new Error('Prázdná odpověď');
                try {
                    return JSON.parse(text);
                } catch (e) {
                    throw new Error(`Neplatný JSON. Začátek: ${text.substring(0, 100).replace(/\n/g, '')}`);
                }
            };

            // Paralelní stahování obou feedů
            const [accidentsRes, closuresRes] = await Promise.allSettled([
                fetchSafeJson(rsdAccidentsUrl),
                fetchSafeJson(rsdClosuresUrl)
            ]);

            let newEvents = [];

            if (accidentsRes.status === 'fulfilled' && accidentsRes.value.features) {
                newEvents = newEvents.concat(accidentsRes.value.features.map(f => ({
                    id: f.properties?.OBJECTID || Math.random().toString(36).substring(2),
                    type: 'accident',
                    lng: f.geometry?.coordinates?.[0] || 0,
                    lat: f.geometry?.coordinates?.[1] || 0,
                    description: f.properties?.POPIS || 'Dopravní nehoda (ŘSD)'
                })));
            } else if (accidentsRes.status === 'rejected') {
                console.log(`[WARN] Stažení nehod z ŘSD selhalo: ${accidentsRes.reason.message}`);
            }

            if (closuresRes.status === 'fulfilled' && closuresRes.value.features) {
                newEvents = newEvents.concat(closuresRes.value.features.map(f => ({
                    id: f.properties?.OBJECTID || Math.random().toString(36).substring(2),
                    type: 'closure',
                    lng: f.geometry?.coordinates?.[0] || 0,
                    lat: f.geometry?.coordinates?.[1] || 0,
                    description: f.properties?.POPIS || 'Uzavírka / Omezení (ŘSD)'
                })));
            } else if (closuresRes.status === 'rejected') {
                console.log(`[WARN] Stažení uzavírek z ŘSD selhalo: ${closuresRes.reason.message}`);
            }

            if (newEvents.length > 0) {
                eventsCache = newEvents;
                lastEventsFetch = now;
                console.log(`[SYS] Stáhnuto ${eventsCache.length} událostí z Geoportálu ŘSD.`);
            } else {
                console.log('[WARN] Z ŘSD se nepodařilo stáhnout žádná data. Zůstává předchozí stav.');
            }
        } catch (err) {
            console.log(`[WARN] Chyba při stahování z ŘSD: ${err.message}`);
        }
    }

    // Odeslat filtrovaná data, pokud máme něco v cache
    if (eventsCache.length > 0) {
        // Ořízneme odesílaná data pouze na události v okruhu zhruba 50 km od uživatele,
        // abychom do mobilu nepřenášeli tisíce nehod z druhého konce republiky.
        const localEvents = eventsCache.filter(evt => {
            return Math.abs(evt.lat - centerLat) < 0.5 && Math.abs(evt.lng - centerLng) < 0.5;
        });
        res.json(localEvents);
        return;
    }

    // --- Fallback na testovací Mock data (pokud není API klíč nastaven) ---
    res.json([
        { id: 'evt-mock-1', type: 'accident', lat: centerLat + 0.005, lng: centerLng + 0.005, description: 'Nehoda (2 vozidla) [MOCK]' },
        { id: 'evt-mock-2', type: 'closure', lat: centerLat - 0.005, lng: centerLng - 0.005, description: 'Uzavírka (Práce na silnici) [MOCK]' }
    ]);
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
