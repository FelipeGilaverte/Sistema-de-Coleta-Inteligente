const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const dashboardUrl = pathToFileURL(path.join(root, 'index.html')).href;
let browser;

before(async () => {
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'chrome',
    headless: true,
  });
});

after(async () => {
  await browser?.close();
});

async function withPage(run, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  try {
    await page.goto(dashboardUrl);
    await page.waitForFunction(() => window.EcoDashboard && document.querySelector('#chart .bar'));
    await run(page);
    assert.deepEqual(errors, [], 'A interface não deve gerar erros JavaScript ou de console.');
  } finally {
    await context.close();
  }
}

function numberIn(text) {
  const match = text.match(/-?[\d.]+(?:,\d+)?/);
  assert.ok(match, `Número ausente: ${text}`);
  return Number(match[0].replaceAll('.', '').replace(',', '.'));
}

async function assertConsistent(page, period, selection = typeof period === 'object' ? 'custom' : String(period)) {
  const state = await page.evaluate(period => {
    const text = selector => document.querySelector(selector).textContent;
    const model = window.EcoDashboard.getDashboardModel(period);
    return {
      model,
      selected: document.querySelector('#period').value,
      volume: text('#volume'),
      recycle: text('#recycle'),
      saving: text('#saving'),
      alerts: text('#alerts'),
      alertCount: text('#alert-count'),
      summary: text('#alert-summary'),
      range: text('#period-range'),
      alertIds: [...document.querySelectorAll('#alert-list .alert')].map(row => row.dataset.id),
      chartKg: [...document.querySelectorAll('#chart .bar')].map(bar => Number(bar.dataset.kg)),
      tableRows: document.querySelectorAll('#chart-table-body tr').length,
    };
  }, period);
  assert.equal(state.selected, selection);
  assert.equal(numberIn(state.volume), state.model.volumeKg);
  assert.ok(Math.abs(numberIn(state.recycle) - state.model.recyclePercent) <= 0.51,
    'Percentual de reciclagem deve corresponder ao modelo, permitindo arredondamento visual.');
  assert.equal(numberIn(state.saving), state.model.saving);
  assert.equal(numberIn(state.alerts), state.model.alerts.length);
  assert.ok(state.alertCount.includes(`${state.model.alerts.length} de ${state.model.pointCount}`));
  assert.ok(state.summary.includes(String(state.model.attentionCount)));
  assert.deepEqual(state.alertIds, state.model.alerts.map(alert => alert.id));
  assert.deepEqual(state.chartKg, state.model.chart.map(bar => bar.kg));
  assert.equal(state.chartKg.reduce((sum, kg) => sum + kg, 0), state.model.volumeKg);
  assert.equal(state.tableRows, state.model.chart.length);
  assert.equal(state.model.bins.reduce((sum, bin) => sum + bin.volumeKg, 0), state.model.volumeKg,
    'A soma das lixeiras precisa coincidir com o indicador do condomínio.');
  for (const date of [state.model.start, state.model.end]) {
    const [, month, day] = date.split('-');
    assert.ok(state.range.includes(`${day}/${month}`), `Data ${date} ausente em ${state.range}`);
  }
  return state;
}

async function visibleBinIds(page) {
  return page.locator('#bin-list .bin-card').evaluateAll(cards => cards.map(card => card.dataset.id));
}

function priorityOrder(bins) {
  const priority = { critical: 0, high: 1, review: 2, normal: 3 };
  return [...bins].sort((a, b) => priority[a.level] - priority[b.level]
    || b.occupancy - a.occupancy || a.id.localeCompare(b.id)).map(bin => bin.id);
}

