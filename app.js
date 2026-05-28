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
userEl.className = 'app6-marker app6-marker-self app6-asset-car';
userEl.innerHTML = `
    <div class="app6-direction-vector" id="self-dir-vector" style="display: none;"></div>
    <div class="app6-symbol" aria-label="Friendly self equipment">
        <div class="app6-frame app6-equipment-frame">
            <div class="app6-asset-icon"></div>
        </div>
    </div>
    <div class="app6-amplifiers">
        <div class="app6-amp-left">
            <div class="app6-amp-z" id="self-amp-z">-- km/h</div>
        </div>
        <div class="app6-amp-right">
            <div class="app6-amp-t">SELF</div>
            <div class="app6-amp-h" id="self-amp-h">HDG --</div>
        </div>
        <div class="app6-amp-bottom">
            <div class="app6-amp-y" id="self-amp-mgrs">--</div>
        </div>
    </div>
`;

const userMarker = new maplibregl.Marker({ element: userEl, anchor: 'center' }).setLngLat([15.473, 49.817]).addTo(map);
const APP6_ASSET_TYPES = ['person', 'bicycle', 'motorcycle', 'car', 'hq'];
const isAdminView = new URLSearchParams(window.location.search).get('admin') === '1'
    || localStorage.getItem('tacnav_admin') === '1';
let currentAssetType = localStorage.getItem('tacnav_asset_type') || 'car';

let isFirstLocation = true;
let currentLng = null;
let currentLat = null;
let hasLocation = false;
let currentSpeedKmh = 0;
let watchId = null;

// Navigační stavové proměnné
let isTracking = false; // Sledování aktivní / Preview mod
let isNavigating = false;
let currentDestLng = null;
let currentDestLat = null;
let currentRouteSteps = []; // Pokyny pro navigaci
let currentRouteCoords = []; // Souřadnice trasy pro výpočet odchylky
let offRouteCounter = 0; // Počítadlo pro potvrzení sjetí z trasy
let availableRoutes = []; // Alternativní trasy
let activeRouteIndex = 0;
let destinationMarker = null;
let routePreviewReady = false;
const MAX_ROUTE_SNAP_DISTANCE_METERS = 100;

// Overview mapa pro velký displej
let overviewMap = null;
let overviewUserMarker = null;
let overviewDestinationMarker = null;

// Inicializace přehledové mapy (Overview)
overviewMap = new maplibregl.Map({
    container: 'overview-map',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    center: [15.473, 49.817],
    zoom: 5,
    pitch: 0,
    bearing: 0,
    dragRotate: false,
    touchPitch: false
});

// --- Taktická mřížka (Grid Overlay) ---
function applyGridToMap(targetMap, sourceId) {
    if (!targetMap || !targetMap.isStyleLoaded()) return;
    
    const bounds = targetMap.getBounds();
    const zoom = targetMap.getZoom();
    
    // Dynamická hustota sítě podle přiblížení
    let step = 1;
    if (zoom > 13) step = 0.01;
    else if (zoom > 9) step = 0.1;

    const features = [];
    
    const minLng = Math.floor(bounds.getWest() / step) * step;
    const maxLng = Math.ceil(bounds.getEast() / step) * step;
    for (let lng = minLng; lng <= maxLng; lng += step) {
        features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[lng, Math.max(bounds.getSouth() - 1, -90)], [lng, Math.min(bounds.getNorth() + 1, 90)]] }
        });
    }

    const minLat = Math.floor(bounds.getSouth() / step) * step;
    const maxLat = Math.ceil(bounds.getNorth() / step) * step;
    for (let lat = minLat; lat <= maxLat; lat += step) {
        features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[Math.max(bounds.getWest() - 1, -180), lat], [Math.min(bounds.getEast() + 1, 180), lat]] }
        });
    }

    const geojson = { type: 'FeatureCollection', features };

    if (targetMap.getSource(sourceId)) {
        targetMap.getSource(sourceId).setData(geojson);
    } else {
        targetMap.addSource(sourceId, { type: 'geojson', data: geojson });
        
        // Snaha vložit grid POD textové popisky mapy (aby nebyla rušivá)
        const preferredLayers = ['waterway-name', 'road-label', 'place-label', 'poi-label'];
        const beforeId = preferredLayers.find(id => targetMap.getLayer(id));
        
        targetMap.addLayer({
            id: `${sourceId}-line`,
            type: 'line',
            source: sourceId,
            paint: {
                'line-color': '#00ff00',
                'line-width': 1,
                'line-opacity': 0.18,
                'line-dasharray': [4, 4]
            }
        }, beforeId);
    }
}

// Zajištění vykreslení Gridu na obě mapy
map.on('style.load', () => applyGridToMap(map, 'tactical-grid'));
map.on('move', () => applyGridToMap(map, 'tactical-grid'));
overviewMap.on('style.load', () => applyGridToMap(overviewMap, 'overview-tactical-grid'));
overviewMap.on('move', () => applyGridToMap(overviewMap, 'overview-tactical-grid'));

// Formátování do MGRS řetězce
function formatMGRS(lng, lat) {
    if (typeof mgrs === 'undefined') return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    try {
        const m = mgrs.forward([lng, lat]);
        const match = m.match(/^(\d+[A-Z])([A-Z]{2})(\d+)$/i);
        if (match) {
            const en = match[3];
            const half = en.length / 2;
            return `${match[1]} ${match[2]} ${en.substring(0, half)} ${en.substring(half)}`;
        }
        return m;
    } catch(e) {
        return '--';
    }
}

// Značka uživatele na přehledové mapě (bez textových popisků pro přehlednost)
const overviewUserEl = document.createElement('div');
overviewUserEl.className = 'app6-marker app6-marker-self app6-asset-car';
overviewUserEl.innerHTML = `
    <div class="app6-symbol" style="transform: scale(0.7); transform-origin: top left;">
        <div class="app6-frame app6-equipment-frame">
            <div class="app6-asset-icon"></div>
        </div>
    </div>
`;
overviewUserMarker = new maplibregl.Marker({ element: overviewUserEl, anchor: 'center' })
    .setLngLat([15.473, 49.817])
    .addTo(overviewMap);

window.addEventListener('resize', () => {
    if (window.innerWidth >= 768 && overviewMap) overviewMap.resize();
});

// Logovací funkce do panelu
function sysLog(msg, options = {}) {
    const log = document.getElementById('sys-log');
    const p = document.createElement('p');
    p.innerText = `[SYS] ${msg}`;
    log.prepend(p);

    // Plynulé zmizení logu po 10 vteřinách
    setTimeout(() => {
        if (log.contains(p)) {
            p.style.opacity = '0';
            p.style.transition = 'opacity 1s ease-out';
            setTimeout(() => { if (log.contains(p)) log.removeChild(p); }, 1000);
        }
    }, 10000);

    while (log.children.length > 6) {
        log.removeChild(log.lastChild);
    }

    if (options.speak) {
        // Vyčistit text pro hlasový výstup
        const textToSpeak = msg.replace(/\[.*?\]/g, '').replace(/\{.*?\}/g, '').trim();
        if (textToSpeak) {
            // Hlášení s vysokou prioritou přeruší ostatní
            speak(textToSpeak, options.priority || false);
        }
    }
}

