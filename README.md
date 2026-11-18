# IoT Device Alert Automation

Real-time **fault** and **offline** alerts for MQTT-connected smart circuit breakers, delivered to a Discord channel through **Node-RED**.

> A sanitized version of a system I built at Kitmeechai Electric (KMCE) for monitoring 100+ smart breakers and EV chargers across 10+ sites. Device lists, hostnames, tokens and channel IDs have been replaced with demo values.

## Why

Engineers used to learn about tripped breakers or dead devices from customer calls. This flow watches every device message and posts an alert as soon as something goes wrong, so the team can react before the customer notices.

## How it works

```
 Devices ──MQTT──▶ Node-RED ──▶ Check fault ──────▶ Discord channel
 (devices/<uuid>/messages/events/)    │
                                      └─ records "last seen"
                    Every 10 min ──▶ Check offline ──▶ Discord channel
```

1. **Decode** – each device sends a byte array. Byte 13 holds a fault code (arc, leakage, under/over voltage, over current, short circuit, over temperature, earthquake), which is mapped to readable text.
2. **Filter** – only devices in the registry are checked; config/ack frames are ignored; alerts the team has muted are skipped.
3. **De-duplicate** – a new fault type is sent immediately; the same fault repeats at most once every 10 minutes, so the channel isn't flooded.
4. **Offline check** – a timer compares each device's last-seen time; devices silent for more than 10 minutes are grouped into one message (trimmed to Discord's 2,000-character limit).
5. **Notify** – the message is sent to Discord with links to the device's documents and Grafana dashboard.

Example alert:

```
### 📍 DEMO PROJECT
📌 Device: Demo Breaker 01
🔌 UUID: demo-01
⚠️ Fault: LEAKAGE CURRENT
🔗 Docs: https://example.com/docs/demo-01
📊 Dashboard: https://grafana.example.com/d/demo?var-device=demo-01
```

## Repository structure

```
flows/alert-flow.json   Importable Node-RED flow (sanitized)
src/alerts.js           Alert logic as plain, testable JavaScript
test/alerts.test.js     Unit tests (node:test, no dependencies)
scripts/build-flow.js   Generates the flow file
.env.example            Settings the flow expects
```

The function nodes in the flow use the same logic as `src/alerts.js`, which is covered by unit tests.

## Run it

**Tests** (Node.js 18+):

```bash
npm test
```

**Node-RED:**

1. Install the Discord node: `npm install node-red-contrib-discord` in your Node-RED folder.
2. Set the environment variables from `.env.example` (`MQTT_HOST`, `MQTT_PORT`, `DISCORD_CHANNEL_ID`) before starting Node-RED.
3. Menu → **Import** → select `flows/alert-flow.json`.
4. Open the **Discord** node and add your bot token (kept in Node-RED's credentials store, not in the flow file).
5. Edit the device list in the **Check fault** node's *On Start* tab.
6. Click **Simulate fault** to send a test message.

## Tech

Node-RED · MQTT · JavaScript (Node.js) · Discord bot API · Grafana links

## Author

Panutda Wongsa — [@panutda2001](https://github.com/panutda2001)
