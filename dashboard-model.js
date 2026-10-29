(function (root) {
  'use strict';

  // Snapshot reproduzível da POC. Não consulta sensores, serviços ou o relógio local.
  const DEMO_DATE = '2026-10-29';
  const SAVING_PER_AVOIDED_VISIT = 30;
  const POINTS = [
    { id: 'torre-b-organico', name: 'Torre B · Orgânico', type: 'Orgânico', recyclable: false, finalOccupancy: 94 },
    { id: 'garagem-reciclaveis', name: 'Garagem · Recicláveis', type: 'Recicláveis', recyclable: true, finalOccupancy: 82 },
    { id: 'gourmet-vidro', name: 'Área gourmet · Vidro', type: 'Vidro', recyclable: true, finalOccupancy: 67 },
    { id: 'torre-c-papel', name: 'Torre C · Papel', type: 'Papel', recyclable: true, finalOccupancy: 63 },
    { id: 'torre-a-organico', name: 'Torre A · Orgânico', type: 'Orgânico', recyclable: false, finalOccupancy: 48 },
    { id: 'torre-a-reciclaveis', name: 'Torre A · Recicláveis', type: 'Recicláveis', recyclable: true, finalOccupancy: 36 },
    { id: 'torre-b-reciclaveis', name: 'Torre B · Recicláveis', type: 'Recicláveis', recyclable: true, finalOccupancy: 57 },
    { id: 'torre-c-organico', name: 'Torre C · Orgânico', type: 'Orgânico', recyclable: false, finalOccupancy: 31 },
    { id: 'jardim-organico', name: 'Jardim · Orgânico', type: 'Orgânico', recyclable: false, finalOccupancy: 42 },
    { id: 'portaria-papel', name: 'Portaria · Papel', type: 'Papel', recyclable: true, finalOccupancy: 28 },
    { id: 'salao-reciclaveis', name: 'Salão · Recicláveis', type: 'Recicláveis', recyclable: true, finalOccupancy: 54 },
    { id: 'piscina-plastico', name: 'Piscina · Plástico', type: 'Plástico', recyclable: true, finalOccupancy: 33 }
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
  const MIN_DATE = DAILY_READINGS[0].date;

  function normalizePeriod(period) {
    if (period === 30 || period === '30') return 30;
    if (period === 14 || period === '14') return 14;
    return 7;
  }

  function isValidDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const timestamp = Date.parse(value + 'T12:00:00Z');
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  }

  function selectWindow(request) {
    if (request !== null && typeof request === 'object') {
      if (Array.isArray(request) || !isValidDate(request.start) || !isValidDate(request.end)) {
        throw new RangeError('Informe datas válidas de início e fim no formato AAAA-MM-DD.');
      }
      if (request.start > request.end) {
        throw new RangeError('A data inicial deve ser anterior ou igual à data final.');
      }
      if (request.start < MIN_DATE || request.end > DEMO_DATE) {
        throw new RangeError('Escolha datas entre 31/08/2026 e 29/10/2026, inclusive.');
      }
      return {
        selection: 'custom',
        startIndex: DAILY_READINGS.findIndex(function (day) { return day.date === request.start; }),
        endIndex: DAILY_READINGS.findIndex(function (day) { return day.date === request.end; })
      };
    }
    const period = normalizePeriod(request);
    return { selection: String(period), startIndex: DAILY_READINGS.length - period, endIndex: DAILY_READINGS.length - 1 };
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

  function getDashboardModel(request) {
    const window = selectWindow(request);
    const daily = DAILY_READINGS.slice(window.startIndex, window.endIndex + 1);
    const period = daily.length;
    // Não comparar uma janela completa com um histórico anterior parcial.
    const comparisonAvailable = window.startIndex >= period;
    const previous = comparisonAvailable ? DAILY_READINGS.slice(window.startIndex - period, window.startIndex) : [];
    const currentTotals = totals(daily);
    const previousTotals = totals(previous);
    const chart = [];
    // Preserva os agrupamentos do MVP de 30 dias, inclusive seu bloco final de 2 dias.
    const groupSize = period === 30 ? 7 : Math.ceil(period / 7);
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
    const bins = POINTS.map(function (point) {
      const history = daily.map(function (day) {
        const reading = day.readings.find(function (item) { return item.pointId === point.id; });
        return { date: day.date, kg: reading.kg, recycledKg: reading.recycledKg, occupancy: reading.occupancy };
      });
      const alert = alerts.find(function (item) { return item.id === point.id; });
      const occupancy = history[history.length - 1].occupancy;
      return {
        id: point.id,
        name: point.name,
        type: point.type,
        recyclable: point.recyclable,
        occupancy: occupancy,
        volumeKg: history.reduce(function (sum, day) { return sum + day.kg; }, 0),
        recycledKg: history.reduce(function (sum, day) { return sum + day.recycledKg; }, 0),
        level: alert ? alert.level : 'normal',
        reason: alert ? alert.reason : 'Capacidade em ' + occupancy + '% · sem alerta no período',
        action: alert ? alert.action : 'Manter monitoramento',
        history: history
      };
    });
    return {
      selection: window.selection,
      period: period,
      start: daily[0].date,
      end: daily[daily.length - 1].date,
      comparisonAvailable: comparisonAvailable,
      previousStart: comparisonAvailable ? previous[0].date : null,
      previousEnd: comparisonAvailable ? previous[previous.length - 1].date : null,
      volumeKg: currentTotals.volumeKg,
      recyclePercent: currentTotals.recyclePercent,
      saving: currentTotals.saving,
      avoidedTrips: currentTotals.avoidedTrips,
      deltas: {
        volumePercent: comparisonAvailable && previousTotals.volumeKg ? (currentTotals.volumeKg - previousTotals.volumeKg) / previousTotals.volumeKg * 100 : null,
        recyclePoints: comparisonAvailable ? currentTotals.recyclePercent - previousTotals.recyclePercent : null
      },
      chart: chart,
      alerts: alerts,
      bins: bins,
      attentionCount: alerts.filter(function (alert) { return alert.level !== 'review'; }).length,
      pointCount: POINTS.length,
      route: { stops: alerts.slice(), names: alerts.map(function (alert) { return alert.name; }) },
      daily: daily
    };
  }

  function getPointDetail(id, request) {
    if (!POINTS.some(function (point) { return point.id === id; })) return null;
    const model = getDashboardModel(request);
    return Object.assign({}, model.bins.find(function (bin) { return bin.id === id; }), {
      start: model.start,
      end: model.end,
      period: model.period
    });
  }

  const api = Object.freeze({
    DEMO_DATE: DEMO_DATE,
    MIN_DATE: MIN_DATE,
    SAVING_PER_AVOIDED_VISIT: SAVING_PER_AVOIDED_VISIT,
    POINTS: POINTS,
    DAILY_READINGS: DAILY_READINGS,
    normalizePeriod: normalizePeriod,
    classifyOccupancy: classifyOccupancy,
    deriveAlerts: deriveAlerts,
    getDashboardModel: getDashboardModel,
    getPointDetail: getPointDetail
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EcoDashboard = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