function setAssetType(type) {
    const safeType = APP6_ASSET_TYPES.includes(type) ? type : 'car';
    const nextType = safeType === 'hq' && !isAdminView ? 'car' : safeType;

    APP6_ASSET_TYPES.forEach((assetType) => {
        userEl.classList.toggle(`app6-asset-${assetType}`, assetType === nextType);
        if (overviewUserMarker) {
            overviewUserMarker.getElement().classList.toggle(`app6-asset-${assetType}`, assetType === nextType);
        }
    });

    currentAssetType = nextType;
    localStorage.setItem('tacnav_asset_type', currentAssetType);

    // Odeslat update ikony ostatním přes BFT
    if (socket && hasLocation) {
        socket.emit('position_update', { 
            lat: currentLat, 
            lng: currentLng, 
            speed: document.getElementById('pos-speed').innerText, 
            heading: document.getElementById('pos-heading').innerText,
            assetType: currentAssetType 
        });
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
                bftMarkers[id].marker.remove();
                if (bftMarkers[id].overviewMarker) bftMarkers[id].overviewMarker.remove();
                delete bftMarkers[id];
            }
        }

        // Aktualizace pozic ostatních
        users.forEach(u => {
            if (u.id === socket.id || !u.lat || !u.lng) return;

            if (!bftMarkers[u.id]) {
                createBftMarker(u);
            } else {
                bftMarkers[u.id].marker.setLngLat([u.lng, u.lat]);

                bftMarkers[u.id].el.querySelector('.app6-amp-z').innerText = `${u.speed || 0} km/h`;
                bftMarkers[u.id].el.querySelector('.app6-amp-h').innerText = `HDG ${u.heading || '--'}`;
                
                const mgrsEl = bftMarkers[u.id].el.querySelector('.app6-amp-y');
                if (mgrsEl) mgrsEl.innerText = formatMGRS(u.lng, u.lat);

                bftMarkers[u.id].userData = u;
                const currentClass = Array.from(bftMarkers[u.id].el.classList).find(c => c.startsWith('app6-asset-'));
                const newClass = `app6-asset-${u.assetType || 'car'}`;
                if (currentClass !== newClass) {
                    if (currentClass) bftMarkers[u.id].el.classList.remove(currentClass);
                    bftMarkers[u.id].el.classList.add(newClass);
                }
            }
        });
        updateDirectionVectors();
    });
}

// --- Kompas / Magnetometr pro lepší přesnost směru ---
let compassHeading = null;
let activeHeading = null;
let lastBearingUpdate = 0;
let compassPermissionAsked = false;
let compassEventsSeen = 0;

function normalizeHeading(value) {
    if (!Number.isFinite(value)) return null;
    return ((value % 360) + 360) % 360;
}

function headingDelta(a, b) {
    return Math.abs((((a - b) + 540) % 360) - 180);
}

function setActiveHeading(heading, updateMap = false) {
    const normalized = normalizeHeading(heading);
    if (normalized === null) return;

    activeHeading = normalized;
    document.getElementById('pos-heading').innerText = activeHeading.toFixed(0);

    if (!updateMap || !isNavigating || !isTracking || map.getPitch() <= 0) return;

    const now = performance.now();
    const currentBearing = normalizeHeading(map.getBearing()) || 0;

    if (now - lastBearingUpdate < 120 || headingDelta(activeHeading, currentBearing) < 3) return;

    lastBearingUpdate = now;
    map.easeTo({ bearing: activeHeading, duration: 120, easing: (t) => t });
}

function handleCompassHeading(heading, source) {
    const normalized = normalizeHeading(heading);
    if (normalized === null) return;

    compassHeading = normalized;
    compassEventsSeen++;
    setActiveHeading(compassHeading, true);
    const compassBtn = document.getElementById('btn-compass');
    if (compassBtn) {
        compassBtn.innerText = `HDG ${compassHeading.toFixed(0)}`;
    }

    if (compassEventsSeen === 1) {
        sysLog(`Kompas aktivní (${source}).`);
    }
}

async function requestCompassAccess() {
    if (compassPermissionAsked) return;
    compassPermissionAsked = true;

    if (!window.isSecureContext) {
        sysLog('WARN: Kompas vyžaduje HTTPS nebo localhost.');
        return;
    }

    try {
        if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
            const permission = await DeviceOrientationEvent.requestPermission();
            sysLog(permission === 'granted' ? 'Kompas povolen.' : 'Kompas zamítnut.');
        } else {
            sysLog('Kompas: čekám na data senzoru.');
        }
    } catch (err) {
        sysLog(`Kompas nelze povolit: ${err.message}`);
    }
}

// Pro Android/moderní prohlížeče
window.addEventListener('deviceorientationabsolute', (event) => {
    if (event.alpha !== null) {
        handleCompassHeading(360 - event.alpha, 'absolute');
    }
}, true);

// Fallback pro iOS
window.addEventListener('deviceorientation', (event) => {
    if (event.webkitCompassHeading) {
        handleCompassHeading(event.webkitCompassHeading, 'webkit');
    } else if (event.absolute && event.alpha !== null) {
        handleCompassHeading(360 - event.alpha, 'orientation');
    }
}, true);

// --- Vektor směru (Q) - Aktualizace UI ---
function updateDirectionVectors() {
    const mapBearing = map.getBearing();

    // Aktualizace vlastní značky
    const selfVector = document.getElementById('self-dir-vector');
    if (selfVector && activeHeading !== null && currentSpeedKmh > 2) {
        const rot = activeHeading - mapBearing;
        const h = Math.min(currentSpeedKmh * 1.5, 150); // Max délka 150px (odpovídá 100 km/h)
        selfVector.style.height = `${h}px`;
        selfVector.style.transform = `rotate(${rot}deg)`;
        selfVector.style.display = 'block';
    } else if (selfVector) {
        selfVector.style.display = 'none';
    }

    // Aktualizace BFT značek přátel
    Object.values(bftMarkers).forEach(bft => {
        const vec = bft.el.querySelector('.app6-direction-vector');
        const u = bft.userData;
        if (vec && u && u.heading !== null && u.heading !== '--' && u.speed > 2) {
            const rot = parseFloat(u.heading) - mapBearing;
            const h = Math.min(parseFloat(u.speed) * 1.5, 150);
            vec.style.height = `${h}px`;
            vec.style.transform = `rotate(${rot}deg)`;
            vec.style.display = 'block';
        } else if (vec) {
            vec.style.display = 'none';
        }
    });
}

// Přepočítat vektory, pokud uživatel mapou ručně otáčí
map.on('rotate', updateDirectionVectors);

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

function getExternalRouteUrl(startLng, startLat, destLng, destLat, profile = 'driving') {
    const coords = `${startLng},${startLat};${destLng},${destLat}`;
    const params = 'overview=full&geometries=geojson&steps=true&alternatives=true';
    if (profile === 'foot') return `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coords}?${params}`;
    if (profile === 'bicycle') return `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coords}?${params}`;
    return `https://router.project-osrm.org/route/v1/driving/${coords}?${params}`;
}

function getExternalNearestUrl(lng, lat, profile = 'driving') {
    if (profile === 'foot') return `https://routing.openstreetmap.de/routed-foot/nearest/v1/driving/${lng},${lat}?number=1`;
    if (profile === 'bicycle') return `https://routing.openstreetmap.de/routed-bike/nearest/v1/driving/${lng},${lat}?number=1`;
    return `https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=1`;
}

