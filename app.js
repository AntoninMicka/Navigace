// Inicializace mapy (používáme volný tmavý styl od CartoDB pro PoC)
const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json', // Tmavý vektorový styl
    center: [15.473, 49.817], // Střed ČR
    zoom: 6,
    pitch: 0, // Začínáme s plochou mapou (overview)
});

// Značka uživatele (Friendly Unit)
const userEl = document.createElement('div');
userEl.className = 'user-marker';

const userMarker = new maplibregl.Marker({ element: userEl, anchor: 'center' });

let isFirstLocation = true;
let currentLng = null;
let currentLat = null;
let hasLocation = false;
let watchId = null;

// Navigační stavové proměnné
let isTracking = false; // Sledování aktivní / Preview mod
let isNavigating = false;
let currentDestLng = null;
let currentDestLat = null;
let currentRouteCoords = []; // Souřadnice trasy pro výpočet odchylky
let destinationMarker = null;
let routePreviewReady = false;
const MAX_ROUTE_SNAP_DISTANCE_METERS = 100;

// Overview mapa pro velký displej
let overviewMap = null;
let overviewUserMarker = null;

// Logovací funkce do panelu
function sysLog(msg) {
    const log = document.getElementById('sys-log');
    const p = document.createElement('p');
    p.innerText = `[SYS] ${msg}`;
    log.prepend(p);
    
    // Omezit logy zobrazené na mapě na maximálně posledních 5 zpráv
    while (log.children.length > 5) {
        log.removeChild(log.lastChild);
    }
}

// --- BFT: Blue Force Tracking ---
const socket = typeof io !== 'undefined' ? io() : null;
const bftMarkers = {}; // Seznam značek ostatních uživatelů

if (socket) {
    socket.on('connect', () => sysLog(`BFT online (ID: ${socket.id.substring(0,5)})`));
    
    socket.on('bft_update', (users) => {
        const activeIds = new Set(users.map(u => u.id));
        
        // Odstranění těch, co se odpojili
        for (let id in bftMarkers) {
            if (!activeIds.has(id)) {
                bftMarkers[id].remove();
                delete bftMarkers[id];
            }
        }

        // Aktualizace pozic ostatních (svoji vlastní ignorujeme, tu si vykreslujeme sami zeleně)
        users.forEach(u => {
            if (u.id === socket.id || !u.lat || !u.lng) return;

            if (!bftMarkers[u.id]) {
                createBftMarker(u);
            } else {
                bftMarkers[u.id].setLngLat([u.lng, u.lat]);
            }
        });
    });
}

// --- Kompas / Magnetometr pro lepší přesnost směru ---
let compassHeading = null;

// Pro Android/moderní prohlížeče
window.addEventListener('deviceorientationabsolute', (event) => {
    if (event.alpha !== null) {
        compassHeading = 360 - event.alpha; // Převedení na standardní azimut
    }
}, true);

// Fallback pro iOS
window.addEventListener('deviceorientation', (event) => {
    if (event.webkitCompassHeading) {
        compassHeading = event.webkitCompassHeading;
    }
}, true);

// Pomocné matematické funkce pro výpočet vzdálenosti bodu od úsečky (pro detekci sjetí z trasy)
function sqr(x) { return x * x; }
function dist2(v, w) { return sqr(v[0] - w[0]) + sqr(v[1] - w[1]); }
function distToSegmentSquared(p, v, w) {
    var l2 = dist2(v, w);
    if (l2 === 0) return dist2(p, v);
    var t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    return dist2(p, [v[0] + t * (w[0] - v[0]), v[1] + t * (w[1] - v[1])]);
}
function distToSegmentInMeters(p, v, w) {
    // Převedení z hrubých stupňů na metry (1 stupeň je zhruba 111.32 km)
    return Math.sqrt(distToSegmentSquared(p, v, w)) * 111320;
}

function waitForMapStyle() {
    if (map.isStyleLoaded()) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const finishWhenReady = () => {
            if (map.isStyleLoaded()) {
                map.off('load', finishWhenReady);
                map.off('styledata', finishWhenReady);
                map.off('idle', finishWhenReady);
                resolve();
            }
        };

        map.on('load', finishWhenReady);
        map.on('styledata', finishWhenReady);
        map.on('idle', finishWhenReady);
        finishWhenReady();
    });
}

function getRouteLayerBeforeId() {
    const preferredLayers = ['waterway-name', 'road-label', 'place-label'];
    return preferredLayers.find((id) => map.getLayer(id));
}

