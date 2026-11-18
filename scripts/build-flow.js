'use strict';
// Generates flows/alert-flow.json — a sanitized, importable Node-RED flow.
// All hosts, tokens and channel IDs come from environment variables.

const fs = require('fs');
const path = require('path');

const TAB = 'tab_iot_alerts';

const registryInit = `// Device registry — replace with your own devices (or load from a database / API).
flow.set('registry', [
    { uuid: 'demo-01', name: 'Demo Breaker 01', docUrl: 'https://example.com/docs/demo-01', dashboardUrl: 'https://grafana.example.com/d/demo?var-device=demo-01' },
    { uuid: 'demo-02', name: 'Demo Breaker 02', docUrl: 'https://example.com/docs/demo-02', dashboardUrl: 'https://grafana.example.com/d/demo?var-device=demo-02' },
    { uuid: 'demo-03', name: 'Demo Breaker 03 (3-phase)', docUrl: '', dashboardUrl: '' }
]);
// Alerts the team has silenced, e.g. { uuid: 'demo-02', fault: 'OFFLINE' }
flow.set('muted', []);`;

const checkFault = `// Runs on every MQTT message: record last-seen time, then check for a fault.
const FAULT_CODES = { 1: 'ARC', 2: 'LEAKAGE CURRENT', 4: 'UNDER VOLTAGE', 8: 'OVER VOLTAGE',
    16: 'OVER CURRENT', 32: 'SHORT CIRCUIT', 64: 'OVER TEMP', 128: 'EARTHQUAKE',
    65: 'SEND ORDER SC ALARM', 67: 'SEND ORDER ARC ALARM' };
const NON_STATUS = [61, 62, 63, 67];
const COOLDOWN = 10 * 60 * 1000;

const uuid = msg.topic.split('/')[1];
const data = msg.payload;
const now = Date.now();
const registry = flow.get('registry') || [];
const device = registry.find(d => d.uuid === uuid);
if (!device) return null;                       // not one of ours

const lastSeen = flow.get('lastSeen') || {};
lastSeen[uuid] = now;
flow.set('lastSeen', lastSeen);

if (data[0] !== 100 || NON_STATUS.includes(data[1]) || !data[13]) return null;

const code = data[13];
const fault = code === 14 ? 'FAULT TRIP (14, ' + data[14] + ')' : (FAULT_CODES[code] || 'UNKNOWN (' + code + ')');

const muted = flow.get('muted') || [];
if (muted.some(m => m.uuid === uuid && m.fault === fault)) return null;

const lastAlert = flow.get('lastAlert') || {};
const prev = lastAlert[uuid];
if (prev && prev.fault === fault && now - prev.at < COOLDOWN) return null;   // same fault, still cooling down

lastAlert[uuid] = { at: now, fault: fault };
flow.set('lastAlert', lastAlert);

msg.channel = env.get('DISCORD_CHANNEL_ID');
msg.payload = [
    '### 📍 ' + env.get('PROJECT_NAME'),
    '**📌 Device:** ' + device.name,
    '**🔌 UUID:** ' + uuid,
    '**⚠️ Fault:** ' + fault,
    '**🔗 Docs:** ' + (device.docUrl || 'N/A'),
    '**📊 Dashboard:** ' + (device.dashboardUrl || 'N/A')
].join('\\n');
return msg;`;

const checkOffline = `// Runs every 10 minutes: report devices that have gone quiet.
const THRESHOLD = 10 * 60 * 1000;
const COOLDOWN = 10 * 60 * 1000;
const now = Date.now();
const registry = flow.get('registry') || [];
const lastSeen = flow.get('lastSeen') || {};
const lastNotified = flow.get('lastOfflineAlert') || {};
const muted = flow.get('muted') || [];

const offline = registry.filter(d =>
    now - (lastSeen[d.uuid] || 0) > THRESHOLD &&
    !muted.some(m => m.uuid === d.uuid && m.fault === 'OFFLINE') &&
    now - (lastNotified[d.uuid] || 0) >= COOLDOWN
);
if (offline.length === 0) return null;

offline.forEach(d => { lastNotified[d.uuid] = now; });
flow.set('lastOfflineAlert', lastNotified);

let text = '### 📍 ' + env.get('PROJECT_NAME') + ' — OFFLINE\\n' + offline.map(d => [
    '====================',
    '📍 **' + d.name + '**',
    '🔑 UUID: ' + d.uuid,
    '📊 Dashboard: ' + (d.dashboardUrl || 'N/A')
].join('\\n')).join('\\n');
if (text.length > 2000) text = text.slice(0, 1990) + '\\n…';     // Discord message limit

msg.channel = env.get('DISCORD_CHANNEL_ID');
msg.payload = text;
return msg;`;