async function assertPointDetails(page, selection, id) {
  const actual = await page.evaluate(({ selection, id }) => {
    const text = selector => document.querySelector(selector).textContent;
    const model = window.EcoDashboard.getDashboardModel(selection);
    return {
      bin: model.bins.find(bin => bin.id === id),
      start: model.start,
      end: model.end,
      open: document.querySelector('#point-dialog').open,
      title: text('#point-title'),
      period: text('#point-period'),
      occupancy: text('#point-occupancy'),
      volume: text('#point-volume'),
      reason: text('#point-reason'),
      action: text('#point-action'),
      history: [...document.querySelectorAll('#point-history-table tr')].map(row =>
        [...row.querySelectorAll('td')].map(cell => cell.textContent)),
    };
  }, { selection, id });
  assert.equal(actual.open, true);
  assert.ok(actual.bin, `Lixeira ${id} não encontrada no modelo`);
  assert.ok(actual.title.includes(actual.bin.name));
  assert.equal(numberIn(actual.occupancy), actual.bin.occupancy);
  assert.equal(numberIn(actual.volume), actual.bin.volumeKg);
  assert.ok(actual.reason.includes(actual.bin.reason));
  assert.ok(actual.action.includes(actual.bin.action));
  assert.equal(actual.history.length, actual.bin.history.length);
  actual.bin.history.forEach((reading, index) => {
    const [, month, day] = reading.date.split('-');
    assert.ok(actual.history[index][0].includes(`${day}/${month}`));
    assert.equal(numberIn(actual.history[index][1]), reading.kg);
    assert.equal(numberIn(actual.history[index][2]), reading.occupancy);
  });
  assert.equal(actual.bin.occupancy, actual.bin.history.at(-1).occupancy);
  assert.equal(actual.bin.history.reduce((sum, reading) => sum + reading.kg, 0), actual.bin.volumeKg);
  for (const date of [actual.start, actual.end]) {
    const [, month, day] = date.split('-');
    assert.ok(actual.period.includes(`${day}/${month}`));
  }
}

async function applyCustomPeriod(page, range) {
  await page.selectOption('#period', 'custom');
  await page.fill('#start-date', range.start);
  await page.fill('#end-date', range.end);
  await page.click('#apply-period');
  return assertConsistent(page, range);
}

async function assertRoute(page, period) {
  const actual = await page.locator('#route-stops li').evaluateAll(rows => rows.map(row => ({
    id: row.dataset.id,
    text: row.textContent,
  })));
  const expected = await page.evaluate(period => window.EcoDashboard.getDashboardModel(period).route.stops, period);
  assert.deepEqual(actual.map(stop => stop.id), expected.map(stop => stop.id));
  expected.forEach((stop, index) => assert.ok(actual[index].text.includes(stop.name)));
}

test('7 → 14 → 30 → 7 dias mantém totais, gráfico, alertas e período sincronizados', async () => {
  await withPage(async page => {
    const first = await assertConsistent(page, 7);
    await page.selectOption('#period', '14');
    await assertConsistent(page, 14);
    await page.selectOption('#period', '30');
    const month = await assertConsistent(page, 30);
    assert.notEqual(first.model.volumeKg, month.model.volumeKg);
    assert.notDeepEqual(first.alertIds, month.alertIds,
      'O cenário deve exercitar alertas diferentes por histórico, evitando uma lista fixa.');
    await page.selectOption('#period', '7');
    const restored = await assertConsistent(page, 7);
    assert.deepEqual(restored, first);
  });
});