function getExternalRouteUrl(startLng, startLat, destLng, destLat) {
    return `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${destLng},${destLat}?overview=full&geometries=geojson`;
}

function getExternalNearestUrl(lng, lat) {
    return `https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=1`;
}

function isValidLngLat(lng, lat) {
    return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

async function fetchJson(url, errorPrefix) {
    const response = await fetch(url);
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
        throw new Error(`${errorPrefix}: neplatná odpověď`);
    }

    const data = await response.json();

    if (!response.ok) {
        throw new Error(`${errorPrefix}: ${data.code || response.status}`);
    }

    return data;
}

async function requestRouteData(startLng, startLat, destLng, destLat) {
    const params = new URLSearchParams({
        fromLng: startLng,
        fromLat: startLat,
        toLng: destLng,
        toLat: destLat
    });

    try {
        return await fetchJson(`/api/route?${params}`, 'Proxy');
    } catch (proxyErr) {
        sysLog(`WARN: Proxy routing nedostupný (${proxyErr.message}).`);
        return fetchJson(getExternalRouteUrl(startLng, startLat, destLng, destLat), 'OSRM');
    }
}

async function requestNearestData(lng, lat) {
    const params = new URLSearchParams({ lng, lat });

    try {
        return await fetchJson(`/api/nearest?${params}`, 'Proxy nearest');
    } catch (proxyErr) {
        sysLog(`WARN: Proxy nearest nedostupný (${proxyErr.message}).`);
        return fetchJson(getExternalNearestUrl(lng, lat), 'OSRM nearest');
    }
}

async function snapToRoadNetwork(lng, lat, label) {
    if (!isValidLngLat(lng, lat)) {
        throw new Error(`${label}: neplatné souřadnice`);
    }

    const data = await requestNearestData(lng, lat);
    const waypoint = data.waypoints && data.waypoints[0];

    if (data.code !== 'Ok' || !waypoint || !Array.isArray(waypoint.location)) {
        throw new Error(`${label} není na silniční síti`);
    }

    const [snappedLng, snappedLat] = waypoint.location;
    const distance = Number(waypoint.distance);

    if (!isValidLngLat(snappedLng, snappedLat) || !Number.isFinite(distance)) {
        throw new Error(`${label}: neplatný snap na silnici`);
    }

    if (distance > MAX_ROUTE_SNAP_DISTANCE_METERS) {
        throw new Error(`${label} je mimo silniční síť (${Math.round(distance)} m)`);
    }

    if (distance > 15) {
        sysLog(`${label} připnut na silnici (${Math.round(distance)} m).`);
    }

    return { lng: snappedLng, lat: snappedLat, distance };
}

function setDestinationMarker(destLng, destLat) {
    if (!isValidLngLat(destLng, destLat)) {
        throw new Error('Cíl má neplatné souřadnice');
    }

    if (!destinationMarker) {
        const el = document.createElement('div');
        el.className = 'destination-marker';
        destinationMarker = new maplibregl.Marker({ element: el, anchor: 'center' });
    }

    destinationMarker.setLngLat([destLng, destLat]).addTo(map);
}

function updateNavigationButtons() {
    const startBtn = document.getElementById('btn-start-nav');
    const stopBtn = document.getElementById('btn-stop-nav');

    if (!startBtn || !stopBtn) return;

    startBtn.disabled = !routePreviewReady || isNavigating;
    stopBtn.disabled = !isNavigating;
    startBtn.innerText = isNavigating ? 'NAV ACTIVE' : 'START NAV';
}

function startNavigation() {
    if (!routePreviewReady || currentRouteCoords.length === 0) {
        sysLog('WARN: Nejdřív vyber cíl a připrav trasu.');
        return;
    }

    isNavigating = true;
    isTracking = true;
    updateNavigationButtons();

    if (hasLocation) {
        map.flyTo({ center: [currentLng, currentLat], zoom: 16, pitch: 45, duration: 1200 });
    }

    setMobileScreen('map');
    sysLog('Navigace spuštěna.');
}

function stopNavigation() {
    isNavigating = false;
    isTracking = false;
    updateNavigationButtons();
    map.easeTo({ pitch: 0, duration: 500 });
    sysLog(routePreviewReady ? 'Navigace zastavena, trasa zůstává v preview.' : 'Navigace zastavena.');
}

