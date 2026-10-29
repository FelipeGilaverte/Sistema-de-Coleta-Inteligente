'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DAILY_READINGS, POINTS, SAVING_PER_AVOIDED_VISIT,
  classifyOccupancy, deriveAlerts, getDashboardModel
} = require('../dashboard-model.js');

test('snapshot tem 60 dias consecutivos e 12 pontos com medidas válidas', () => {
  assert.equal(DAILY_READINGS.length, 60);
  assert.equal(DAILY_READINGS.at(-1).date, '2026-10-29');
  DAILY_READINGS.forEach((day, index) => {
    assert.equal(day.readings.length, 12);
    assert.deepEqual(day.readings.map(reading => reading.pointId), POINTS.map(point => point.id));
    assert.equal(day.volumeKg, day.readings.reduce((sum, reading) => sum + reading.kg, 0));
    assert.equal(day.recycledKg, day.readings.reduce((sum, reading) => sum + reading.recycledKg, 0));
    day.readings.forEach(reading => {
      assert.ok(reading.kg >= 0 && reading.recycledKg >= 0 && reading.recycledKg <= reading.kg);
      assert.ok(reading.occupancy >= 0 && reading.occupancy <= 100);
    });
    if (index) assert.equal(Date.parse(day.date) - Date.parse(DAILY_READINGS[index - 1].date), 86400000);
  });
});

test('7 dias são exatamente o recorte final dos 30 dias, sem regenerar leituras', () => {
  const week = getDashboardModel(7);
  const month = getDashboardModel(30);
  assert.deepEqual(week.daily, month.daily.slice(-7));
  assert.equal(week.start, '2026-10-23');
  assert.equal(month.start, '2026-09-30');
  assert.equal(week.end, month.end);
  assert.equal(week.previousStart, '2026-10-16');
  assert.equal(week.previousEnd, '2026-10-22');
  assert.equal(month.previousStart, '2026-08-31');
  assert.equal(month.previousEnd, '2026-09-29');
});

for (const period of [7, 30]) {
  test(`${period} dias: gráfico cobre cada data uma vez e soma exatamente o indicador`, () => {
    const model = getDashboardModel(period);
    assert.equal(model.chart.length, period === 7 ? 7 : 5);
    assert.equal(model.chart.reduce((sum, bar) => sum + bar.kg, 0), model.volumeKg);
    const covered = model.chart.flatMap(bar => model.daily.filter(day => day.date >= bar.start && day.date <= bar.end).map(day => day.date));
    assert.deepEqual(covered, model.daily.map(day => day.date));
    assert.equal(model.chart.at(-1).end, '2026-10-29');
  });

  test(`${period} dias: indicadores e deltas vêm das janelas exibidas`, () => {
    const model = getDashboardModel(period);
    const previous = DAILY_READINGS.filter(day => day.date >= model.previousStart && day.date <= model.previousEnd);
    const sum = (days, key) => days.reduce((total, day) => total + day[key], 0);
    assert.equal(model.volumeKg, sum(model.daily, 'volumeKg'));
    assert.equal(model.recyclePercent, sum(model.daily, 'recycledKg') / model.volumeKg * 100);
    assert.equal(model.saving, model.avoidedTrips * SAVING_PER_AVOIDED_VISIT);
    assert.equal(model.avoidedTrips, model.daily.reduce((total, day) => total + day.readings.filter(reading => reading.occupancy < 40).length, 0));
    assert.equal(model.deltas.volumePercent, (model.volumeKg - sum(previous, 'volumeKg')) / sum(previous, 'volumeKg') * 100);
    assert.equal(model.deltas.recyclePoints, model.recyclePercent - sum(previous, 'recycledKg') / sum(previous, 'volumeKg') * 100);
  });

  test(`${period} dias: rota e contador correspondem à mesma lista ordenada de alertas`, () => {
    const model = getDashboardModel(period);
    assert.equal(model.alerts.length, period === 7 ? 3 : 4);
    assert.equal(model.attentionCount, 2);
    assert.equal(model.pointCount, 12);
    assert.deepEqual(model.route.stops, model.alerts);
    assert.deepEqual(model.route.names, model.alerts.map(alert => alert.name));
    assert.deepEqual(model.alerts.slice(0, 2).map(alert => alert.level), ['critical', 'high']);
    assert.equal(model.alerts[0].occupancy, 94);
    assert.equal(model.alerts[1].occupancy, 82);
    model.alerts.filter(alert => alert.level === 'review').forEach(alert => {
      assert.equal(alert.action, 'Verificar padrão antes de coletar');
      assert.match(alert.reason, /limiar: \+50% e \+5 kg/);
    });
  });
}

