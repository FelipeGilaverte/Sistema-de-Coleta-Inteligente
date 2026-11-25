'use strict';

const { readFileSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { POINTS, DAILY_READINGS, classifyOccupancy } = require('./dashboard-model.js');

const STALE_AFTER_MS = 30 * 60 * 1000;

class OperationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function openDatabase(filename, clock = () => new Date()) {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));

  function transaction(operation) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const saveReading = db.prepare('INSERT INTO readings (point_id, recorded_at, occupancy, source) VALUES (?, ?, ?, ?)');
  const findAlert = db.prepare('SELECT id, level FROM alerts WHERE point_id = ? AND closed_at IS NULL');
  const closeAlert = db.prepare('UPDATE alerts SET closed_at = ? WHERE id = ?');
  const openAlert = db.prepare('INSERT INTO alerts (point_id, level, opened_at) VALUES (?, ?, ?)');

  function applyReading(pointId, at, occupancy, source) {
    saveReading.run(pointId, at, occupancy, source);
    const previous = findAlert.get(pointId);
    const level = classifyOccupancy(occupancy);
    if (previous?.level === level) return;
    if (previous) closeAlert.run(at, previous.id);
    if (level) openAlert.run(pointId, level, at);
  }

  transaction(() => {
    if (db.prepare('SELECT 1 FROM points LIMIT 1').get()) return;
    const addPoint = db.prepare('INSERT INTO points VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const addDaily = db.prepare('INSERT INTO daily_readings VALUES (?, ?, ?, ?, ?)');
    const at = clock().toISOString();
    POINTS.forEach((point, index) => {
      const sensorId = 'S-' + String(index + 1).padStart(2, '0');
      addPoint.run(point.id, point.name, point.type, Number(point.recyclable), sensorId, 240,
        index % 4 + 1, Math.floor(index / 4));
      applyReading(point.id, at, point.finalOccupancy, 'sensor');
    });
    for (const day of DAILY_READINGS) {
      for (const row of day.readings) {
        addDaily.run(row.pointId, day.date, row.occupancy, row.kg, row.recycledKg);
      }
    }
  });

  const currentPoints = db.prepare(`
    SELECT p.id, p.name, p.waste_type AS type, p.sensor_id AS sensorId, p.capacity_l AS capacityL,
           p.x, p.y, r.occupancy, r.recorded_at AS at, a.level
    FROM points p
    JOIN readings r ON r.id = (SELECT MAX(id) FROM readings WHERE point_id = p.id)
    LEFT JOIN alerts a ON a.point_id = p.id AND a.closed_at IS NULL
    ORDER BY p.rowid
  `);
  const forecastBaseline = db.prepare(`
    SELECT occupancy
    FROM daily_readings WHERE point_id = ?
    ORDER BY day DESC LIMIT 1 OFFSET 6
  `);

  function getPoints(now) {
    return currentPoints.all().map(point => {
      const baseline = forecastBaseline.get(point.id).occupancy;
      const growth = Math.max(0, (point.occupancy - baseline) / 6);
      return {
        ...point,
        stale: now - Date.parse(point.at) > STALE_AFTER_MS,
        estimate: Math.min(100, Math.round(point.occupancy + growth)),
      };
    });
  }

  const latestRoute = db.prepare('SELECT id, created_at AS at, distance_m AS distance FROM routes ORDER BY id DESC LIMIT 1');
  const routeStops = db.prepare(`
    SELECT s.point_id AS id, p.name, s.position, s.occupancy, s.estimated_occupancy AS estimate,
           s.leg_m AS leg, c.recorded_at AS collectedAt
    FROM route_stops s JOIN points p ON p.id = s.point_id
    LEFT JOIN collections c ON c.route_id = s.route_id AND c.point_id = s.point_id
    WHERE s.route_id = ? ORDER BY s.position
  `);

  function getLatestRoute() {
    const route = latestRoute.get();
    return route ? { ...route, stops: routeStops.all(route.id) } : null;
  }

  const recentCollections = db.prepare(`
    SELECT c.id, c.point_id AS pointId, p.name, c.responsible, c.recorded_at AS at,
           c.previous_occupancy AS previousOccupancy, c.route_id AS routeId
    FROM collections c JOIN points p ON p.id = c.point_id
    WHERE c.recorded_at >= ? ORDER BY c.id DESC
  `);

  function getState() {
    const now = clock();
    const cutoff = new Date(now.getTime() - 90 * 86400000).toISOString();
    return { points: getPoints(now), collections: recentCollections.all(cutoff), route: getLatestRoute() };
  }

  function getHistory() {
    const points = db.prepare('SELECT id, name, waste_type AS type, recyclable FROM points ORDER BY rowid').all();
    const rows = db.prepare(`
      SELECT d.day, d.point_id AS pointId, d.kg, d.recycled_kg AS recycledKg, d.occupancy
      FROM daily_readings d JOIN points p ON d.point_id = p.id ORDER BY d.day, p.rowid
    `).all();
    const grouped = new Map();
    for (const { day, ...row } of rows) {
      if (!grouped.has(day)) grouped.set(day, { date: day, readings: [], volumeKg: 0, recycledKg: 0, avoidedTrips: 0 });
      const total = grouped.get(day);
      total.readings.push(row);
      total.volumeKg += row.kg;
      total.recycledKg += row.recycledKg;
      total.avoidedTrips += Number(row.occupancy < 40);
    }
    return { points, dailyReadings: [...grouped.values()] };
  }

  function registerReading(sensorId, occupancy) {
    if (typeof sensorId !== 'string' || !Number.isInteger(occupancy) || occupancy < 0 || occupancy > 100) {
      throw new OperationError(400, 'Informe um sensor e uma ocupação inteira de 0 a 100.');
    }
    const point = db.prepare('SELECT id FROM points WHERE sensor_id = ?').get(sensorId);
    if (!point) throw new OperationError(404, 'Sensor não encontrado.');
    transaction(() => applyReading(point.id, clock().toISOString(), occupancy, 'sensor'));
    return getState();
  }

  function refreshReadings() {
    transaction(() => {
      const at = clock().toISOString();
      for (const point of currentPoints.all()) applyReading(point.id, at, point.occupancy, 'sensor');
    });
    return getState();
  }

  const addRoute = db.prepare('INSERT INTO routes (created_at, distance_m) VALUES (?, ?)');
  const addStop = db.prepare('INSERT INTO route_stops VALUES (?, ?, ?, ?, ?, ?)');
  const distance = (from, to) => 15 * (Math.abs(from.x - to.x) + Math.abs(from.y - to.y));
  const rank = point => point.level === 'critical' ? 0 : point.level === 'high' ? 1 : 2;

  function generateRoute() {
    return transaction(() => {
      const now = clock();
      const points = getPoints(now);
      const priorities = points.filter(point => point.level || point.estimate >= 90);
      const pending = priorities.filter(point => !point.stale);
      if (!pending.length) {
        if (priorities.length) throw new OperationError(409, 'Atualize as leituras para gerar a rota.');
        return null;
      }
      const stops = [];
      let from = { x: 0, y: 0 };
      let total = 0;
      while (pending.length) {
        pending.sort((a, b) => rank(a) - rank(b) || b.estimate - a.estimate ||
          distance(from, a) - distance(from, b) || a.id.localeCompare(b.id));
        const point = pending.shift();
        const leg = distance(from, point);
        stops.push({ ...point, leg });
        total += leg;
        from = point;
      }
      const { lastInsertRowid } = addRoute.run(now.toISOString(), total);
      for (const [index, stop] of stops.entries()) {
        addStop.run(lastInsertRowid, stop.id, index + 1, stop.occupancy, stop.estimate, stop.leg);
      }
      return getLatestRoute();
    });
  }

  const currentStop = db.prepare(`
    SELECT s.route_id AS routeId FROM route_stops s JOIN routes r ON r.id = s.route_id
    WHERE s.point_id = ?
      AND r.id = (SELECT MAX(id) FROM routes)
      AND NOT EXISTS (SELECT 1 FROM collections c WHERE c.point_id = s.point_id AND c.route_id = s.route_id)
  `);
  const addCollection = db.prepare(`
    INSERT INTO collections (point_id, route_id, responsible, recorded_at, previous_occupancy)
    VALUES (?, ?, ?, ?, ?)
  `);

  function registerCollection(pointId, responsible) {
    if (typeof pointId !== 'string' || typeof responsible !== 'string' ||
        !responsible.trim() || responsible.trim().length > 80) {
      throw new OperationError(400, 'Informe o ponto e um responsável com até 80 caracteres.');
    }
    transaction(() => {
      const point = currentPoints.all().find(item => item.id === pointId);
      if (!point) throw new OperationError(404, 'Ponto não encontrado.');
      if (point.occupancy === 0) throw new OperationError(409, 'O ponto já está vazio. Atualize a leitura antes de registrar outra coleta.');
      const at = clock().toISOString();
      addCollection.run(pointId, currentStop.get(pointId)?.routeId ?? null, responsible.trim(), at, point.occupancy);
      applyReading(pointId, at, 0, 'collection');
    });
    return getState();
  }

  return { getHistory, getState, registerReading, refreshReadings, generateRoute, registerCollection, close: () => db.close() };
}

module.exports = { openDatabase, OperationError };
