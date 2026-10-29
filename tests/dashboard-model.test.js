'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DAILY_READINGS, POINTS, SAVING_PER_AVOIDED_VISIT, MIN_DATE, DEMO_DATE,
  classifyOccupancy, deriveAlerts, getDashboardModel, getPointDetail, normalizePeriod
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
  for (const value of [undefined, null, '', 'invalid', -1, 8, 0, NaN]) {
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

test('14 dias são um recorte da mesma base com comparação integral e sete barras', () => {
  const model = getDashboardModel('14');
  assert.equal(normalizePeriod(14), 14);
  assert.equal(normalizePeriod('14'), 14);
  assert.deepEqual(model, getDashboardModel(14));
  assert.equal(model.selection, '14');
  assert.equal(model.period, 14);
  assert.equal(model.start, '2026-10-16');
  assert.equal(model.end, DEMO_DATE);
  assert.equal(model.previousStart, '2026-10-02');
  assert.equal(model.previousEnd, '2026-10-15');
  assert.equal(model.comparisonAvailable, true);
  assert.deepEqual(model.daily, getDashboardModel(30).daily.slice(-14));
  assert.equal(model.chart.length, 7);
  model.chart.forEach(bar => assert.equal(Date.parse(bar.end) - Date.parse(bar.start), 86400000));
});

test('período personalizado é inclusivo e usa o dia final escolhido para leituras e alertas', () => {
  const request = { start: '2026-10-01', end: '2026-10-10' };
  const model = getDashboardModel(request);
  assert.equal(model.selection, 'custom');
  assert.equal(model.period, 10);
  assert.equal(model.start, request.start);
  assert.equal(model.end, request.end);
  assert.deepEqual(model.daily, DAILY_READINGS.filter(day => day.date >= request.start && day.date <= request.end));
  assert.equal(model.previousStart, '2026-09-21');
  assert.equal(model.previousEnd, '2026-09-30');
  model.bins.forEach(bin => {
    assert.equal(bin.history.length, 10);
    assert.equal(bin.history.at(-1).date, '2026-10-10');
    const reading = model.daily.at(-1).readings.find(reading => reading.pointId === bin.id);
    assert.equal(bin.occupancy, reading.occupancy);
  });
  assert.deepEqual(model.alerts, []);
  assert.deepEqual(model.route, { stops: [], names: [] });
});

test('objetos inválidos rejeitam datas impossíveis, malformadas, invertidas e fora da base', () => {
  const invalid = [
    {}, [], new Date('2026-10-01'),
    { start: '2026-10-01' }, { end: '2026-10-01' },
    { start: null, end: '2026-10-01' },
    { start: '2026-02-30', end: '2026-10-01' },
    { start: '2026-09-31', end: '2026-10-01' },
    { start: '2026-10-1', end: '2026-10-02' },
    { start: '01/10/2026', end: '02/10/2026' },
    { start: '2026-10-01T00:00:00Z', end: '2026-10-02' },
    { start: '2026-10-02', end: '2026-10-01' },
    { start: '2026-08-30', end: '2026-10-01' },
    { start: '2026-10-01', end: '2026-10-30' }
  ];
  invalid.forEach(request => assert.throws(() => getDashboardModel(request), error => error instanceof RangeError && /datas|data/.test(error.message)));
});

test('comparação exige o período anterior inteiro e não fabrica deltas para histórico parcial', () => {
  const fullBase = getDashboardModel({ start: MIN_DATE, end: DEMO_DATE });
  assert.equal(fullBase.period, 60);
  for (const model of [
    fullBase,
    getDashboardModel({ start: MIN_DATE, end: MIN_DATE }),
    getDashboardModel({ start: '2026-09-01', end: '2026-09-02' }),
    getDashboardModel({ start: '2026-09-29', end: '2026-10-28' })
  ]) {
    assert.equal(model.comparisonAvailable, false);
    assert.equal(model.previousStart, null);
    assert.equal(model.previousEnd, null);
    assert.deepEqual(model.deltas, { volumePercent: null, recyclePoints: null });
  }
  const oneDay = getDashboardModel({ start: '2026-09-01', end: '2026-09-01' });
  assert.equal(oneDay.comparisonAvailable, true);
  assert.equal(oneDay.previousStart, MIN_DATE);
  assert.equal(oneDay.previousEnd, MIN_DATE);
  assert.ok(Number.isFinite(oneDay.deltas.volumePercent));
  assert.ok(Number.isFinite(oneDay.deltas.recyclePoints));
});

test('recorte equivalente mantém valores de 7/30 dias e identifica a seleção como custom', () => {
  for (const period of [7, 14, 30]) {
    const preset = getDashboardModel(period);
    const custom = getDashboardModel({ start: preset.start, end: preset.end });
    assert.deepEqual(custom, { ...preset, selection: 'custom' });
  }
  assert.equal(getDashboardModel(7).volumeKg, 1268);
  assert.equal(getDashboardModel(30).volumeKg, 5084);
  assert.equal(getDashboardModel(7).saving, 750);
  assert.equal(getDashboardModel(30).saving, 3300);
});

test('lixeiras detalham todos os 12 pontos e conciliam volumes, reciclagem e alertas', () => {
  for (const request of [7, 14, 30, { start: MIN_DATE, end: DEMO_DATE }, { start: '2026-09-10', end: '2026-09-15' }]) {
    const model = getDashboardModel(request);
    assert.equal(model.bins.length, 12);
    assert.equal(model.bins.reduce((sum, bin) => sum + bin.volumeKg, 0), model.volumeKg);
    assert.equal(model.bins.reduce((sum, bin) => sum + bin.recycledKg, 0), model.daily.reduce((sum, day) => sum + day.recycledKg, 0));
    model.bins.forEach(bin => {
      const point = POINTS.find(point => point.id === bin.id);
      assert.equal(bin.type, point.type);
      assert.equal(bin.recyclable, point.recyclable);
      assert.deepEqual(bin.history.map(day => day.date), model.daily.map(day => day.date));
      assert.equal(bin.volumeKg, bin.history.reduce((sum, day) => sum + day.kg, 0));
      assert.equal(bin.recycledKg, bin.history.reduce((sum, day) => sum + day.recycledKg, 0));
      assert.equal(bin.occupancy, bin.history.at(-1).occupancy);
      const alert = model.alerts.find(alert => alert.id === bin.id);
      assert.equal(bin.level, alert ? alert.level : 'normal');
      if (alert) {
        assert.equal(bin.reason, alert.reason);
        assert.equal(bin.action, alert.action);
        assert.equal(bin.occupancy, alert.occupancy);
      }
    });
  }
});

test('detalhe de um ponto corresponde ao modelo, não compartilha estado e respeita a janela', () => {
  const request = { start: '2026-10-01', end: '2026-10-06' };
  const model = getDashboardModel(request);
  const detail = getPointDetail('gourmet-vidro', request);
  assert.deepEqual(detail, { ...model.bins.find(bin => bin.id === 'gourmet-vidro'), start: model.start, end: model.end, period: model.period });
  detail.history[0].kg = 999;
  assert.notEqual(getPointDetail('gourmet-vidro', request).history[0].kg, 999);
  assert.equal(getPointDetail('inexistente', request), null);
  assert.equal(getPointDetail(undefined, request), null);
  assert.equal(getPointDetail('inexistente', {}), null);
});

test('ocupações críticas de 29/10 não vazam para períodos que terminam antes', () => {
  const before = getDashboardModel({ start: '2026-10-22', end: '2026-10-28' });
  const after = getDashboardModel({ start: '2026-10-23', end: '2026-10-29' });
  assert.equal(before.attentionCount, 0);
  assert.equal(after.attentionCount, 2);
  assert.ok(before.bins.every(bin => bin.occupancy < 80));
  assert.equal(after.bins.find(bin => bin.id === 'torre-b-organico').occupancy, 94);
  const onlyLastDay = getDashboardModel({ start: DEMO_DATE, end: DEMO_DATE });
  assert.equal(onlyLastDay.alerts.length, 2);
  assert.ok(onlyLastDay.alerts.every(alert => alert.level !== 'review'));
});

test('todas as durações de 1 a 60 dias têm até 7 barras contíguas sem perder volume', () => {
  for (let length = 1; length <= 60; length++) {
    const selected = DAILY_READINGS.slice(-length);
    const model = getDashboardModel({ start: selected[0].date, end: DEMO_DATE });
    assert.equal(model.period, length);
    assert.ok(model.chart.length >= 1 && model.chart.length <= 7);
    assert.equal(model.chart.reduce((sum, bar) => sum + bar.kg, 0), model.volumeKg);
    const covered = model.chart.flatMap(bar => selected.filter(day => day.date >= bar.start && day.date <= bar.end).map(day => day.date));
    assert.deepEqual(covered, selected.map(day => day.date));
    if (length <= 7) assert.equal(model.chart.length, length);
    if (length === 30) assert.deepEqual(model.chart.map(bar => (Date.parse(bar.end) - Date.parse(bar.start)) / 86400000 + 1), [7, 7, 7, 7, 2]);
  }
});
