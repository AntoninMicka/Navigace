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
userEl.style.width = '15px';
userEl.style.height = '15px';
userEl.style.backgroundColor = '#00ff00';
userEl.style.borderRadius = '50%';
userEl.style.boxShadow = '0 0 10px #00ff00';
userEl.style.border = '2px solid #fff';

const userMarker = new maplibregl.Marker({ element: userEl })
    .setLngLat([0, 0])
    .addTo(map);

let isFirstLocation = true;
let currentLng = null;
let currentLat = null;
let hasLocation = false;

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

// --- Výpočet trasy (Routing API - OSRM) ---
async function calculateRoute(destLng, destLat) {
    if (!currentLng || !currentLat) {
        sysLog('WARN: Nelze vypočítat trasu, chybí vlastní poloha.');
        return;
    }
    try {
        sysLog('Vyžaduji taktickou trasu...');
        // Dotaz na veřejný OSRM server pro navigaci aut
        const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${currentLng},${currentLat};${destLng},${destLat}?overview=full&geometries=geojson`);
        const data = await response.json();
        
        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const geojson = { type: 'Feature', properties: {}, geometry: route.geometry };
            
            if (map.getSource('route')) {
                map.getSource('route').setData(geojson);
            } else {
                map.addSource('route', { type: 'geojson', data: geojson });
                map.addLayer({
                    id: 'route',
                    type: 'line',
                    source: 'route',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': '#00ff00', 'line-width': 5, 'line-opacity': 0.7 }
                }, 'waterway-name'); // Vykreslit pod texty
            }
            
            sysLog(`Trasa nalezena: ${(route.distance / 1000).toFixed(1)} km, ETA: ${Math.round(route.duration / 60)} min.`);
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
    document.getElementById('pos-lat').innerText = lat.toFixed(5);
    document.getElementById('pos-lon').innerText = lng.toFixed(5);
    document.getElementById('pos-speed').innerText = speed > 0 ? speed : '0';
    document.getElementById('pos-heading').innerText = displayHeading;

    // Update Map
    userMarker.setLngLat([lng, lat]);

    // Update Overview Mapy (pokud existuje)
    if (overviewMap) {
        overviewMap.setCenter([lng, lat]);
        overviewUserMarker.setLngLat([lng, lat]);
    }

    if (isFirstLocation) {
        map.jumpTo({ center: [lng, lat], zoom: 16 });
        isFirstLocation = false;
        sysLog('Poloha zaměřena.');
    } else {
        map.panTo([lng, lat], { duration: 1000 });
    }

    // Taktické natočení mapy podle směru jízdy / kompasu (jen pokud není uživatel v overview režimu)
    if (heading !== null && map.getPitch() > 0) {
        map.easeTo({ bearing: heading, duration: 1000 });
    }
}

// Funkce pro zpracování chyby GPS
function handlePositionError(error) {
    sysLog(`Chyba GPS: ${error.message}`);
    document.getElementById('status').innerText = 'GPS LOST';
    document.getElementById('status').style.color = 'red';
}

const geoOptions = {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 5000
};

// Geolocation API
if ('geolocation' in navigator) {
    sysLog('GPS senzor detekován.');
    navigator.geolocation.watchPosition(handlePositionSuccess, handlePositionError, geoOptions);
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
        // Vynutit okamžitou aktualizaci polohy po probuzení
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(handlePositionSuccess, handlePositionError, geoOptions);
        }
    }
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
        map.flyTo({ center: [currentLng, currentLat], zoom: 16, pitch: 45, duration: 1500 });
        sysLog('Mapa centrována na vlastní polohu.');
    } else {
        sysLog('WARN: Pozice zatím není známa.');
    }
    // Některé prohlížeče vyžadují pro Wake Lock interakci uživatele, zkusíme to i zde
    if (!wakeLock) {
        requestWakeLock();
    }
});

// Přepnutí do overview režimu při manuálním pohybu mapou
map.on('dragstart', () => {
    map.easeTo({ pitch: 0, duration: 500 });
});

// Zachycení kliknutí na mapu pro navigaci
map.on('click', (e) => {
    calculateRoute(e.lngLat.lng, e.lngLat.lat);
});

// --- UI Toggles ---

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