const simulate = `// Test helper: publishes a fake fault from a random demo device.
const registry = flow.get('registry') || [];
const codes = [1, 2, 4, 8, 16, 32, 64];
const device = registry[Math.floor(Math.random() * registry.length)];
const data = new Array(32).fill(0);
data[0] = 100;
data[1] = 1;
data[13] = codes[Math.floor(Math.random() * codes.length)];
msg.topic = 'devices/' + device.uuid + '/messages/events/';
msg.payload = Buffer.from(data);
return msg;`;

const fn = (id, name, func, x, y, wires, initialize = '') => ({
  id, type: 'function', z: TAB, name, func, outputs: 1, timeout: 0, noerr: 0,
  initialize, finalize: '', libs: [], x, y, wires: [wires],
});

const flow = [
  {
    id: TAB, type: 'tab', label: 'IoT Device Alerts', disabled: false,
    info: 'Fault and offline alerts for MQTT-connected circuit breakers → Discord.\nConfigure with env vars: MQTT_HOST, MQTT_PORT, DISCORD_CHANNEL_ID, PROJECT_NAME.',
    env: [
      { name: 'PROJECT_NAME', value: 'DEMO PROJECT', type: 'str' },
      { name: 'DISCORD_CHANNEL_ID', value: 'DISCORD_CHANNEL_ID', type: 'env' },
    ],
  },
  { id: 'c_fault', type: 'comment', z: TAB, name: 'Fault alerts (real time)', info: '', x: 150, y: 60, wires: [] },
  {
    id: 'mqtt_in', type: 'mqtt in', z: TAB, name: 'Device events', topic: 'devices/+/messages/events/',
    qos: '1', datatype: 'buffer', broker: 'broker', nl: false, rap: true, rh: 0, inputs: 0, x: 150, y: 120, wires: [['fn_fault']],
  },
  fn('fn_fault', 'Check fault', checkFault, 380, 120, ['discord', 'debug_out'], registryInit),
  { id: 'c_offline', type: 'comment', z: TAB, name: 'Offline check (every 10 min)', info: '', x: 160, y: 200, wires: [] },
  {
    id: 'tick', type: 'inject', z: TAB, name: 'Every 10 min', props: [{ p: 'payload' }], repeat: '600',
    crontab: '', once: true, onceDelay: '60', topic: '', payload: '', payloadType: 'date', x: 150, y: 260, wires: [['fn_offline']],
  },
  fn('fn_offline', 'Check offline', checkOffline, 380, 260, ['discord', 'debug_out']),
  { id: 'c_test', type: 'comment', z: TAB, name: 'Test: send a simulated fault', info: '', x: 160, y: 340, wires: [] },
  {
    id: 'test_btn', type: 'inject', z: TAB, name: 'Simulate fault', props: [{ p: 'payload' }], repeat: '',
    crontab: '', once: false, onceDelay: 0.1, topic: '', payload: '', payloadType: 'date', x: 150, y: 400, wires: [['fn_sim']],
  },
  fn('fn_sim', 'Fake device message', simulate, 380, 400, ['mqtt_out']),
  {
    id: 'mqtt_out', type: 'mqtt out', z: TAB, name: 'Publish test frame', topic: '', qos: '0', retain: 'false',
    broker: 'broker', x: 620, y: 400, wires: [],
  },
  {
    id: 'discord', type: 'discordSendMessage', z: TAB, name: 'Discord',
    channel: '', token: '', x: 640, y: 160, wires: [],
  },
  {
    id: 'debug_out', type: 'debug', z: TAB, name: 'Alert text', active: true, tosidebar: true, console: false,
    tostatus: false, complete: 'payload', targetType: 'msg', x: 650, y: 220, wires: [],
  },
  {
    id: 'broker', type: 'mqtt-broker', name: 'Device broker', broker: '${MQTT_HOST}', port: '${MQTT_PORT}',
    clientid: '', autoConnect: true, usetls: false, protocolVersion: '4', keepalive: '60', cleansession: true,
  },
];

const out = path.join(__dirname, '..', 'flows', 'alert-flow.json');
fs.writeFileSync(out, JSON.stringify(flow, null, 2) + '\n');
console.log('wrote', out);
