'use strict';

/**
 * Alert logic for smart circuit-breaker devices that report over MQTT.
 *
 * Each device publishes a byte array on `devices/<uuid>/messages/events/`.
 * Relevant bytes:
 *   [0]  header   — 100 for a valid status frame
 *   [1]  order    — message type; 61/62/63/67 are config/ack frames, not status
 *   [12] switch   — 1 = ON, 0 = OFF
 *   [13] fault    — 0 = normal, otherwise a fault code (see FAULT_CODES)
 *   [14] detail   — extra info for a generic "fault trip"
 *
 * The same logic runs inside the Node-RED function nodes in flows/alert-flow.json.
 */

const STATUS_HEADER = 100;
const NON_STATUS_ORDERS = new Set([61, 62, 63, 67]);

const FAULT_CODES = {
  1: 'ARC',
  2: 'LEAKAGE CURRENT',
  4: 'UNDER VOLTAGE',
  8: 'OVER VOLTAGE',
  16: 'OVER CURRENT',
  32: 'SHORT CIRCUIT',
  64: 'OVER TEMP',
  128: 'EARTHQUAKE',
  65: 'SEND ORDER SC ALARM',
  67: 'SEND ORDER ARC ALARM',
};

const TEN_MINUTES = 10 * 60 * 1000;

/** Parse the device UUID out of an MQTT topic like `devices/<uuid>/messages/events/`. */
function uuidFromTopic(topic) {
  const parts = String(topic || '').split('/');
  return parts[0] === 'devices' && parts[1] ? parts[1] : null;
}

/** Turn a raw fault code into readable text. Returns '' when there is no fault. */
function decodeFault(code, detail) {
  if (!code) return '';
  if (code === 14) return `FAULT TRIP (${code}, ${detail})`;
  return FAULT_CODES[code] || `UNKNOWN (${code})`;
}

/** True when this frame is a status report (not a config/ack frame). */
function isStatusFrame(data) {
  return Array.isArray(data) || ArrayBuffer.isView(data)
    ? data[0] === STATUS_HEADER && !NON_STATUS_ORDERS.has(data[1])
    : false;
}

/**
 * Decide whether an incoming message should raise a fault alert.
 * Sends the first alert for a new fault type immediately, then at most once per cooldown.
 *
 * @param {object}   args
 * @param {string}   args.uuid
 * @param {number[]} args.data        raw payload bytes
 * @param {object}   args.device      registry entry { uuid, name, docUrl, dashboardUrl }
 * @param {object}   args.lastAlert   { at: number, fault: string } | undefined
 * @param {Array}    args.muted       [{ uuid, fault }] alerts the team has silenced
 * @param {number}   args.now
 * @param {number}  [args.cooldownMs]
 * @returns {{ fault: string } | null}
 */
function checkFault({ uuid, data, device, lastAlert, muted = [], now, cooldownMs = TEN_MINUTES }) {
  if (!device || !isStatusFrame(data)) return null;

  const fault = decodeFault(data[13], data[14]);
  if (!fault) return null;

  if (muted.some((m) => m.uuid === uuid && m.fault === fault)) return null;

  const isNewFault = !lastAlert || lastAlert.fault !== fault;
  const cooledDown = !lastAlert || now - lastAlert.at >= cooldownMs;
  return isNewFault || cooledDown ? { fault } : null;
}

/**
 * Find devices that have not reported for longer than `thresholdMs`
 * and have not already been reported within the cooldown.
 *
 * @param {Array}  registry      list of devices
 * @param {object} lastSeen      { [uuid]: timestamp }
 * @param {object} lastNotified  { [uuid]: timestamp }
 * @returns {Array} devices to report as offline
 */
function findOffline({ registry, lastSeen, lastNotified = {}, muted = [], now, thresholdMs = TEN_MINUTES, cooldownMs = TEN_MINUTES }) {
  return registry.filter((d) => {
    const seen = lastSeen[d.uuid] || 0;
    if (now - seen <= thresholdMs) return false;
    if (muted.some((m) => m.uuid === d.uuid && m.fault === 'OFFLINE')) return false;
    const notified = lastNotified[d.uuid] || 0;
    return now - notified >= cooldownMs;
  });
}

/** Discord-flavoured markdown for a fault alert. */
function formatFaultAlert(project, device, fault) {
  return [
    `### 📍 ${project}`,
    `**📌 Device:** ${device.name}`,
    `**🔌 UUID:** ${device.uuid}`,
    `**⚠️ Fault:** ${fault}`,
    `**🔗 Docs:** ${device.docUrl || 'N/A'}`,
    `**📊 Dashboard:** ${device.dashboardUrl || 'N/A'}`,
  ].join('\n');
}

/** One message listing every offline device, trimmed to Discord's 2000-character limit. */
function formatOfflineAlert(project, devices) {
  const blocks = devices.map((d) =>
    [
      '====================',
      `📍 **${d.name}**`,
      `🔑 UUID: ${d.uuid}`,
      '⚠️ STATUS: OFFLINE',
      `📊 Dashboard: ${d.dashboardUrl || 'N/A'}`,
    ].join('\n')
  );
  const text = `### 📍 ${project}\n` + blocks.join('\n');
  return text.length > 2000 ? text.slice(0, 1990) + '\n…' : text;
}

module.exports = {
  FAULT_CODES,
  TEN_MINUTES,
  uuidFromTopic,
  decodeFault,
  isStatusFrame,
  checkFault,
  findOffline,
  formatFaultAlert,
  formatOfflineAlert,
};
