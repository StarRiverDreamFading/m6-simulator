// server.js
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const TRIP_FILE = path.join(DATA_DIR, 'trips.json');
const EVENT_FILE = path.join(DATA_DIR, 'events.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return fallback; }
};
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

const VEHICLE_CONFIG = {
    model: '问界M6 纯电Max+ 二驱',
    price: 249800,
    motor: '后置单电机',
    power: 227,
    torque: 320,
    accel: 7.5,
    battery: 81,
    range: 630,
    size: { length: 4960, width: 1985, height: 1736, wheelbase: 2950 },
    suspension: '空气悬架 + CDC',
    lidar: '896线激光雷达',
    maxSpeed: 200,
    seats: ['主驾', '副驾', '后排']
};

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => res.json(VEHICLE_CONFIG));

let latestTelemetry = null;
app.post('/api/telemetry', (req, res) => {
    latestTelemetry = { ...req.body, serverTime: Date.now() };
    res.json({ ok: true });
});
app.get('/api/telemetry', (req, res) => res.json(latestTelemetry || {}));

app.post('/api/trips', (req, res) => {
    const trips = readJson(TRIP_FILE, []);
    const trip = { id: Date.now().toString(36), createdAt: new Date().toISOString(), ...req.body };
    trips.unshift(trip);
    if (trips.length > 100) trips.length = 100;
    writeJson(TRIP_FILE, trips);
    res.json({ ok: true, trip });
});
app.get('/api/trips', (req, res) => res.json(readJson(TRIP_FILE, [])));

app.post('/api/events', (req, res) => {
    const events = readJson(EVENT_FILE, []);
    const evt = { id: Date.now().toString(36), createdAt: new Date().toISOString(), ...req.body };
    events.unshift(evt);
    if (events.length > 200) events.length = 200;
    writeJson(EVENT_FILE, events);
    res.json({ ok: true, evt });
});
app.get('/api/events', (req, res) => res.json(readJson(EVENT_FILE, [])));

wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'welcome', message: 'M6 车联网服务已连接', config: VEHICLE_CONFIG }));
    const timer = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
                type: 'remote',
                serverTime: Date.now(),
                traffic: {
                    onlineVehicles: 1200 + Math.floor(Math.random() * 300),
                    avgSpeed: 40 + Math.round(Math.random() * 30)
                }
            }));
        }
    }, 3000);
    ws.on('close', () => clearInterval(timer));
});

server.listen(PORT, () => console.log(`问界M6 3D模拟器: http://localhost:${PORT}`));