async function renderRoute(routeGeometry) {
    await waitForMapStyle();

    if (!routeGeometry || routeGeometry.type !== 'LineString' || !Array.isArray(routeGeometry.coordinates)) {
        throw new Error('Neplatná geometrie trasy');
    }

    const geojson = { type: 'Feature', properties: {}, geometry: routeGeometry };

    if (map.getSource('route')) {
        map.getSource('route').setData(geojson);
        return;
    }

    map.addSource('route', { type: 'geojson', data: geojson });

    const routeLayer = {
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#00ff00', 'line-width': 5, 'line-opacity': 0.75 }
    };
    const beforeId = getRouteLayerBeforeId();

    if (beforeId) {
        map.addLayer(routeLayer, beforeId);
    } else {
        map.addLayer(routeLayer);
    }
}

// --- Výpočet trasy (Routing API - OSRM) ---
async function calculateRoute(destLng, destLat, options = {}) {
    const startNavigationAfterRoute = options.startNavigationAfterRoute === true;

    if (currentLng === null || currentLat === null) {
        sysLog('WARN: Nelze vypočítat trasu, chybí vlastní poloha.');
        return;
    }
    try {
        sysLog('Vyžaduji taktickou trasu...');
        const startPoint = await snapToRoadNetwork(currentLng, currentLat, 'Start');
        const destPoint = await snapToRoadNetwork(destLng, destLat, 'Cíl');
        const data = await requestRouteData(startPoint.lng, startPoint.lat, destPoint.lng, destPoint.lat);
        
        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];

            setDestinationMarker(destPoint.lng, destPoint.lat);
            await renderRoute(route.geometry);

            currentDestLng = destPoint.lng;
            currentDestLat = destPoint.lat;
            currentRouteCoords = route.geometry.coordinates; // Záchyt souřadnic trasy
            routePreviewReady = true;
            isNavigating = startNavigationAfterRoute;
            isTracking = startNavigationAfterRoute;
            updateNavigationButtons();
            
            if (isNavigating) {
                sysLog(`Trasa aktualizována: ${(route.distance / 1000).toFixed(1)} km, ETA: ${Math.round(route.duration / 60)} min.`);
            } else {
                sysLog(`Trasa připravena: ${(route.distance / 1000).toFixed(1)} km, ETA: ${Math.round(route.duration / 60)} min. Spusť navigaci ručně.`);
            }
        } else {
            sysLog(`WARN: Trasa nenalezena (${data.code || 'bez odpovědi'}).`);
        }
    } catch (err) {
        sysLog(`ERR: Výpočet trasy selhal (${err.message})`);
    }
}

// Funkce pro zpracování úspěšného získání polohy
function handlePositionSuccess(position) {
    const coords = position.coords;
    const lng = coords.longitude;
    const lat = coords.latitude;

    if (!isValidLngLat(lng, lat)) {
        sysLog('WARN: GPS vrátila neplatné souřadnice.');
        return;
    }

    const speed = (coords.speed * 3.6).toFixed(1) || 0; // m/s na km/h
    let heading = coords.heading ? coords.heading : null;
    
    // Fúze senzorů: Pokud jedeme pomalu (< 5 km/h) nebo GPS ztratí směr, použijeme kompas
    if ((speed < 5 || heading === null) && compassHeading !== null) {
        heading = compassHeading;
    }
    
    const displayHeading = heading !== null ? heading.toFixed(0) : '--';

    // Odeslání polohy na BFT server
    if (socket) {
        socket.emit('position_update', { lat, lng, speed, heading: displayHeading });
    }

    // Uložení aktuální polohy pro centrování
    currentLng = lng;
    currentLat = lat;
    hasLocation = true;

    // Update UI
    document.getElementById('status').innerText = 'ONLINE';
    document.getElementById('status').style.color = '#00ff00';
    document.getElementById('pos-lat').innerText = lat.toFixed(5);
    document.getElementById('pos-lon').innerText = lng.toFixed(5);
    document.getElementById('pos-speed').innerText = speed > 0 ? speed : '0';
    document.getElementById('pos-heading').innerText = displayHeading;

    // Update Map
    userMarker.setLngLat([lng, lat]).addTo(map);

    // Update Overview Mapy (pokud existuje)
    if (overviewMap) {
        overviewMap.setCenter([lng, lat]);
        overviewUserMarker.setLngLat([lng, lat]);
    }

    if (isFirstLocation) {
        map.jumpTo({ center: [lng, lat], zoom: 16 });
        isFirstLocation = false;
        sysLog('Poloha zaměřena.');
    } else if (isNavigating && isTracking) {
        map.panTo([lng, lat], { duration: 1000 });
    }

    // Taktické natočení mapy jen pokud uživatel mapu zrovna ručně neprohlíží
    if (heading !== null && map.getPitch() > 0 && isNavigating && isTracking) {
        map.easeTo({ bearing: heading, duration: 1000 });
    }
    
    // --- Kontrola sjetí z trasy (Off-route detection) ---
    if (isNavigating && currentRouteCoords.length > 0) {
        let minMeters = Infinity;
        // Najdeme nejbližší segment trasy
        for (let i = 0; i < currentRouteCoords.length - 1; i++) {
            let d = distToSegmentInMeters([lng, lat], currentRouteCoords[i], currentRouteCoords[i+1]);
            if (d < minMeters) minMeters = d;
        }
        
        if (minMeters > 50) { // Tolerance 50 metrů
            sysLog(`WARN: Mimo trasu (${Math.round(minMeters)}m). Přepočítávám...`);
            currentRouteCoords = []; // Vymazat, aby se nepřepočítávalo v nekonečné smyčce
            if (currentDestLng !== null && currentDestLat !== null) {
                calculateRoute(currentDestLng, currentDestLat, { startNavigationAfterRoute: true });
            }
        }
    }
}