function getRoutingProfile() {
    switch (currentAssetType) {
        case 'person':
            return 'foot';
        case 'bicycle':
            return 'bicycle';
        case 'motorcycle':
        case 'car':
        case 'hq':
        default:
            return 'driving';
    }
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

async function requestRouteData(startLng, startLat, destLng, destLat, profile = 'driving') {
    const params = new URLSearchParams({
        fromLng: startLng,
        fromLat: startLat,
        toLng: destLng,
        toLat: destLat,
        profile: profile
    });

    try {
        return await fetchJson(`/api/route?${params}`, 'Proxy');
    } catch (proxyErr) {
        sysLog(`WARN: Proxy routing nedostupný (${proxyErr.message}).`);
        // Fallback to direct OSRM call with the correct profile
        return fetchJson(getExternalRouteUrl(startLng, startLat, destLng, destLat, profile), 'OSRM');
    }
}

async function requestNearestData(lng, lat, profile = 'driving') {
    const params = new URLSearchParams({ lng, lat, profile });

    try {
        return await fetchJson(`/api/nearest?${params}`, 'Proxy nearest');
    } catch (proxyErr) {
        sysLog(`WARN: Proxy nearest nedostupný (${proxyErr.message}).`);
        return fetchJson(getExternalNearestUrl(lng, lat, profile), 'OSRM nearest');
    }
}

async function snapToRoadNetwork(lng, lat, label, profile = 'driving') {
    if (!isValidLngLat(lng, lat)) {
        throw new Error(`${label}: neplatné souřadnice`);
    }
    
    const data = await requestNearestData(lng, lat, profile);
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

    if (overviewMap) {
        if (!overviewDestinationMarker) {
            const el = document.createElement('div');
            el.innerHTML = `<div class="destination-marker" style="transform: translate(-50%, -50%) scale(0.6); position: absolute; left: 0; top: 0;"></div>`;
            overviewDestinationMarker = new maplibregl.Marker({ element: el, anchor: 'center' });
        }
        overviewDestinationMarker.setLngLat([destLng, destLat]).addTo(overviewMap);
    }
}

function updateNavigationButtons() {
    const startBtn = document.getElementById('btn-start-nav');
    const stopBtn = document.getElementById('btn-stop-nav');
    const clearBtn = document.getElementById('btn-clear-route');

    if (!startBtn || !stopBtn) return;

    startBtn.disabled = !routePreviewReady || isNavigating;
    stopBtn.disabled = !isNavigating;
    if (clearBtn) clearBtn.disabled = !routePreviewReady;
    startBtn.innerText = isNavigating ? 'NAV ACTIVE' : 'START NAV';
}

// --- Hack pro udržení PWA na pozadí (Zabránění uspání při zhasnutém displeji) ---
// Minimalistický tichý WAV soubor (1 vzorek) v Base64
const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
silentAudio.loop = true;

function playBackgroundAudio() {
    silentAudio.play().catch(() => sysLog('WARN: Background Audio Hack se nespustil.'));
}

function stopBackgroundAudio() {
    silentAudio.pause();
}

function focusCurrentPosition(duration = 500) {
    if (!hasLocation) {
        sysLog('WARN: Pozice zatím není známa.');
        return;
    }

    const camera = {
        center: [currentLng, currentLat],
        zoom: 16,
        pitch: isNavigating ? 45 : 0,
        duration,
        easing: (t) => t
    };

    if (isNavigating && activeHeading !== null) {
        camera.bearing = activeHeading;
    }

    map.easeTo(camera);
}

function startNavigation() {
    if (!routePreviewReady || currentRouteCoords.length === 0) {
        sysLog('WARN: Nejdřív vyber cíl a připrav trasu.');
        return;
    }

    requestCompassAccess();
    playBackgroundAudio(); // Spuštění tichého zvuku pro oklamání OS při navigaci
    isNavigating = true;
    isTracking = true;
    updateNavigationButtons();

    setMobileScreen('map');
    setTimeout(() => focusCurrentPosition(650), 80);
    setTimeout(() => focusCurrentPosition(250), 350, { speak: true });
    sysLog('Navigace spuštěna.', { speak: true });
}

function stopNavigation() {
    isNavigating = false;
    isTracking = false;
    updateNavigationButtons();
    stopBackgroundAudio(); // Konec tichého audia
    map.easeTo({ pitch: 0, duration: 500 });
    sysLog(routePreviewReady ? 'Navigace zastavena, trasa zůstává v preview.' : 'Navigace zastavena.', { speak: true });
}

function clearRoute() {
    isNavigating = false;
    isTracking = false;
    routePreviewReady = false;
    currentRouteCoords = [];
    currentRouteSteps = [];
    currentDestLng = null;
    currentDestLat = null;
    availableRoutes = [];
    activeRouteIndex = 0;

    // Smazání cesty z map
    if (map.getSource('route')) {
        map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
    }
    if (overviewMap && overviewMap.getSource('route')) {
        overviewMap.getSource('route').setData({ type: 'FeatureCollection', features: [] });
    }

    // Smazání cílových bodů
    if (destinationMarker) {
        destinationMarker.remove();
        destinationMarker = null;
    }
    if (overviewDestinationMarker) {
        overviewDestinationMarker.remove();
        overviewDestinationMarker = null;
    }

    updateNavigationButtons();
    updateNavStepsUI(currentLng, currentLat);
    renderElevationProfile(); // Vypne výškový profil
    updateHeaderInfo(currentLng !== null ? {lng: currentLng, lat: currentLat} : null, null); // Reset záhlaví

    const altsContainer = document.getElementById('route-alternatives');
    if (altsContainer) altsContainer.style.display = 'none';

    document.body.classList.remove('has-route');

    stopBackgroundAudio();
    map.easeTo({ pitch: 0, duration: 500 });
    sysLog('Trasa zrušena.', { speak: true });
}

async function renderRoute(routeGeoJSON) {
    await waitForMapStyle();

    if (!routeGeoJSON || routeGeoJSON.type !== 'FeatureCollection') {
        throw new Error('Neplatná data trasy');
    }

    if (map.getSource('route')) {
        map.getSource('route').setData(routeGeoJSON);
    } else {
        map.addSource('route', { type: 'geojson', data: routeGeoJSON });

        const routeLayer = {
            id: 'route',
            type: 'line',
            source: 'route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            // Použití dynamické barvy z properties každého segmentu trasy
            paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 0.75 }
        };
        const beforeId = getRouteLayerBeforeId();

        if (beforeId) {
            map.addLayer(routeLayer, beforeId);
        } else {
            map.addLayer(routeLayer);
        }
    }

    // Přidání trasy i na přehledovou mapu
    if (overviewMap && overviewMap.isStyleLoaded()) {
        if (overviewMap.getSource('route')) {
            overviewMap.getSource('route').setData(routeGeoJSON);
        } else {
            overviewMap.addSource('route', { type: 'geojson', data: routeGeoJSON });
            overviewMap.addLayer({
                id: 'route',
                type: 'line',
                source: 'route',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.75 }
            });
        }
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
        const profile = getRoutingProfile();
        sysLog(`Profil trasy: ${profile.toUpperCase()}`);
        const startPoint = await snapToRoadNetwork(currentLng, currentLat, 'Start', profile);
        const destPoint = await snapToRoadNetwork(destLng, destLat, 'Cíl', profile);
        const data = await requestRouteData(startPoint.lng, startPoint.lat, destPoint.lng, destPoint.lat, profile);
        
        if (data.routes && data.routes.length > 0) {
            availableRoutes = data.routes;
            activeRouteIndex = 0;
            
            currentDestLng = destPoint.lng;
            currentDestLat = destPoint.lat;
            routePreviewReady = true;
            isNavigating = startNavigationAfterRoute;
            isTracking = startNavigationAfterRoute;
 
            setDestinationMarker(destPoint.lng, destPoint.lat);
            
            await applySelectedRoute();
            updateHeaderInfo(startPoint, destPoint); // Zápis MGRS do záhlaví
            renderAlternativesUI(); // Zobrazení možností v levém panelu
        } else {
            sysLog(`WARN: Trasa nenalezena (${data.code || 'bez odpovědi'}).`);
        }
    } catch (err) {
        sysLog(`ERR: Výpočet trasy selhal (${err.message})`);
    }
}

