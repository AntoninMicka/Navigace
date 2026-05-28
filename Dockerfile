# Použijeme lehký a aktuální image pro Node.js
FROM node:20-alpine

# Pracovní adresář uvnitř kontejneru
WORKDIR /app

# Nejdříve zkopírujeme definice závislostí a nainstalujeme je
COPY package*.json ./
RUN npm install --production

# Zkopírujeme zbytek aplikace (zdrojové kódy, HTML, styly)
COPY . .

# Zpřístupníme port (Cloud Run obvykle dává 8080, lokálně Docker ukáže tento port)
EXPOSE 8080

# Startovací příkaz aplikace
CMD ["node", "server.js"]