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