async function applySelectedRoute() {
    const route = availableRoutes[activeRouteIndex];
    const leg = route.legs && route.legs[0];
    const profile = getRoutingProfile();

    currentRouteCoords = route.geometry.coordinates;

    const routeFeatures = [];
    if (leg && leg.steps && leg.steps.length > 0) {
        leg.steps.forEach(step => {
            if (step.geometry && step.geometry.coordinates) {
                const speedKmh = step.duration > 0 ? (step.distance / step.duration) * 3.6 : 0;
                let segmentColor = '#00ff00';
                
                if (profile === 'driving') {
                    if (speedKmh < 30) segmentColor = '#ff3333';
                    else if (speedKmh < 60) segmentColor = '#ffcc00';
                } else if (profile === 'bicycle') {
                    if (speedKmh < 10) segmentColor = '#ff3333';
                    else if (speedKmh < 15) segmentColor = '#ffcc00';
                } else {
                    if (speedKmh < 2) segmentColor = '#ff3333';
                    else if (speedKmh < 4) segmentColor = '#ffcc00';
                }
                
                routeFeatures.push({
                    type: 'Feature',
                    properties: { color: segmentColor },
                    geometry: step.geometry
                });
            }
        });
    }
    
    const routeGeoJSON = { type: 'FeatureCollection', features: routeFeatures };
    await renderRoute(routeGeoJSON);

    if (leg && leg.steps) {
        leg.steps.forEach(step => delete step.announced);
        currentRouteSteps = leg.steps;
    } else {
        currentRouteSteps = [];
    }

    updateNavigationButtons();
    updateNavStepsUI(currentLng, currentLat);
    renderElevationProfile(); // Update spodní grafiky

    document.body.classList.add('has-route');

    if (isNavigating) {
        setTimeout(() => focusCurrentPosition(350), 80);
        sysLog(`Trasa vybrána: ${(route.distance / 1000).toFixed(1)} km, ETA: ${Math.round(route.duration / 60)} min.`);
    } else {
        sysLog(`Trasa připravena: ${(route.distance / 1000).toFixed(1)} km, ETA: ${Math.round(route.duration / 60)} min.`);
    }
}

