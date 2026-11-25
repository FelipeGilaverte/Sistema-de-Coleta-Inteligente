'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { once } = require('node:events');
const { request } = require('node:http');
const { createLocalServer } = require('../server.cjs');

test('o modo local grava a rota, a coleta e as leituras, inclusive após reiniciar', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'ecocondominio-'));
  const filename = join(folder, 'demo.sqlite');
  const socketPath = process.platform === 'win32'
    ? '\\\\.\\pipe\\ecocondominio-test-' + process.pid : join(folder, 'app.sock');
  let now = new Date('2026-11-24T18:00:00Z');
  const clock = () => now;
  let server;

  async function start() {
    server = createLocalServer({ filename, clock });
    server.listen(socketPath);
    await once(server, 'listening');
  }

  async function stop() {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server = null;
  }

  function send(path, body) {
    return new Promise((resolve, reject) => {
      const req = request({
        socketPath, path, method: body === undefined ? 'GET' : 'POST', agent: false,
        headers: { Host: '127.0.0.1:8765', 'Content-Type': 'application/json' },
      }, async (res) => {
        try {
          const chunks = [];
          for await (const chunk of res) chunks.push(chunk);
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
        } catch (error) {
          reject(error);
        }
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }

  async function api(path, status, body) {
    const response = await send('/api/' + path, body);
    assert.equal(response.status, status, path);
    return JSON.parse(response.body);
  }

  try {
    await start();
    const page = await send('/');
    assert.match(page.body, /<body data-sqlite="true">/);
    const { history, state } = await api('initial', 200);
    assert.equal(history.dailyReadings.length, 60);
    assert.equal(state.points.length, 12);
    const pointId = 'torre-b-organico';
    const point = snapshot => snapshot.points.find(item => item.id === pointId);
    assert.equal(point(state).occupancy, 94);
    assert.equal(point(state).level, 'critical');

    const { route } = await api('routes', 201, {});
    assert.equal(route.stops[0].id, pointId);
    assert.equal(route.stops.reduce((sum, stop) => sum + stop.leg, 0), route.distance);

    const collection = { pointId, responsible: ' Teste da equipe ' };
    await api('collections', 400, { ...collection, responsible: '  ' });
    const answers = await Promise.all(Array.from({ length: 2 }, () => send('/api/collections', collection)));
    assert.deepEqual(answers.map(answer => answer.status).sort(), [201, 409]);
    const next = await api('state', 200);
    assert.equal(next.collections.length, 1);
    assert.equal(next.collections[0].responsible, 'Teste da equipe');
    assert.equal(next.collections[0].previousOccupancy, 94);
    assert.equal(next.collections[0].routeId, route.id);
    assert.equal(point(next).occupancy, 0);
    assert.equal(point(next).level, null);
    assert.ok(next.route.stops[0].collectedAt);

    await stop();
    await start();
    assert.deepEqual(await api('state', 200), next);
    const sensorId = point(next).sensorId;
    await api('readings', 400, { sensorId, occupancy: 101 });
    const high = await api('readings', 201, { sensorId, occupancy: 80 });
    assert.equal(point(high).level, 'high');
    const critical = await api('readings', 201, { sensorId, occupancy: 90 });
    assert.equal(point(critical).level, 'critical');

    now = new Date(now.getTime() + 31 * 60 * 1000);
    await api('routes', 409, {});
    const fresh = await api('readings/refresh', 200, {});
    assert.ok(fresh.points.every(item => !item.stale));
    const reopened = await api('routes', 201, {});
    assert.equal(reopened.route.stops[0].id, pointId);
    assert.equal(reopened.route.stops[0].collectedAt, null);
  } finally {
    if (server) await stop();
    rmSync(folder, { recursive: true, force: true });
  }
});
