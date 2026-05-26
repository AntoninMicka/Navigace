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

// Geolocation API
if ('geolocation' in navigator) {
    sysLog('GPS senzor detekován.');
    navigator.geolocation.watchPosition(
        (position) => {
            const coords = position.coords;
            const lng = coords.longitude;
            const lat = coords.latitude;
            const speed = (coords.speed * 3.6).toFixed(1) || 0; // m/s na km/h
            const heading = coords.heading ? coords.heading.toFixed(0) : '--';

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
        },
        (error) => {
            sysLog(`Chyba GPS: ${error.message}`);
            document.getElementById('status').innerText = 'GPS LOST';
            document.getElementById('status').style.color = 'red';
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000
        }
    );
} else {
    sysLog('ERR: Zařízení nemá GPS.');
}

// Centrování mapy (Tlačítko CENTER)
document.getElementById('btn-locate').addEventListener('click', () => {
    if (hasLocation) {
        map.flyTo({ center: [currentLng, currentLat], zoom: 16, duration: 1500 });
        sysLog('Mapa centrována na vlastní polohu.');
    } else {
        sysLog('WARN: Pozice zatím není známa.');
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