// Funkce pro zpracování úspěšného získání polohy
function handlePositionSuccess(position) {
    const coords = position.coords;
    const lng = coords.longitude;
    const lat = coords.latitude;
    const accuracy = coords.accuracy || 0;

    if (!isValidLngLat(lng, lat)) {
        sysLog('WARN: GPS vrátila neplatné souřadnice.');
        return;
    }

    // Ignorovat velké odskoky GPS (tzv. ustřelení), pokud už máme nějakou polohu zaměřenou.
    if (hasLocation && accuracy > 60) {
        return;
    }

    const speedKmh = Number.isFinite(coords.speed) ? coords.speed * 3.6 : 0;
    const displaySpeed = speedKmh.toFixed(1);
    let heading = normalizeHeading(coords.heading);
    
    // Fúze senzorů: Pokud jedeme pomalu (< 5 km/h) nebo GPS ztratí směr, použijeme kompas
    if ((speedKmh < 8 || heading === null) && compassHeading !== null) {
        heading = compassHeading;
    }
    
    if (heading !== null) {
        setActiveHeading(heading, true);
    }

    const displayHeading = activeHeading !== null ? activeHeading.toFixed(0) : '--';
    currentSpeedKmh = speedKmh;

    // Odeslání polohy na BFT server
    if (socket) {
        socket.emit('position_update', { lat, lng, speed: displaySpeed, heading: displayHeading, assetType: currentAssetType });
    }

    // Uložení aktuální polohy pro centrování
    currentLng = lng;
    currentLat = lat;
    hasLocation = true;

    // Update UI
    document.getElementById('status').innerText = 'ONLINE';
    document.getElementById('status').style.color = '#00ff00';
    document.getElementById('pos-mgrs').innerText = formatMGRS(lng, lat);
    document.getElementById('pos-speed').innerText = speedKmh > 0 ? displaySpeed : '0';
    document.getElementById('pos-heading').innerText = displayHeading;
    document.getElementById('self-amp-z').innerText = `${speedKmh.toFixed(0)} km/h`;
    document.getElementById('self-amp-h').innerText = `HDG ${displayHeading}`;
    const mgrsEl = document.getElementById('self-amp-mgrs');
    if (mgrsEl) mgrsEl.innerText = formatMGRS(lng, lat);

    // Update Map
    userMarker.setLngLat([lng, lat]);

    // Update Overview Mapy (pokud existuje)
    if (overviewMap) {
        overviewUserMarker.setLngLat([lng, lat]);
        if (!routePreviewReady) {
            overviewMap.setCenter([lng, lat]);
        }
    }

    if (isFirstLocation) {
        map.jumpTo({ center: [lng, lat], zoom: 16 });
        isFirstLocation = false;
        sysLog('Poloha zaměřena.');
    } else if (isNavigating && isTracking) {
        const camera = {
            center: [lng, lat],
            zoom: Math.max(map.getZoom(), 16),
            pitch: 45,
            duration: 250,
            easing: (t) => t
        };

        if (activeHeading !== null) {
            camera.bearing = activeHeading;
        }

        map.easeTo(camera);
    }

    // Taktické natočení mapy jen pokud uživatel mapu zrovna ručně neprohlíží
    if (heading !== null) {
        setActiveHeading(heading, true);
    }

    updateDirectionVectors();
    
    // --- Kontrola dojezdu do cíle ---
    if (isNavigating && currentDestLng !== null && currentDestLat !== null) {
        const distToDest = new maplibregl.LngLat(lng, lat).distanceTo(new maplibregl.LngLat(currentDestLng, currentDestLat));
        if (distToDest < 40) { // Cíl do 40 metrů
            sysLog('Cíl dosažen. Navigace ukončena.', { speak: true, priority: true });
            clearRoute();
            return; // Dál nepočítáme sjetí z trasy
        }
    }

    // --- Kontrola sjetí z trasy (Off-route detection) ---
    if (isNavigating && currentRouteCoords.length > 0) {
        let minMeters = Infinity;
        // Najdeme nejbližší segment trasy
        for (let i = 0; i < currentRouteCoords.length - 1; i++) {
            let d = distToSegmentInMeters([lng, lat], currentRouteCoords[i], currentRouteCoords[i+1]);
            if (d < minMeters) minMeters = d;
        }
        
        if (minMeters > 60) { // Tolerance zvýšena na 60 metrů
            offRouteCounter++;
            if (offRouteCounter >= 3) { // Musí se to potvrdit 3x po sobě
                sysLog(`WARN: Mimo trasu (${Math.round(minMeters)}m). Přepočítávám...`);
                currentRouteCoords = []; // Vymazat, aby se nepřepočítávalo v nekonečné smyčce
                offRouteCounter = 0;
                if (currentDestLng !== null && currentDestLat !== null) {
                    calculateRoute(currentDestLng, currentDestLat, { startNavigationAfterRoute: true });
                }
            }
        } else {
            offRouteCounter = 0; // Jsme zpět na trase, resetujeme počítadlo
        }
    }



    // --- UI a Hlášení Navigace ---
    if (isNavigating) {
        updateNavStepsUI(lng, lat);

        // Najdeme nejbližší budoucí krok na trase pro hlasové hlášení
        let closestStepForAnnounce = null;
        let minDistanceForAnnounce = Infinity;

        for (const step of currentRouteSteps) {
            if (step.passed) continue;
            const maneuverPoint = step.maneuver.location;
            const distance = new maplibregl.LngLat(lng, lat).distanceTo(new maplibregl.LngLat(maneuverPoint[0], maneuverPoint[1]));
            if (distance < minDistanceForAnnounce) {
                minDistanceForAnnounce = distance;
                closestStepForAnnounce = step;
            }
        }

        if (closestStepForAnnounce && minDistanceForAnnounce < 300 && !closestStepForAnnounce.announced) {
            const stepToAnnounce = closestStepForAnnounce;
            const instruction = formatManeuver(stepToAnnounce);
            sysLog(`NAV: ${instruction} (${Math.round(minDistanceForAnnounce)}m)`);
            speak(instruction, true);
            stepToAnnounce.announced = true;
        }
    } else {
        // Pokud nenavigujeme, ale je připravená trasa, aktualizujeme UI
        updateNavStepsUI(lng, lat);
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
        // Obnova Socket.io spojení (BFT), pokud bylo systémem přesto přerušeno
        if (socket && !socket.connected) {
            sysLog('Obnovuji BFT spojení...');
            socket.connect();
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

// Pomocná funkce pro vytvoření APP-6 BFT značky
function createBftMarker(u) {
    const el = document.createElement('div');
    el.className = `app6-marker app6-asset-${u.assetType || 'car'}`;
    el.innerHTML = `
        <div class="app6-direction-vector" style="display: none;"></div>
        <div class="app6-symbol">
            <div class="app6-frame app6-equipment-frame">
                <div class="app6-asset-icon"></div>
            </div>
        </div>
        <div class="app6-amplifiers">
            <div class="app6-amp-left">
                <div class="app6-amp-z">${u.speed || 0} km/h</div>
            </div>
            <div class="app6-amp-right">
                <div class="app6-amp-t">${(u.id || 'BFT').substring(0, 4).toUpperCase()}</div>
                <div class="app6-amp-h">HDG ${u.heading || '--'}</div>
            </div>
            <div class="app6-amp-bottom">
                <div class="app6-amp-y">${formatMGRS(u.lng, u.lat)}</div>
            </div>
        </div>
    `;
    
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([u.lng, u.lat]).addTo(map);
    bftMarkers[u.id] = { marker, el, userData: u };
}

// Centrování mapy (Tlačítko CENTER)
function centerMap() {
    requestCompassAccess();
    if (hasLocation) {
        if (isNavigating) {
            isTracking = true; // Obnovit automatické sledování jen během navigace
        }
        setMobileScreen('map');
        setTimeout(() => focusCurrentPosition(500), 80);
        sysLog(isNavigating ? 'Sledování obnoveno.' : 'Mapa vycentrována.');
    } else {
        sysLog('WARN: Pozice zatím není známa.');
    }
    // Některé prohlížeče vyžadují pro Wake Lock interakci uživatele, zkusíme to i zde
    if (!wakeLock) {
        requestWakeLock();
    }
}

document.getElementById('btn-locate').addEventListener('click', centerMap);
document.getElementById('btn-map-center').addEventListener('click', centerMap);

document.getElementById('btn-compass').addEventListener('click', () => {
    requestCompassAccess();
    if (activeHeading !== null) {
        map.easeTo({ bearing: activeHeading, duration: 160, easing: (t) => t });
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
let customPoiMarkers = []; // Pole pro udržení a čištění značek v mapě

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
    // Vyčištění starých značek z mapy, aby se nehromadily a neprolínally
    customPoiMarkers.forEach(m => m.remove());
    customPoiMarkers = [];

    const poiListEl = document.getElementById('poi-list');
    if (poiListEl) poiListEl.innerHTML = '';

    const pois = JSON.parse(localStorage.getItem('tacnav_pois') || '[]');
    pois.forEach((poi, index) => {
        // 1. Vykreslení do Mapy
        const el = document.createElement('div');
        el.style.width = '12px'; el.style.height = '12px';
        el.style.backgroundColor = '#ffcc00'; el.style.borderRadius = '50%';
        el.style.border = '1px solid #000'; el.title = poi.name;
        
        el.addEventListener('click', (e) => { e.stopPropagation(); calculateRoute(poi.lng, poi.lat); setMobileScreen('map'); });
        const marker = new maplibregl.Marker({ element: el }).setLngLat([poi.lng, poi.lat]).addTo(map);
        customPoiMarkers.push(marker);

        // 2. Vykreslení do Seznamu (Levý panel)
        if (poiListEl) {
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.style.background = 'rgba(0, 50, 0, 0.3)';
            item.style.border = '1px solid #00ff00';
            item.style.padding = '6px';
            
            const nameSpan = document.createElement('span');
            nameSpan.innerText = poi.name;
            nameSpan.style.flex = '1';
            nameSpan.style.overflow = 'hidden';
            nameSpan.style.textOverflow = 'ellipsis';
            nameSpan.style.whiteSpace = 'nowrap';
            nameSpan.style.color = '#ffcc00';
            
            const btnBox = document.createElement('div');
            btnBox.style.display = 'flex';
            btnBox.style.gap = '5px';
            
            const navBtn = document.createElement('button');
            navBtn.innerText = 'NAV';
            navBtn.style.padding = '3px 6px';
            navBtn.onclick = () => {
                calculateRoute(poi.lng, poi.lat);
                setMobileScreen('map');
            };
            
            const delBtn = document.createElement('button');
            delBtn.innerText = 'X';
            delBtn.style.padding = '3px 8px';
            delBtn.style.borderColor = '#ff3333';
            delBtn.style.color = '#ff3333';
            delBtn.onclick = () => {
                if (confirm(`Smazat cíl: ${poi.name}?`)) {
                    pois.splice(index, 1);
                    localStorage.setItem('tacnav_pois', JSON.stringify(pois));
                    renderPOIs();
                }
            };
            
            btnBox.appendChild(navBtn);
            btnBox.appendChild(delBtn);
            
            item.appendChild(nameSpan);
            item.appendChild(btnBox);
            poiListEl.appendChild(item);
        }
    });
}

renderPOIs(); // Vykreslit POI při startu aplikace

// --- Dopravní události (Events / Incidents) ---
const eventMarkers = {};

// Záchyt tlačítka pro uložení aktuální polohy
const btnAddPoi = document.getElementById('btn-add-poi');
if (btnAddPoi) {
    btnAddPoi.addEventListener('click', () => {
        if (!hasLocation || currentLng === null || currentLat === null) {
            sysLog('WARN: Nelze uložit POI, GPS poloha zatím není známa.');
            return;
        }
        const name = prompt("Zadejte název pro aktuální polohu:", "Moje pozice");
        if (name) {
            const pois = JSON.parse(localStorage.getItem('tacnav_pois') || '[]');
            pois.push({ name, lng: currentLng, lat: currentLat });
            localStorage.setItem('tacnav_pois', JSON.stringify(pois));
            sysLog(`POI uloženo: ${name}`);
            renderPOIs();
        }
    });
}

function getMarkerOffsetAndLeaderLine(lng, lat) {
    let overlapCount = 0;
    // Detekce kolizí s již umístěnými značkami v okruhu 100 metrů
    Object.values(eventMarkers).forEach(m => {
        if (new maplibregl.LngLat(lng, lat).distanceTo(m.marker.getLngLat()) < 100) {
            overlapCount++;
        }
    });

    let dx = 0, dy = 0, leaderLineSVG = '';
    if (overlapCount > 0) {
        // Rozmístění překrývajících se značek do vějíře (krok po 45 stupních)
        const angle = (overlapCount * Math.PI / 4) - (Math.PI / 4);
        const distPx = 45 + Math.floor(overlapCount / 8) * 15; // Zvětšení poloměru při mnoha kolizích
        dx = Math.round(distPx * Math.cos(angle));
        dy = Math.round(distPx * Math.sin(angle));
        
        leaderLineSVG = `
            <svg width="0" height="0" style="position: absolute; overflow: visible; pointer-events: none; z-index: -1; left: 0; top: 0;">
                <line x1="0" y1="0" x2="${-dx}" y2="${-dy}" stroke="#ff3333" stroke-width="1.5" stroke-dasharray="4,3"/>
                <circle cx="${-dx}" cy="${-dy}" r="2.5" fill="#ff3333" />
            </svg>
        `;
    }
    return { offset: [dx, dy], leaderLineSVG };
}

async function fetchAndRenderEvents() {
    try {
        const queryParams = (currentLng !== null && currentLat !== null) ? `?lng=${currentLng}&lat=${currentLat}` : '';
        const response = await fetch(`/api/events${queryParams}`);
        const events = await response.json();
        let newEventsCount = 0;

        events.forEach(evt => {
            if (!eventMarkers[evt.id]) {
                newEventsCount++;
                
                // Výpočet případného posunu a vodící čáry
                const { offset, leaderLineSVG } = getMarkerOffsetAndLeaderLine(evt.lng, evt.lat);
                
                const el = document.createElement('div');
                el.id = `evt-${evt.id}`;
                
                let iconText = 'UNK'; // Unknown default
                let iconClass = 'app6-icon-unknown';
                if (evt.type === 'accident') { iconText = 'HAZ'; iconClass = 'app6-icon-hazard'; }
                if (evt.type === 'closure') { iconText = 'OBS'; iconClass = 'app6-icon-obstruction'; }

                el.className = `app6-marker app6-hazard ${iconClass}`;
                el.innerHTML = `
                    ${leaderLineSVG}
                    <div class="app6-symbol">
                        <div class="app6-frame app6-hazard-frame">
                            <div class="app6-asset-icon"></div>
                        </div>
                    </div>
                    <div class="app6-amplifiers">
                        <div class="app6-amp-right">
                            <div class="app6-amp-t">${iconText}</div>
                            <div class="app6-amp-h">${evt.description}</div>
                        </div>
                    </div>
                `;
                
                const marker = new maplibregl.Marker({ element: el, anchor: 'center', offset })
                    .setLngLat([evt.lng, evt.lat])
                    .addTo(map);
                
                eventMarkers[evt.id] = { marker, el, userData: evt };
            }
        });
        
        if (newEventsCount > 0) {
            sysLog(`INTEL: Načteny nové hrozby (${newEventsCount}).`);
        }
    } catch (err) {
        sysLog(`ERR: Stažení událostí selhalo.`);
    }
}

// --- Radary (Nepřátelské senzory z OSM) ---
async function fetchAndRenderRadars() {
    try {
        const queryParams = (currentLng !== null && currentLat !== null) ? `?lng=${currentLng}&lat=${currentLat}` : '';
        const response = await fetch(`/api/radars${queryParams}`);
        const radars = await response.json();
        let newCount = 0;

        radars.forEach(rad => {
            if (!eventMarkers[rad.id]) {
                newCount++;
                
                // Výpočet případného posunu a vodící čáry
                const { offset, leaderLineSVG } = getMarkerOffsetAndLeaderLine(rad.lng, rad.lat);
                
                const el = document.createElement('div');
                el.id = `evt-${rad.id}`;
                
                let iconText = 'SNS';
                let iconClass = 'app6-icon-sensor';
                if (rad.type === 'average_camera') {
                    iconText = 'AVG';
                    iconClass = 'app6-icon-average-camera';
                }
                
                el.className = `app6-marker app6-hazard ${iconClass}`;
                el.innerHTML = `
                    ${leaderLineSVG}
                    <div class="app6-symbol">
                        <div class="app6-frame app6-hazard-frame">
                            <div class="app6-asset-icon"></div>
                        </div>
                    </div>
                    <div class="app6-amplifiers">
                        <div class="app6-amp-right">
                            <div class="app6-amp-t">${iconText}</div>
                            <div class="app6-amp-h">${rad.description}</div>
                        </div>
                    </div>
                `;
                
                const marker = new maplibregl.Marker({ element: el, anchor: 'center', offset })
                    .setLngLat([rad.lng, rad.lat])
                    .addTo(map);
                
                eventMarkers[rad.id] = { marker, el, userData: rad };
            }
        });
        
        if (newCount > 0) {
            sysLog(`INTEL: Zaměřeny nepřátelské senzory (${newCount}).`);
        }
    } catch (err) {
        sysLog(`ERR: Stažení radarů selhalo.`);
    }
}

// --- Týlové body (POI - Čerpací stanice) ---
const poiMarkers = {};
async function fetchAndRenderPOIs() {
    try {
        const queryParams = (currentLng !== null && currentLat !== null) ? `?lng=${currentLng}&lat=${currentLat}` : '';
        const response = await fetch(`/api/pois${queryParams}`);
        const pois = await response.json();

        pois.forEach(poi => {
            if (!poiMarkers[poi.id]) {
                const el = document.createElement('div');
                el.id = `poi-${poi.id}`;
                
                let iconText = 'LOG';
                let frameClass = 'app6-neutral-frame';
                let markerClass = 'app6-neutral app6-icon-fuel';
                
                if (poi.type === 'medical') {
                    iconText = 'MED';
                    markerClass = 'app6-neutral app6-icon-medical';
                } else if (poi.type === 'police') {
                    iconText = 'POL';
                    frameClass = 'app6-hazard-frame';
                    markerClass = 'app6-hazard app6-icon-police';
                }

                el.className = `app6-marker ${markerClass}`;
                el.innerHTML = `
                    <div class="app6-symbol">
                        <div class="${frameClass}">
                            <div class="app6-asset-icon"></div>
                        </div>
                    </div>
                    <div class="app6-amplifiers">
                        <div class="app6-amp-right">
                            <div class="app6-amp-t">${iconText}</div>
                            <div class="app6-amp-h">${poi.description}</div>
                        </div>
                    </div>
                `;
                const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
                    .setLngLat([poi.lng, poi.lat])
                    .addTo(map);
                
                poiMarkers[poi.id] = { marker, el, userData: poi };
            }
        });
    } catch (err) {
        sysLog(`ERR: Stažení týlových bodů selhalo.`);
    }
}

// Stáhnout události chvíli po startu
setTimeout(fetchAndRenderEvents, 2000);
setInterval(fetchAndRenderEvents, 60000); // Aktualizace každou minutu

setTimeout(fetchAndRenderRadars, 3000);
setInterval(fetchAndRenderRadars, 60000 * 5); // Radary stačí aktualizovat jen občas (5 minut)

setTimeout(fetchAndRenderPOIs, 4000);
setInterval(fetchAndRenderPOIs, 60000 * 10);

// --- Audio Engine (TTS a Beepy) ---
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const ttsEnabled = 'speechSynthesis' in window;
let speechQueue = [];
let isSpeaking = false;

// Povolení audia při prvním kliknutí kamkoliv do aplikace (prohlížeče blokují autoplay)
document.body.addEventListener('click', () => {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            sysLog('Audio systém aktivován.');
        });
    }
}, { once: true });

function playBeep(type = 'notice') {
    if (!audioContext || audioContext.state !== 'running') return;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    if (type === 'alert') {
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.3);
    } else {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.2);
    }
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.4);
}