// Funkce pro zpracování chyby GPS
function handlePositionError(error) {
    sysLog(`Chyba GPS: ${error.message}`);
    document.getElementById('status').innerText = hasLocation ? 'GPS STALE' : 'GPS LOST';
    document.getElementById('status').style.color = '#ff3333';
}

const geoOptions = {
    enableHighAccuracy: true,
    maximumAge: 10000,
    timeout: 15000
};

function startLocationWatch() {
    if (!('geolocation' in navigator)) {
        sysLog('ERR: Zařízení nemá GPS.');
        return;
    }

    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
    }

    watchId = navigator.geolocation.watchPosition(handlePositionSuccess, handlePositionError, geoOptions);
}

// Geolocation API
if ('geolocation' in navigator) {
    sysLog('GPS senzor detekován.');
    startLocationWatch();
} else {
    sysLog('ERR: Zařízení nemá GPS.');
}

// --- Wake Lock API (Udržení rozsvíceného displeje) ---
let wakeLock = null;

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            sysLog('Wake Lock aktivní (displej nezhasne).');
            
            wakeLock.addEventListener('release', () => {
                sysLog('Wake Lock uvolněn (aplikace na pozadí).');
            });
        } catch (err) {
            sysLog(`Wake Lock zamítnut: ${err.message}`);
        }
    } else {
        sysLog('WARN: Wake Lock API není podporováno.');
    }
}

// Obnova Wake Locku po návratu do aplikace (probuzení webu)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        requestWakeLock();
        startLocationWatch();
        map.resize();
        // Vynutit okamžitou aktualizaci polohy po probuzení
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(handlePositionSuccess, handlePositionError, geoOptions);
        }
    }
});

window.addEventListener('focus', () => {
    startLocationWatch();
    map.resize();
});

window.addEventListener('pageshow', () => {
    startLocationWatch();
    map.resize();
});

// Zkusíme rovnou při startu
requestWakeLock();

// Pomocná funkce pro vytvoření modré "Friendly Unit" značky
function createBftMarker(u) {
    const el = document.createElement('div');
    el.style.width = '15px';
    el.style.height = '15px';
    el.style.backgroundColor = '#0088ff'; // Taktická BFT modrá
    el.style.borderRadius = '50%';
    el.style.boxShadow = '0 0 10px #0088ff';
    el.style.border = '2px solid #fff';
    
    bftMarkers[u.id] = new maplibregl.Marker({ element: el }).setLngLat([u.lng, u.lat]).addTo(map);
}

// Centrování mapy (Tlačítko CENTER)
document.getElementById('btn-locate').addEventListener('click', () => {
    if (hasLocation) {
        if (isNavigating) {
            isTracking = true; // Obnovit automatické sledování jen během navigace
        }
        map.flyTo({ center: [currentLng, currentLat], zoom: 16, pitch: isNavigating ? 45 : 0, duration: 1500 });
        sysLog(isNavigating ? 'Sledování obnoveno.' : 'Mapa vycentrována.');
    } else {
        sysLog('WARN: Pozice zatím není známa.');
    }
    // Některé prohlížeče vyžadují pro Wake Lock interakci uživatele, zkusíme to i zde
    if (!wakeLock) {
        requestWakeLock();
    }
});