test('20 trocas consecutivas não deixam resultados antigos após a última seleção', async () => {
  await withPage(async page => {
    await page.evaluate(() => {
      const select = document.querySelector('#period');
      for (let index = 0; index < 20; index += 1) {
        select.value = index % 2 === 0 ? '7' : '30';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    const selected = await assertConsistent(page, 30);
    // Espera além da transição visual para flagrar atualizações atrasadas.
    await page.waitForTimeout(450);
    assert.deepEqual(await assertConsistent(page, 30), selected);
  });
});

test('recomendação acompanha alertas, fecha ao trocar período e devolve o foco', async () => {
  await withPage(async page => {
    await page.click('#routeBtn');
    assert.equal(await page.locator('#route-dialog').evaluate(dialog => dialog.open), true);
    await assertRoute(page, 7);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#route-dialog').evaluate(dialog => dialog.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'routeBtn');
    await page.click('#routeBtn');
    await page.click('#close-route');
    assert.equal(await page.locator('#route-dialog').evaluate(dialog => dialog.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'routeBtn');
    await page.click('#routeBtn');
    // Um diálogo modal bloqueia o seletor visualmente; simula atualização de estado externa.
    await page.evaluate(() => {
      const select = document.querySelector('#period');
      select.value = '30';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal(await page.locator('#route-dialog').evaluate(dialog => dialog.open), false);
    await assertConsistent(page, 30);
    await page.click('#routeBtn');
    await assertRoute(page, 30);
  });
});

test('navegação por teclado e volta de Como funciona preservam o período', async () => {
  await withPage(async page => {
    await page.focus('#period');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await assertConsistent(page, 30);
    await page.focus('[data-view="projeto"]');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#projeto').isVisible(), true);
    assert.equal(await page.locator('#dashboard').isVisible(), false);
    assert.equal(await page.getAttribute('[data-view="projeto"]', 'aria-current'), 'page');
    await page.focus('[data-view="dashboard"]');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#dashboard').isVisible(), true);
    assert.equal(await page.locator('#projeto').isVisible(), false);
    assert.equal(await page.getAttribute('[data-view="dashboard"]', 'aria-current'), 'page');
    await assertConsistent(page, 30);
  });
});

test('período personalizado só aplica após confirmação, mantém filtros e pode ser cancelado', async () => {
  await withPage(async page => {
    const initial = await assertConsistent(page, 7);
    await page.fill('#bin-search', 'Torre');
    await page.selectOption('#bin-type', 'Orgânico');
    await page.selectOption('#period', 'custom');
    assert.equal(await page.locator('#custom-period').isVisible(), true);
    await page.fill('#start-date', '2026-10-02');
    await page.fill('#end-date', '2026-10-15');
    const editing = await assertConsistent(page, 7, 'custom');
    assert.deepEqual({ ...editing, selected: '7' }, initial);
    await page.click('#cancel-period');
    assert.equal(await page.locator('#custom-period').isVisible(), false);
    assert.deepEqual(await assertConsistent(page, 7), initial);

    const range = { start: '2026-10-02', end: '2026-10-15' };
    const applied = await applyCustomPeriod(page, range);
    assert.equal(await page.inputValue('#bin-search'), 'Torre');
    assert.equal(await page.inputValue('#bin-type'), 'Orgânico');
    const expected = applied.model.bins.filter(bin => bin.name.includes('Torre') && bin.type === 'Orgânico');
    assert.deepEqual(await visibleBinIds(page), priorityOrder(expected));
    await page.click('#reset-bins');
    const point = applied.model.bins[0];
    await page.click(`#bin-list .bin-card[data-id="${point.id}"]`);
    await assertPointDetails(page, range, point.id);
    await page.click('#close-point');
    await page.click('[data-view="projeto"]');
    await page.click('[data-view="dashboard"]');
    await assertConsistent(page, range);
  });
});

test('datas inválidas preservam o período aplicado; um único dia sem base não inventa comparação', async () => {
  await withPage(async page => {
    const initial = await assertConsistent(page, 7);
    await page.selectOption('#period', 'custom');
    await page.fill('#start-date', '2026-10-20');
    await page.fill('#end-date', '2026-10-01');
    await page.click('#apply-period');
    assert.equal(await page.locator('#period-error').isVisible(), true);
    assert.ok((await page.textContent('#period-error')).trim().length > 0);
    const unchanged = await assertConsistent(page, 7, 'custom');
    assert.deepEqual({ ...unchanged, selected: '7' }, initial);

    await page.fill('#start-date', '2026-08-30');
    await page.fill('#end-date', '2026-09-05');
    await page.click('#apply-period');
    await assertConsistent(page, 7, 'custom');
    await page.fill('#start-date', '');
    await page.click('#apply-period');
    await assertConsistent(page, 7, 'custom');

    const range = { start: '2026-08-31', end: '2026-08-31' };
    const single = await applyCustomPeriod(page, range);
    assert.equal(single.model.chart.length, 1);
    assert.equal(single.model.deltas.volumePercent, null);
    assert.equal(single.model.deltas.recyclePoints, null);
    assert.match(await page.textContent('#volume-delta'), /sem base/i);
    assert.match(await page.textContent('#recycle-delta'), /sem base/i);
    const point = single.model.bins[0];
    await page.click(`#bin-list .bin-card[data-id="${point.id}"]`);
    await assertPointDetails(page, range, point.id);
  });
});

test('lista mostra 12 lixeiras priorizadas; filtros combinam sem alterar indicadores e podem ser limpos', async () => {
  await withPage(async page => {
    const initial = await assertConsistent(page, 7);
    assert.equal(initial.model.bins.length, 12);
    assert.deepEqual(await visibleBinIds(page), priorityOrder(initial.model.bins));
    assert.match(await page.textContent('#bin-count'), /12 de 12/);
    await page.fill('#bin-search', 'Torre');
    await page.selectOption('#bin-type', 'Orgânico');
    await page.selectOption('#bin-status', 'normal');
    const expected = initial.model.bins.filter(bin => bin.name.includes('Torre')
      && bin.type === 'Orgânico' && bin.level === 'normal');
    assert.ok(expected.length > 0 && expected.length < 12);
    assert.deepEqual(await visibleBinIds(page), priorityOrder(expected));
    assert.ok((await page.textContent('#bin-count')).includes(`${expected.length} de 12`));
    assert.deepEqual(await assertConsistent(page, 7), initial);
    await page.fill('#bin-search', 'local inexistente xyz');
    assert.deepEqual(await visibleBinIds(page), []);
    assert.equal(await page.locator('#bins-empty').isVisible(), true);
    assert.match(await page.textContent('#bin-count'), /0 de 12/);
    await page.click('#reset-bins');
    assert.equal(await page.inputValue('#bin-search'), '');
    assert.equal(await page.inputValue('#bin-type'), 'all');
    assert.equal(await page.inputValue('#bin-status'), 'all');
    assert.equal(await page.locator('#bins-empty').isVisible(), false);
    assert.deepEqual(await visibleBinIds(page), priorityOrder(initial.model.bins));

    await page.fill('#bin-search', 'Torre');
    await page.selectOption('#bin-status', 'review');
    await page.selectOption('#period', '30');
    const month = await assertConsistent(page, 30);
    assert.equal(await page.inputValue('#bin-search'), 'Torre');
    assert.equal(await page.inputValue('#bin-status'), 'review');
    assert.deepEqual(await visibleBinIds(page), priorityOrder(month.model.bins.filter(bin =>
      bin.name.includes('Torre') && bin.level === 'review')));
  });
});

test('alertas e cartões abrem detalhes coerentes, com histórico, fechamento e retorno do foco', async () => {
  await withPage(async page => {
    const state = await assertConsistent(page, 7);
    const alert = state.model.alerts[0];
    const alertSelector = `#alert-list .alert[data-id="${alert.id}"]`;
    await page.focus(alertSelector);
    await page.keyboard.press('Enter');
    await assertPointDetails(page, 7, alert.id);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#point-dialog').evaluate(dialog => dialog.open), false);
    assert.equal(await page.locator(alertSelector).evaluate(element => element === document.activeElement), true);
    const normal = state.model.bins.find(bin => bin.level === 'normal');
    const cardSelector = `#bin-list .bin-card[data-id="${normal.id}"]`;
    await page.click(cardSelector);
    await assertPointDetails(page, 7, normal.id);
    await page.click('#close-point');
    assert.equal(await page.locator(cardSelector).evaluate(element => element === document.activeElement), true);
    await page.click(cardSelector);
    await page.evaluate(() => {
      const select = document.querySelector('#period');
      select.value = '14';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal(await page.locator('#point-dialog').evaluate(dialog => dialog.open), false);
    await assertConsistent(page, 14);
    await page.click(cardSelector);
    await assertPointDetails(page, 14, normal.id);
  });
});

for (const width of [320, 375, 650, 768, 1024, 1440]) {
  test(`responsividade em ${width}px: controles, tabela, alertas e diálogo acessíveis`, async () => {
    await withPage(async page => {
      async function assertFits(selectors) {
        const geometry = await page.evaluate(selectors => ({
          viewport: document.documentElement.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
          elements: selectors.flatMap(selector => [...document.querySelectorAll(selector)]).map(element => {
            const rect = element.getBoundingClientRect();
            return {
              element: element.id || element.className,
              left: rect.left,
              right: rect.right,
              width: rect.width,
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
            };
          }),
        }), selectors);
        assert.ok(geometry.documentWidth <= geometry.viewport + 1,
          `Documento excede a largura: ${JSON.stringify(geometry)}`);
        for (const element of geometry.elements) {
          assert.ok(element.width > 0, `${element.element} sem largura visível`);
          assert.ok(element.left >= -1 && element.right <= geometry.viewport + 1,
            `Elemento fora da tela: ${JSON.stringify(element)}`);
          assert.ok(element.scrollWidth <= element.clientWidth + 1,
            `Conteúdo cortado: ${JSON.stringify(element)}`);
        }
      }

      for (const period of [7, 30]) {
        await page.selectOption('#period', String(period));
        await assertConsistent(page, period);
        await assertFits(['#period', '#routeBtn', '.nav-btn', '#alert-list .alert', '.kpi']);
        if (process.env.CAPTURE_SCREENSHOTS === '1' && [375, 768, 1440].includes(width)) {
          await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
          await page.screenshot({ path: path.join(root, `artifacts/dashboard-${width}-${period}.png`), fullPage: true });
        }
        const details = page.locator('details').filter({ has: page.locator('#chart-table-body') });
        await details.locator('summary').click();
        await assertFits(['#chart-table-body']);
        await details.locator('summary').click();
        await page.click('#routeBtn');
        await assertRoute(page, period);
        await assertFits(['#route-dialog', '#close-route', '#route-stops']);
        await page.click('#close-route');
      }
      await page.click('[data-view="projeto"]');
      await assertFits(['#projeto .card', '.nav-btn']);
    }, { width, height: width <= 650 ? 812 : 1000 });
  });
}