function processSpeechQueue() {
    if (isSpeaking || speechQueue.length === 0 || !ttsEnabled) return;
    isSpeaking = true;
    const textToSpeak = speechQueue.shift();
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = 'cs-CZ';
    utterance.rate = 1.2;
    utterance.onend = () => {
        isSpeaking = false;
        setTimeout(processSpeechQueue, 150);
    };
    utterance.onerror = () => {
        isSpeaking = false;
        processSpeechQueue();
    };
    window.speechSynthesis.speak(utterance);
}

function speak(text, priority = false) {
    if (!ttsEnabled) {
        playBeep(priority ? 'alert' : 'notice');
        return;
    }
    if (priority) {
        window.speechSynthesis.cancel();
        isSpeaking = false;
        speechQueue.unshift(text);
    } else {
        speechQueue.push(text);
    }
    processSpeechQueue();
}

function getManeuverIcon(step) {
    const type = step.maneuver.type;
    const modifier = step.maneuver.modifier || '';
    
    if (type === 'arrive') return '🏁';
    if (modifier.includes('straight')) return '↑';
    if (modifier.includes('slight right')) return '↗';
    if (modifier.includes('right')) return '→';
    if (modifier.includes('sharp right')) return '↘';
    if (modifier.includes('slight left')) return '↖';
    if (modifier.includes('left')) return '←';
    if (modifier.includes('sharp left')) return '↙';
    if (type === 'roundabout') return '🔄';
    
    return '•';
}

