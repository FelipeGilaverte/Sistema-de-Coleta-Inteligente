(function (root) {
  'use strict';

  // Snapshot reproduzível da POC. Não consulta sensores, serviços ou o relógio local.
  const DEMO_DATE = '2026-10-29';
  const SAVING_PER_AVOIDED_VISIT = 30;
  const POINTS = [
    { id: 'torre-b-organico', name: 'Torre B · Orgânico', recyclable: false, finalOccupancy: 94 },
    { id: 'garagem-reciclaveis', name: 'Garagem · Recicláveis', recyclable: true, finalOccupancy: 82 },
    { id: 'gourmet-vidro', name: 'Área gourmet · Vidro', recyclable: true, finalOccupancy: 67 },
    { id: 'torre-c-papel', name: 'Torre C · Papel', recyclable: true, finalOccupancy: 63 },
    { id: 'torre-a-organico', name: 'Torre A · Orgânico', recyclable: false, finalOccupancy: 48 },
    { id: 'torre-a-reciclaveis', name: 'Torre A · Recicláveis', recyclable: true, finalOccupancy: 36 },
    { id: 'torre-b-reciclaveis', name: 'Torre B · Recicláveis', recyclable: true, finalOccupancy: 57 },
    { id: 'torre-c-organico', name: 'Torre C · Orgânico', recyclable: false, finalOccupancy: 31 },
    { id: 'jardim-organico', name: 'Jardim · Orgânico', recyclable: false, finalOccupancy: 42 },
    { id: 'portaria-papel', name: 'Portaria · Papel', recyclable: true, finalOccupancy: 28 },
    { id: 'salao-reciclaveis', name: 'Salão · Recicláveis', recyclable: true, finalOccupancy: 54 },
    { id: 'piscina-plastico', name: 'Piscina · Plástico', recyclable: true, finalOccupancy: 33 }
  ];

  function freeze(value) {
    Object.values(value).forEach(function (child) {
      if (child && typeof child === 'object') freeze(child);
    });
    return Object.freeze(value);
  }

  function dateAt(offset) {
    const date = new Date(DEMO_DATE + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }

  // Uma única série de 60 dias sustenta as duas janelas e seus períodos anteriores.
  const DAILY_READINGS = Array.from({ length: 60 }, function (_, day) {
    const readings = POINTS.map(function (point, index) {
      let kg = 9 + ((day * 3 + index * 5) % 7) + (point.recyclable ? 4 : 0);
      if (point.id === 'gourmet-vidro') kg = day === 59 ? 27 : 12 + (day % 3);
      // A mudança gradual é normal na última semana, mas incomum diante do mês.
      if (point.id === 'torre-c-papel') kg = day >= 53 ? 21 + (day % 3) : 8 + (day % 3);
      const occupancy = day === 59 ? point.finalOccupancy : 24 + ((day * 11 + index * 7) % 52);
      return { pointId: point.id, kg: kg, recycledKg: point.recyclable ? kg : 0, occupancy: occupancy };
    });
    return {
      date: dateAt(day - 59),
      readings: readings,
      volumeKg: readings.reduce(function (sum, reading) { return sum + reading.kg; }, 0),
      recycledKg: readings.reduce(function (sum, reading) { return sum + reading.recycledKg; }, 0),
      avoidedTrips: readings.filter(function (reading) { return reading.occupancy < 40; }).length
    };
  });
  freeze(POINTS);
  freeze(DAILY_READINGS);

  function normalizePeriod(period) {
    return period === 30 || period === '30' ? 30 : 7;
  }

  function classifyOccupancy(occupancy) {
    if (occupancy >= 90) return 'critical';
    if (occupancy >= 80) return 'high';
    return null;
  }

  function deriveAlerts(days, points) {
    if (!days.length) return [];
    const latest = days[days.length - 1];
    const baselineDays = days.slice(0, -1);
    const order = { critical: 0, high: 1, review: 2 };
    return (points || POINTS).flatMap(function (point) {
      const reading = latest.readings.find(function (item) { return item.pointId === point.id; });
      if (!reading) return [];
      const history = baselineDays.flatMap(function (day) {
        return day.readings.filter(function (item) { return item.pointId === point.id; });
      });
      const baselineKg = history.length
        ? history.reduce(function (sum, item) { return sum + item.kg; }, 0) / history.length
        : 0;
      const unusual = history.length > 0 && reading.kg >= baselineKg * 1.5 && reading.kg - baselineKg >= 5;
      const level = classifyOccupancy(reading.occupancy) || (unusual ? 'review' : null);
      if (!level) return [];
      const reason = level === 'review'
        ? 'Padrão incomum: ' + reading.kg + ' kg no último dia; média de ' + baselineKg.toFixed(1).replace('.', ',') + ' kg nos ' + history.length + ' dias anteriores (limiar: +50% e +5 kg)'
        : 'Capacidade em ' + reading.occupancy + '%';
      const action = level === 'review' ? 'Verificar padrão antes de coletar' : level === 'critical' ? 'Coletar primeiro' : 'Programar coleta';
      return [{ id: point.id, name: point.name, occupancy: reading.occupancy, level: level, reason: reason, action: action }];
    }).sort(function (a, b) {
      return order[a.level] - order[b.level] || b.occupancy - a.occupancy || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  }

  function totals(days) {
    const total = days.reduce(function (sum, day) {
      sum.volumeKg += day.volumeKg;
      sum.recycledKg += day.recycledKg;
      sum.avoidedTrips += day.avoidedTrips;
      return sum;
    }, { volumeKg: 0, recycledKg: 0, avoidedTrips: 0 });
    total.recyclePercent = total.volumeKg ? total.recycledKg / total.volumeKg * 100 : 0;
    total.saving = total.avoidedTrips * SAVING_PER_AVOIDED_VISIT;
    return total;
  }

  function shortDate(date) {
    return date.slice(8, 10) + '/' + date.slice(5, 7);
  }

  function getDashboardModel(requestedPeriod) {
    const period = normalizePeriod(requestedPeriod);
    const daily = DAILY_READINGS.slice(-period);
    const previous = DAILY_READINGS.slice(-period * 2, -period);
    const currentTotals = totals(daily);
    const previousTotals = totals(previous);
    const chart = [];
    const groupSize = period === 7 ? 1 : 7;
    for (let index = 0; index < daily.length; index += groupSize) {
      const group = daily.slice(index, index + groupSize);
      const start = group[0].date;
      const end = group[group.length - 1].date;
      chart.push({
        label: start === end ? shortDate(start) : shortDate(start) + '–' + shortDate(end),
        start: start,
        end: end,
        kg: totals(group).volumeKg
      });
    }
    const alerts = deriveAlerts(daily);
    return {
      period: period,
      start: daily[0].date,
      end: daily[daily.length - 1].date,
      previousStart: previous[0].date,
      previousEnd: previous[previous.length - 1].date,
      volumeKg: currentTotals.volumeKg,
      recyclePercent: currentTotals.recyclePercent,
      saving: currentTotals.saving,
      avoidedTrips: currentTotals.avoidedTrips,
      deltas: {
        volumePercent: previousTotals.volumeKg ? (currentTotals.volumeKg - previousTotals.volumeKg) / previousTotals.volumeKg * 100 : null,
        recyclePoints: currentTotals.recyclePercent - previousTotals.recyclePercent
      },
      chart: chart,
      alerts: alerts,
      attentionCount: alerts.filter(function (alert) { return alert.level !== 'review'; }).length,
      pointCount: POINTS.length,
      route: { stops: alerts.slice(), names: alerts.map(function (alert) { return alert.name; }) },
      daily: daily
    };
  }

  const api = Object.freeze({
    DEMO_DATE: DEMO_DATE,
    SAVING_PER_AVOIDED_VISIT: SAVING_PER_AVOIDED_VISIT,
    POINTS: POINTS,
    DAILY_READINGS: DAILY_READINGS,
    normalizePeriod: normalizePeriod,
    classifyOccupancy: classifyOccupancy,
    deriveAlerts: deriveAlerts,
    getDashboardModel: getDashboardModel
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EcoDashboard = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