// Zastavení sledování při manuálním pohybu mapou (Preview mód)
map.on('dragstart', () => {
    if (isNavigating && isTracking) {
        isTracking = false;
        sysLog('Preview mód (sledování pozastaveno).');
    }
    if (map.getPitch() > 0) {
        map.easeTo({ pitch: 0, duration: 500 });
    }
});

// Zachycení kliknutí na mapu pro přípravu trasy
map.on('click', (e) => {
    calculateRoute(e.lngLat.lng, e.lngLat.lat);
});

// --- Vyhledávání adres (Nominatim Geocoding) ---
async function searchAddress() {
    const query = document.getElementById('search-input').value;
    if (!query) return;
    sysLog(`Hledám: ${query}`);
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const data = await response.json();
        if (data && data.length > 0) {
            const lon = parseFloat(data[0].lon);
            const lat = parseFloat(data[0].lat);
            sysLog(`Nalezeno: ${data[0].display_name.split(',')[0]}`);
            isTracking = false; // Přepnout do preview modu
            map.flyTo({ center: [lon, lat], zoom: 15, pitch: 0 });
            await calculateRoute(lon, lat);
            setMobileScreen('map');
        } else {
            sysLog('Adresa nenalezena.');
        }
    } catch (err) {
        sysLog('ERR: Vyhledávání selhalo.');
    }
}

document.getElementById('btn-search').addEventListener('click', searchAddress);
document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        searchAddress();
    }
});

// --- Lokální ukládání bodů zájmu (POI) ---
map.on('contextmenu', (e) => {
    const name = prompt("Zadejte taktické označení cíle (POI):", "Cíl");
    if (name) {
        const pois = JSON.parse(localStorage.getItem('tacnav_pois') || '[]');
        pois.push({ name, lng: e.lngLat.lng, lat: e.lngLat.lat });
        localStorage.setItem('tacnav_pois', JSON.stringify(pois));
        sysLog(`POI uloženo: ${name}`);
        renderPOIs();
    }
});

function renderPOIs() {
    const pois = JSON.parse(localStorage.getItem('tacnav_pois') || '[]');
    pois.forEach(poi => {
        const el = document.createElement('div');
        el.style.width = '12px'; el.style.height = '12px';
        el.style.backgroundColor = '#ffcc00'; el.style.borderRadius = '50%';
        el.style.border = '1px solid #000'; el.title = poi.name;
        
        el.addEventListener('click', (e) => { e.stopPropagation(); calculateRoute(poi.lng, poi.lat); setMobileScreen('map'); });
        new maplibregl.Marker({ element: el }).setLngLat([poi.lng, poi.lat]).addTo(map);
    });
}

renderPOIs(); // Vykreslit POI při startu aplikace

// --- UI Toggles ---

document.getElementById('btn-start-nav').addEventListener('click', startNavigation);
document.getElementById('btn-stop-nav').addEventListener('click', stopNavigation);

// Skrývání logů
const logToggleBtn = document.getElementById('btn-log-toggle');
const sysLogEl = document.getElementById('sys-log');
let logsVisible = true;
logToggleBtn.addEventListener('click', () => {
    logsVisible = !logsVisible;
    sysLogEl.classList.toggle('logs-hidden', !logsVisible);
    logToggleBtn.innerText = logsVisible ? 'LOG [ON]' : 'LOG [OFF]';
});

// HUD Modulace
const hudBtn = document.getElementById('btn-hud');
const appContainer = document.getElementById('app-container');

function setMobileScreen(screen) {
    appContainer.classList.remove('screen-map', 'screen-search', 'screen-intel');
    appContainer.classList.add(`screen-${screen}`);

    document.querySelectorAll('.mobile-tab').forEach((tab) => {
        tab.classList.toggle('is-active', tab.dataset.screen === screen);
    });

    if (screen === 'map') {
        setTimeout(() => map.resize(), 50);
        setTimeout(() => map.resize(), 250);
    }
}

document.querySelectorAll('.mobile-tab').forEach((tab) => {
    tab.addEventListener('click', () => setMobileScreen(tab.dataset.screen));
});

setMobileScreen('map');
updateNavigationButtons();

let hudActive = false;
hudBtn.addEventListener('click', () => {
    hudActive = !hudActive;
    if (hudActive) {
        appContainer.classList.add('hud-mode');
        hudBtn.innerText = 'HUD MODE [ON]';
    } else {
        appContainer.classList.remove('hud-mode');
        hudBtn.innerText = 'HUD MODE [OFF]';
    }
});