function updateNavStepsUI(lng, lat) {
    const navStepsEl = document.getElementById('nav-steps');
    const overviewInfoEl = document.getElementById('overview-info');

    if (!routePreviewReady || currentRouteSteps.length === 0) {
        navStepsEl.classList.remove('visible');
        if (overviewInfoEl) overviewInfoEl.classList.remove('visible');
        return;
    }

    const upcomingSteps = [];
    let totalRemainingDist = 0;
    let totalRemainingDur = 0;

    for (const step of currentRouteSteps) {
        if (step.passed) continue;

        const maneuverPoint = step.maneuver.location;
        const distance = (lng && lat) 
            ? new maplibregl.LngLat(lng, lat).distanceTo(new maplibregl.LngLat(maneuverPoint[0], maneuverPoint[1]))
            : step.distance;
        
        upcomingSteps.push({
            distance,
            instruction: formatManeuver(step),
            iconText: getManeuverIcon(step),
            isManeuver: true,
            color: '#ffcc00'
        });

        totalRemainingDist += step.distance;
        totalRemainingDur += step.duration;
    }

    // Integrace značek hrozeb a POI přímo do itineráře manévrů
    const allMarkers = [ ...Object.values(eventMarkers), ...Object.values(poiMarkers) ];
    allMarkers.forEach(m => {
        if (!m.userData) return;
        const dist = (lng && lat) ? new maplibregl.LngLat(lng, lat).distanceTo(m.marker.getLngLat()) : 999999;
        
        // Ukaž značky mezi 100 metry a 5 km, pokud jsou před námi
        if (dist > 100 && dist < 5000) {
            let isAhead = true;
            if (lng !== null && lat !== null && activeHeading !== null) {
                const dx = m.marker.getLngLat().lng - lng;
                const dy = m.marker.getLngLat().lat - lat;
                let angleDeg = Math.atan2(dx, dy) * (180 / Math.PI);
                if (angleDeg < 0) angleDeg += 360;
                isAhead = headingDelta(activeHeading, angleDeg) < 80; // V zorném poli 160 stupňů před námi
            }

            if (isAhead) {
                let iconClass = 'app6-icon-unknown';
                let color = '#00ff00';

                if (['accident', 'closure', 'radar', 'average_camera', 'police'].includes(m.userData.type)) {
                    color = '#ff3333';
                }

                if (m.userData.type === 'accident') iconClass = 'app6-icon-hazard';
                else if (m.userData.type === 'closure') iconClass = 'app6-icon-obstruction';
                else if (m.userData.type === 'radar') iconClass = 'app6-icon-sensor';
                else if (m.userData.type === 'average_camera') iconClass = 'app6-icon-average-camera';
                else if (m.userData.type === 'fuel') iconClass = 'app6-icon-fuel';
                else if (m.userData.type === 'medical') iconClass = 'app6-icon-medical';
                else if (m.userData.type === 'police') iconClass = 'app6-icon-police';

                upcomingSteps.push({
                    distance: dist,
                    instruction: m.userData.description,
                    iconClass: iconClass,
                    isManeuver: false,
                    color: color
                });
            }
        }
    });

    // Seřadit vše chronologicky podle vzdálenosti
    upcomingSteps.sort((a, b) => a.distance - b.distance);

    if (overviewInfoEl && upcomingSteps.length > 0) {
        const activeStep = currentRouteSteps.find(s => !s.passed);
        if (activeStep) {
            // Korigování celkové vzdálenosti o už ujetou část aktuálního kroku
            totalRemainingDist = totalRemainingDist - activeStep.distance + upcomingSteps[0].distance;
            if (activeStep.distance > 0) {
                const ratio = upcomingSteps[0].distance / activeStep.distance;
                totalRemainingDur = totalRemainingDur - activeStep.duration + (activeStep.duration * ratio);
            }
        }
        
        document.getElementById('overview-dist').innerText = (totalRemainingDist / 1000).toFixed(1) + ' km';
        document.getElementById('overview-eta').innerText = Math.round(totalRemainingDur / 60) + ' min';
        overviewInfoEl.classList.add('visible');
    } else if (overviewInfoEl) {
        overviewInfoEl.classList.remove('visible');
    }

    let stepsToShow = [];
    if (window.innerWidth >= 768) {
        // Výpočet počtu manévrů: cca 60px na krok, maximálně do 1/3 výšky obrazovky
        const maxSteps = Math.max(3, Math.floor((window.innerHeight / 3) / 60));
        stepsToShow = upcomingSteps.slice(0, maxSteps);
    } else if (upcomingSteps.length > 0) {
        stepsToShow.push(upcomingSteps[0]);
        // Pokud je první zobrazená položka upozornění, přidáme i nejbližší fyzický manévr
        if (!upcomingSteps[0].isManeuver) {
            const firstManeuver = upcomingSteps.find(s => s.isManeuver);
            if (firstManeuver) stepsToShow.push(firstManeuver);
        }
    }

    navStepsEl.innerHTML = stepsToShow.map(step => `
        <div class="nav-step">
            <div class="nav-step-icon-box ${step.iconClass || ''}" style="color: ${step.color}; border-color: ${step.color};">
                ${step.isManeuver ? 
                    `<span class="nav-step-text-icon">${step.iconText}</span>` : 
                    `<div class="app6-asset-icon" style="position:relative; transform:none; left:auto; top:auto; width:22px; height:22px;"></div>`
                }
            </div>
            <div class="nav-step-info">
                <div class="nav-step-distance">${step.distance < 1000 ? Math.round(step.distance / 10) * 10 + ' m' : (step.distance / 1000).toFixed(1) + ' km'}</div>
                <div class="nav-step-instruction" style="color: ${step.color};">${step.instruction}</div>
            </div>
        </div>
    `).join('');

    navStepsEl.classList.add('visible');
}

function formatManeuver(step) {
    const type = step.maneuver.type;
    const modifier = step.maneuver.modifier || '';
    let instruction = '';
    switch (type) {
        case 'turn': case 'fork': case 'off ramp': case 'on ramp':
            if (modifier.includes('left')) instruction = 'Odbočte vlevo';
            else if (modifier.includes('right')) instruction = 'Odbočte vpravo';
            else if (modifier.includes('straight')) instruction = 'Jeďte rovně';
            break;
        case 'roundabout':
            instruction = `Na kruhovém objezdu sjeďte ${step.maneuver.exit || 1}. výjezdem`;
            break;
        case 'depart': instruction = `Vyjeďte směr ${step.name}`; break;
        case 'arrive': instruction = 'Dorazili jste do cíle.'; break;
    }
    return instruction;
}

// --- Proximity Alert System ---
const alertedEvents = new Set();
const PROXIMITY_ALERT_DISTANCE_METERS = 350;

function checkProximity() {
    if (!hasLocation || !isNavigating) return;

    Object.values(eventMarkers).forEach(threat => {
        const threatId = threat.marker.getElement().id;
        if (!threatId || alertedEvents.has(threatId)) return;

        const distance = new maplibregl.LngLat(currentLng, currentLat).distanceTo(threat.marker.getLngLat());
        if (distance < PROXIMITY_ALERT_DISTANCE_METERS) {
            const description = threat.marker.getElement().querySelector('.app6-amp-h')?.innerText || 'hrozba';
            sysLog(`ALERT: ${description} (${Math.round(distance)}m)`, { speak: true, priority: true });
            alertedEvents.add(threatId);
        }
    });
}
setInterval(checkProximity, 2500);

// --- UI Toggles ---

document.getElementById('btn-start-nav').addEventListener('click', startNavigation);
document.getElementById('btn-stop-nav').addEventListener('click', stopNavigation);
if (document.getElementById('btn-clear-route')) {
    document.getElementById('btn-clear-route').addEventListener('click', clearRoute);
}

const assetTypeSelect = document.getElementById('asset-type');
if (!isAdminView) {
    assetTypeSelect.querySelectorAll('[data-admin-only]').forEach((option) => option.remove());
}
setAssetType(currentAssetType);
assetTypeSelect.value = currentAssetType;
assetTypeSelect.addEventListener('change', (e) => {
    setAssetType(e.target.value);
    e.target.value = currentAssetType;
});

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