test('limites de ocupação distinguem 79, 80, 89 e 90 por cento', () => {
  assert.equal(classifyOccupancy(79), null);
  assert.equal(classifyOccupancy(80), 'high');
  assert.equal(classifyOccupancy(89), 'high');
  assert.equal(classifyOccupancy(90), 'critical');
  assert.equal(classifyOccupancy(100), 'critical');
});

test('anomalia usa apenas dias anteriores: exige crescimento de 50% e pelo menos 5 kg', () => {
  const points = [{ id: 'a', name: 'Ponto A' }];
  const day = kg => ({ readings: [{ pointId: 'a', kg, occupancy: 40 }] });
  assert.deepEqual(deriveAlerts([day(10), day(14)], points), []);
  assert.equal(deriveAlerts([day(10), day(15)], points)[0].level, 'review');
  assert.deepEqual(deriveAlerts([day(2), day(4)], points), []);
  assert.deepEqual(deriveAlerts([day(20)], points), []);
  assert.deepEqual(deriveAlerts([], points), []);
  assert.equal(deriveAlerts([day(0), day(5)], points)[0].level, 'review');
});

test('priorização resolve empates por ocupação e identificador, sem duplicar pontos', () => {
  const points = ['z', 'b', 'a', 'c'].map(id => ({ id, name: id }));
  const readings = [{ pointId: 'z', kg: 20, occupancy: 80 }, { pointId: 'b', kg: 20, occupancy: 95 }, { pointId: 'a', kg: 20, occupancy: 95 }, { pointId: 'c', kg: 20, occupancy: 99 }];
  const result = deriveAlerts([{ readings: readings.map(reading => ({ ...reading, kg: 5 })) }, { readings }], points);
  assert.deepEqual(result.map(alert => alert.id), ['c', 'a', 'b', 'z']);
  assert.equal(new Set(result.map(alert => alert.id)).size, result.length);
});

test('trocas repetidas 7 → 30 → 7 são reversíveis e não alteram a base de dados', () => {
  const initial = getDashboardModel(7);
  const snapshot = JSON.stringify(DAILY_READINGS);
  for (let index = 0; index < 50; index++) {
    getDashboardModel('30');
    assert.deepEqual(getDashboardModel('7'), initial);
  }
  const altered = getDashboardModel(30);
  altered.alerts.reverse();
  altered.chart[0].kg = 0;
  assert.deepEqual(getDashboardModel(7), initial);
  assert.equal(JSON.stringify(DAILY_READINGS), snapshot);
  assert.throws(() => { DAILY_READINGS[0].readings[0].kg = 0; }, TypeError);
});

test('períodos inválidos retornam a janela padrão de 7 dias', () => {
  for (const value of [undefined, null, '', 'invalid', -1, 8, 0, NaN, {}, []]) {
    assert.deepEqual(getDashboardModel(value), getDashboardModel(7));
  }
  assert.deepEqual(getDashboardModel('30'), getDashboardModel(30));
});

test('todos os indicadores e deltas de ambas as janelas são números finitos', () => {
  [7, 30].forEach(period => {
    const model = getDashboardModel(period);
    [model.volumeKg, model.recyclePercent, model.saving, model.avoidedTrips, ...Object.values(model.deltas)].forEach(value => assert.ok(Number.isFinite(value)));
    assert.ok(model.recyclePercent >= 0 && model.recyclePercent <= 100);
  });
});

test('script clássico disponibiliza a mesma API no navegador sem imports ou backend', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const context = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dashboard-model.js'), 'utf8'), context);
  assert.equal(context.EcoDashboard.getDashboardModel('30').volumeKg, getDashboardModel(30).volumeKg);
});
