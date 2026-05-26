// Inicializace mapy (používáme volný tmavý styl od CartoDB pro PoC)
const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json', // Tmavý vektorový styl
    center: [15.473, 49.817], // Střed ČR
    zoom: 7,
    pitch: 45, // Taktický náklon 3D
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

// Logovací funkce do panelu
function sysLog(msg) {
    const log = document.getElementById('sys-log');
    log.innerHTML = `<p>[SYS] ${msg}</p>` + log.innerHTML;
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

// Funkce pro zpracování úspěšného získání polohy
function handlePositionSuccess(position) {
    const coords = position.coords;
    const lng = coords.longitude;
    const lat = coords.latitude;
    const speed = (coords.speed * 3.6).toFixed(1) || 0; // m/s na km/h
    const heading = coords.heading ? coords.heading.toFixed(0) : '--';

    // Odeslání polohy na BFT server
    if (socket) {
        socket.emit('position_update', { lat, lng, speed, heading });
    }

    // Uložení aktuální polohy pro centrování
    currentLng = lng;
    currentLat = lat;
    hasLocation = true;

    // Update UI
    document.getElementById('pos-lat').innerText = lat.toFixed(5);
    document.getElementById('pos-lon').innerText = lng.toFixed(5);
    document.getElementById('pos-speed').innerText = speed > 0 ? speed : '0';
    document.getElementById('pos-heading').innerText = heading;

    // Update Map
    userMarker.setLngLat([lng, lat]);

    if (isFirstLocation) {
        map.jumpTo({ center: [lng, lat], zoom: 16 });
        isFirstLocation = false;
        sysLog('Poloha zaměřena.');
    } else {
        map.panTo([lng, lat], { duration: 1000 });
    }

    // Taktické natočení mapy podle směru jízdy
    if (coords.heading && coords.speed > 1) {
        map.easeTo({ bearing: coords.heading, duration: 1000 });
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
        map.flyTo({ center: [currentLng, currentLat], zoom: 16, duration: 1500 });
        sysLog('Mapa centrována na vlastní polohu.');
    } else {
        sysLog('WARN: Pozice zatím není známa.');
    }
    // Některé prohlížeče vyžadují pro Wake Lock interakci uživatele, zkusíme to i zde
    if (!wakeLock) {
        requestWakeLock();
    }
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