const topLeftContainer = document.createElement('div');
topLeftContainer.id = 'top-left-ui';
topLeftContainer.style.marginTop = '50px'; // Posun kvůli záhlaví
appContainer.insertBefore(topLeftContainer, appContainer.firstChild);

const navStepsEl = document.createElement('div');
navStepsEl.id = 'nav-steps';
topLeftContainer.appendChild(navStepsEl);

// Přesunout existující sys-log do nového kontejneru
if (sysLogEl) {
    topLeftContainer.appendChild(sysLogEl);
}

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

// --- ZÁHLAVÍ (Header) ---
const headerEl = document.createElement('div');
headerEl.id = 'tac-header';
headerEl.style.cssText = 'position:absolute; top:0; left:0; right:0; height:45px; background:rgba(0,0,0,0.85); color:#0f0; display:flex; justify-content:space-between; align-items:center; padding:0 15px; font-family:monospace; z-index:1000; border-bottom:1px solid rgba(0,255,0,0.3); font-size:12px; pointer-events:none;';
headerEl.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:2px;">
        <div id="header-start">START: N/A</div>
        <div id="header-dest">CÍL: N/A</div>
    </div>
    <div style="text-align:right; border-left:1px solid rgba(0,255,0,0.3); padding-left:15px; display:flex; flex-direction:column; gap:2px;">
        <div id="header-time" style="font-size:14px; font-weight:bold;">--:--:--</div>
        <div id="header-date">--.--.----</div>
    </div>
`;
appContainer.insertBefore(headerEl, appContainer.firstChild);

setInterval(() => {
    const now = new Date();
    const timeEl = document.getElementById('header-time');
    const dateEl = document.getElementById('header-date');
    if (timeEl) timeEl.innerText = now.toLocaleTimeString('cs-CZ');
    if (dateEl) dateEl.innerText = now.toLocaleDateString('cs-CZ');
}, 1000);

function updateHeaderInfo(startCoords, destCoords) {
    const startStr = startCoords ? formatMGRS(startCoords.lng, startCoords.lat) : 'N/A';
    const destStr = destCoords ? formatMGRS(destCoords.lng, destCoords.lat) : 'N/A';
    document.getElementById('header-start').innerText = `START: ${startStr}`;
    document.getElementById('header-dest').innerText = `CÍL: ${destStr}`;
}

// --- VÝŠKOVÝ PROFIL A UDÁLOSTI (Spodní panel) ---
const profileContainer = document.createElement('div');
profileContainer.id = 'elevation-profile';
profileContainer.style.cssText = 'position:absolute; bottom:0; left:0; right:0; height:80px; background:rgba(0,0,0,0.85); border-top:1px solid rgba(0,255,0,0.3); z-index:1000; display:none; padding:5px 10px; pointer-events:none;';
profileContainer.innerHTML = `
    <div style="font-size:10px; color:#0f0; margin-bottom:2px; font-family:monospace;">PROFIL TRASY & INTEL</div>
    <canvas id="elevation-canvas" style="width:100%; height:55px; display:block;"></canvas>
`;
appContainer.appendChild(profileContainer);

function renderElevationProfile() {
    const profileCont = document.getElementById('elevation-profile');
    const canvas = document.getElementById('elevation-canvas');
    if (!profileCont || !canvas || !availableRoutes[activeRouteIndex]) {
        if (profileCont) profileCont.style.display = 'none';
        return;
    }

    profileCont.style.display = 'block';
    const ctx = canvas.getContext('2d');
    
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    const route = availableRoutes[activeRouteIndex];
    const totalDist = route.distance;
    
    // Nakreslení "mock" výškového profilu (Generované křivky)
    // OSRM neposkytuje plná 3D data, nahradíme je vizualizací vln terénu
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i <= w; i += 5) {
        const progress = i / w;
        const noise = Math.sin(progress * 10) * 10 + Math.cos(progress * 25) * 5;
        ctx.lineTo(i, (h / 2) + noise);
    }
    ctx.lineTo(w, h);
    ctx.fillStyle = 'rgba(0, 255, 0, 0.15)';
    ctx.fill();
    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Značky hrozeb a POI na časové ose
    const allMarkers = [ ...Object.values(eventMarkers), ...Object.values(poiMarkers) ];
    allMarkers.forEach(m => {
        if (!m.userData || currentRouteCoords.length === 0) return;
        
        let minMeters = Infinity;
        let totalMetersToPoint = 0;
        let accDist = 0;
        
        for (let i = 0; i < currentRouteCoords.length - 1; i++) {
            const segLen = new maplibregl.LngLat(currentRouteCoords[i][0], currentRouteCoords[i][1])
                            .distanceTo(new maplibregl.LngLat(currentRouteCoords[i+1][0], currentRouteCoords[i+1][1]));
                            
            const d = distToSegmentInMeters([m.userData.lng, m.userData.lat], currentRouteCoords[i], currentRouteCoords[i+1]);
            if (d < minMeters) {
                minMeters = d;
                totalMetersToPoint = accDist + (segLen / 2);
            }
            accDist += segLen;
        }

        // Pokud je událost poblíž naší naplánované trasy (do 500m okruhu)
        if (minMeters < 500 && totalDist > 0) {
            const xPos = (totalMetersToPoint / totalDist) * w;
            let color = '#0f0';
            if (['accident', 'closure', 'radar', 'average_camera', 'police'].includes(m.userData.type)) color = '#ff3333';
            else if (m.userData.type === 'fuel' || m.userData.type === 'medical') color = '#ffcc00';

            ctx.beginPath();
            ctx.moveTo(xPos, 0);
            ctx.lineTo(xPos, h);
            ctx.strokeStyle = color;
            ctx.setLineDash([2, 2]);
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);
            
            ctx.beginPath();
            ctx.arc(xPos, 10, 4, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        }
    });
}

// --- VÝBĚR ALTERNATIVNÍCH TRAS ---
function renderAlternativesUI() {
    let altsContainer = document.getElementById('route-alternatives');
    let altsBtn = document.getElementById('btn-map-alts');
    
    if (!altsContainer || !altsBtn || availableRoutes.length <= 1) {
        if (altsBtn) altsBtn.style.display = 'none';
        return;
    }

    altsBtn.style.display = 'flex';
    altsContainer.innerHTML = `<div style="color:#0f0; font-weight:bold; font-size:12px; font-family:monospace;">ALT TRASY:</div>`;
    
    availableRoutes.forEach((route, index) => {
        const dist = (route.distance / 1000).toFixed(1);
        const eta = Math.round(route.duration / 60);
        const isSelected = index === activeRouteIndex;
        
        const btn = document.createElement('div');
        btn.style.cssText = `padding:8px; border:1px solid ${isSelected ? '#0f0' : '#555'}; background:${isSelected ? 'rgba(0,255,0,0.15)' : 'transparent'}; cursor:pointer; font-size:12px; font-family:monospace; color:${isSelected ? '#0f0' : '#aaa'}; margin-top: 8px; border-radius: 2px;`;
        
        let summary = route.legs?.[0]?.summary || `Trasa ${index + 1}`;
        btn.innerHTML = `<strong>${summary}</strong><br/>Vzdálenost: ${dist} km | Čas: ${eta} min`;
        
        btn.onclick = async () => {
            activeRouteIndex = index;
            altsContainer.style.display = 'none'; // Schovat okno ihned po výběru
            await applySelectedRoute();
            renderAlternativesUI();
        };
        altsContainer.appendChild(btn);
    });
}

document.getElementById('btn-map-alts').addEventListener('click', () => {
    const panel = document.getElementById('route-alternatives');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});

// --- Service Worker Registrace (Offline podpora & PWA) ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                sysLog(`SYS: Service Worker aktivní. Mapy se cachují pro offline režim.`);
            }).catch(err => {
                sysLog(`ERR: Service Worker selhal (${err.message})`);
            });
    });
}
