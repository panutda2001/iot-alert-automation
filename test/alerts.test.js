'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  uuidFromTopic,
  decodeFault,
  isStatusFrame,
  checkFault,
  findOffline,
  formatOfflineAlert,
  TEN_MINUTES,
} = require('../src/alerts');

const device = { uuid: 'demo-01', name: 'Demo Breaker 01', dashboardUrl: 'https://grafana.example.com/d/demo' };

/** Build a 32-byte status frame with the given fault code. */
function frame(fault = 0, order = 1) {
  const data = new Array(32).fill(0);
  data[0] = 100;
  data[1] = order;
  data[13] = fault;
  return data;
}

test('uuidFromTopic reads the device id from the MQTT topic', () => {
  assert.equal(uuidFromTopic('devices/demo-01/messages/events/'), 'demo-01');
  assert.equal(uuidFromTopic('channel/demo-01/status'), null);
});

test('decodeFault maps known, generic and unknown codes', () => {
  assert.equal(decodeFault(0), '');
  assert.equal(decodeFault(16), 'OVER CURRENT');
  assert.equal(decodeFault(14, 3), 'FAULT TRIP (14, 3)');
  assert.equal(decodeFault(99), 'UNKNOWN (99)');
});

test('isStatusFrame ignores config/ack frames', () => {
  assert.equal(isStatusFrame(frame(0, 1)), true);
  assert.equal(isStatusFrame(frame(0, 62)), false);
  assert.equal(isStatusFrame([1, 2, 3]), false);
});

test('checkFault alerts on a new fault', () => {
  const r = checkFault({ uuid: 'demo-01', data: frame(32), device, now: 1000 });
  assert.deepEqual(r, { fault: 'SHORT CIRCUIT' });
});

test('checkFault ignores unknown devices and normal frames', () => {
  assert.equal(checkFault({ uuid: 'x', data: frame(32), device: undefined, now: 0 }), null);
  assert.equal(checkFault({ uuid: 'demo-01', data: frame(0), device, now: 0 }), null);
});

test('checkFault waits for the cooldown before repeating the same fault', () => {
  const lastAlert = { at: 0, fault: 'SHORT CIRCUIT' };
  assert.equal(checkFault({ uuid: 'demo-01', data: frame(32), device, lastAlert, now: TEN_MINUTES - 1 }), null);
  assert.deepEqual(checkFault({ uuid: 'demo-01', data: frame(32), device, lastAlert, now: TEN_MINUTES }), { fault: 'SHORT CIRCUIT' });
});

test('checkFault sends a different fault immediately, even inside the cooldown', () => {
  const lastAlert = { at: 0, fault: 'SHORT CIRCUIT' };
  assert.deepEqual(checkFault({ uuid: 'demo-01', data: frame(64), device, lastAlert, now: 1 }), { fault: 'OVER TEMP' });
});

test('checkFault respects the mute list', () => {
  const muted = [{ uuid: 'demo-01', fault: 'ARC' }];
  assert.equal(checkFault({ uuid: 'demo-01', data: frame(1), device, muted, now: 0 }), null);
});

test('findOffline returns silent devices once per cooldown', () => {
  const registry = [device, { uuid: 'demo-02', name: 'Demo Breaker 02' }];
  const now = 3 * TEN_MINUTES;
  const lastSeen = { 'demo-01': now - 1000, 'demo-02': now - 2 * TEN_MINUTES };

  assert.deepEqual(findOffline({ registry, lastSeen, now }).map((d) => d.uuid), ['demo-02']);
  assert.deepEqual(findOffline({ registry, lastSeen, lastNotified: { 'demo-02': now - 1000 }, now }), []);
});

test('formatOfflineAlert stays within Discord message limits', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ uuid: `d-${i}`, name: `Device ${i}` }));
  assert.ok(formatOfflineAlert('DEMO', many).length <= 2000);
});
