/* A single synchronous render keeps every view on the same period snapshot. */
(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  const money = new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
  });
  const levels = { critical: 'Crítico', high: 'Alto', review: 'Revisar' };
  const dialog = $('#route-dialog');
  let current;
  let selectedBin;
  const collectionKey = 'ecocondominio.collections.v1';

  function collectionRecords() {
    const records = JSON.parse(localStorage.getItem(collectionKey) || '[]');
    const cutoff = Date.now() - 90 * 86400000;
    return records.filter(record => record && typeof record.name === 'string' && Date.parse(record.at) >= cutoff);
  }

  function renderCollections() {
    const list = $('#collection-list');
    list.replaceChildren();
    try {
      const records = collectionRecords().reverse();
      for (const record of records) {
        list.append(element('li', '', `${record.name} · ${new Date(record.at).toLocaleString('pt-BR')}`));
      }
      $('#collection-status').textContent = records.length ? '' : 'Nenhuma coleta registrada neste navegador.';
    } catch {
      $('#collection-status').textContent = 'O histórico local de coletas está indisponível.';
    }
  }

  function renderForecast() {
    const list = $('#forecast-list');
    list.replaceChildren();
    $('#forecast-context').textContent = `Estimativa simulada para o dia seguinte a ${date(current.end)}, usando até sete leituras.`;
    const risks = current.bins.map(bin => {
      const readings = bin.history.slice(-7);
      const first = readings[0].occupancy;
      const dailyGrowth = Math.max(0, (bin.occupancy - first) / Math.max(1, readings.length - 1));
      return {bin, estimate: Math.min(100, Math.round(bin.occupancy + dailyGrowth))};
    }).filter(risk => risk.estimate >= 80).sort((a, b) => b.estimate - a.estimate);
    for (const {bin, estimate} of risks) {
      const item = element('li');
      const button = element('button', 'btn', `${bin.name} · ${bin.occupancy}% → ${estimate}%`);
      button.type = 'button';
      button.onclick = () => openPoint(bin);
      item.append(button);
      list.append(item);
    }
    if (!risks.length) list.append(element('li', '', 'Nenhum ponto estimado em 80% ou mais.'));
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function date(iso, year = false) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}${year ? `/${y}` : ''}`;
  }

  function range(start, end) {
    return start === end ? date(start) : `${date(start)}–${date(end)}`;
  }

  function delta(value, unit) {
    if (value === null) return 'Sem base de comparação no período anterior';
    const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '→';
    return `${arrow} ${number.format(Math.abs(value))}${unit} vs. período anterior`;
  }

  function render(period) {
    const model = window.EcoDashboard.getDashboardModel(period);
    // Dismiss any recommendation from the previous snapshot before publishing the next.
    if (dialog.open) dialog.close();
    current = model;
    renderForecast();
    $('#period').value = model.selection;
    $('#custom-period').classList.toggle('hidden', model.selection !== 'custom');
    $('#start-date').value=model.start; $('#end-date').value=model.end;
    if ($('#point-dialog').open) $('#point-dialog').close();
    $('#period-range').textContent = `${date(model.start)} a ${date(model.end, true)} · demonstração`;
    $('#volume').textContent = `${number.format(model.volumeKg)} kg`;
    $('#recycle').textContent = `${number.format(model.recyclePercent)}%`;
    $('#saving').textContent = money.format(model.saving);
    $('#volume-delta').textContent = delta(model.deltas.volumePercent, '%');
    $('#recycle-delta').textContent = delta(model.deltas.recyclePoints, ' p.p.');
    const comparison = model.previousStart ? `Comparação com ${date(model.previousStart)} a ${date(model.previousEnd, true)}` : 'Histórico anterior insuficiente';
    $('#volume-delta').title = comparison;
    $('#recycle-delta').title = comparison;
    $('#saving-detail').textContent = `${model.avoidedTrips} visitas evitadas × R$ 30 (simulação)`;
    $('#alerts').textContent = model.alerts.length;
    $('#alert-summary').textContent = `${model.attentionCount} para coleta · ${model.alerts.length - model.attentionCount} para revisão`;
    $('#alert-count').textContent = `${model.alerts.length} de ${model.pointCount}`;
    $('#alert-sub').textContent = `Ocupação em ${date(model.end)} · padrões nos últimos ${model.period} dias`;
    $('#chart-sub').textContent = model.period === 7
      ? 'Quilos coletados por dia · últimos 7 dias'
      : `Quilos coletados em ${model.chart.length} intervalos · ${model.period} dias (datas na tabela)`;
    const trend = model.deltas.volumePercent;
    $('#trend').textContent = `Tendência: ${trend === null ? 'sem base' : trend > 5 ? 'alta' : trend < -5 ? 'queda' : 'estável'}`;
    $('#trend').title = 'Variação do volume frente ao período anterior: estável entre −5% e +5%. Regra simulada.';

    const chart = document.createDocumentFragment();
    const rows = document.createDocumentFragment();
    const maximum = Math.max(1, ...model.chart.map((item) => item.kg));
    model.chart.forEach((item) => {
      const label = range(item.start, item.end);
      const description = `${label}: ${number.format(item.kg)} kg`;
      const wrap = element('div', 'bar-wrap');
      const bar = element('div', 'bar');
      bar.style.height = `${(item.kg / maximum) * 85}%`;
      bar.dataset.kg = String(item.kg);
      bar.title = description;
      const labelNode = element('span', 'bar-label');
      labelNode.append(element('span', '', date(item.start)));
      if (item.end !== item.start) labelNode.append(element('span', '', date(item.end)));
      wrap.append(bar, labelNode);
      chart.append(wrap);
      const row = element('tr');
      const heading = element('th', '', label);
      heading.scope = 'row';
      row.append(heading, element('td', '', number.format(item.kg)));
      rows.append(row);
    });
    $('#chart').replaceChildren(chart);
    $('#chart').setAttribute('aria-label', `Gráfico de resíduos: ${number.format(model.volumeKg)} kg em ${model.period} dias. Valores detalhados na tabela a seguir.`);
    $('#chart-caption').textContent = `Total: ${number.format(model.volumeKg)} kg · ${range(model.start, model.end)}`;
    $('#chart-table-body').replaceChildren(rows);

    const alerts = document.createDocumentFragment();
    model.alerts.forEach((alert) => {
      const critical = alert.level === 'critical';
      const row = element('button', `alert${critical ? ' danger' : ''}`);
      row.dataset.id = alert.id;
      const icon = element('div', 'alert-icon', '●');
      icon.setAttribute('aria-hidden', 'true');
      const detail = element('div');
      detail.append(element('strong', '', alert.name), element('small', '', alert.reason));
      row.append(icon, detail, element('span', `level${critical ? ' red' : ''}`, levels[alert.level]));
      alerts.append(row);
    });
    if (!model.alerts.length) alerts.append(element('p', 'sub', 'Nenhum ponto exige atenção neste período.'));
    $('#alert-list').replaceChildren(alerts);
    $('#route-summary').textContent = `${model.route.stops.length} pontos priorizados: coleta por ocupação, seguida de revisão dos padrões incomuns.`;
    $('#routeBtn').disabled = !model.route.stops.length;
    renderBins();
    $('#update-status').textContent = `Visão de ${model.period} dias atualizada: ${number.format(model.volumeKg)} kg e ${model.alerts.length} alertas.`;
  }

  $('#period').addEventListener('change', (event) => { if(event.target.value==='custom') { $('#custom-period').classList.remove('hidden'); return; } render(event.target.value); });
  $('#custom-period').addEventListener('submit',e=>{e.preventDefault();try{render({start:$('#start-date').value,end:$('#end-date').value});$('#period-error').textContent='';}catch(error){$('#period-error').textContent=error.message;}});
  $('#cancel-period').onclick=()=>{ $('#custom-period').classList.add('hidden'); $('#period').value=current.selection; };
  function renderBins(){
    const totals = new Map();
    for (const bin of current.bins) totals.set(bin.type, (totals.get(bin.type) || 0) + bin.volumeKg);
    const mix = $('#waste-mix');
    const focusedType = mix.contains(document.activeElement) ? document.activeElement.dataset.type : null;
    mix.replaceChildren();
    for (const [type, kg] of totals) {
      const button = element('button', 'mix-btn', type);
      button.type = 'button';
      button.dataset.type = type;
      button.append(element('span', '', `${number.format(kg)} kg`));
      button.setAttribute('aria-pressed', String($('#bin-type').value === type));
      button.onclick = () => {
        $('#bin-type').value = $('#bin-type').value === type ? 'all' : type;
        renderBins();
      };
      mix.append(button);
      if (focusedType === type) button.focus();
    }
    const query=$('#bin-search').value.toLocaleLowerCase('pt-BR');
    const bins=current.bins.filter(b=>b.name.toLocaleLowerCase('pt-BR').includes(query)&&($('#bin-type').value==='all'||b.type===$('#bin-type').value)&&($('#bin-status').value==='all'||b.level===$('#bin-status').value));
    bins.sort((a,b)=>({critical:0,high:1,review:2,normal:3}[a.level]-{critical:0,high:1,review:2,normal:3}[b.level])||b.occupancy-a.occupancy||a.id.localeCompare(b.id));
    $('#bin-count').textContent=`${bins.length} de ${current.bins.length}`;
    $('#bins-context').textContent=`Ocupação em ${date(current.end)} · volumes de ${range(current.start,current.end)}`;
    $('#bin-list').replaceChildren();
    bins.forEach(b=>{const card=element('button','bin-card');card.dataset.id=b.id;card.type='button';card.append(element('strong','',b.name),element('p','',`${b.occupancy}% de ocupação · ${levels[b.level]||'Normal'}`),element('small','',`${number.format(b.volumeKg)} kg no período · Ver histórico`));card.onclick=()=>openPoint(b);$('#bin-list').append(card);});
    if(!bins.length){const empty=element('p','empty','Nenhuma lixeira encontrada. Limpe os filtros para ver todos os pontos.');empty.id='bins-empty';$('#bin-list').append(empty);}
  }
  function openPoint(b){
    selectedBin = b;
    $('#point-collection-status').textContent = '';
    $('#record-collection').disabled = false;
    $('#point-title').textContent=b.name;$('#point-type').textContent=b.type;
    $('#point-period').textContent=`${range(current.start,current.end)} · ${current.period} dias`;
    $('#point-occupancy').textContent=b.occupancy+'%';$('#point-volume').textContent=number.format(b.volumeKg)+' kg';
    $('#point-peak').textContent=Math.max(...b.history.map(h=>h.occupancy))+'%';
    $('#point-reason').textContent=b.reason;$('#point-action').textContent=b.action;
    $('#point-history-table').replaceChildren();b.history.forEach(h=>{const row=element('tr');row.append(element('td','',date(h.date)),element('td','',number.format(h.kg)),element('td','',h.occupancy+'%'));$('#point-history-table').append(row);});
    renderHistory(b.history);
    $('#point-dialog details').open=true;
    $('#point-dialog').showModal();
  }
  function renderHistory(history) {
    const chart = $('#point-history');
    chart.replaceChildren();
    function draw(tag, attributes, label) {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      if (label) node.textContent = label;
      chart.append(node);
    }
    const y = (value) => 150 - value * 1.3;
    const x = (index) => history.length === 1 ? 320 : 65 + index * 550 / (history.length - 1);
    for (const value of [0, 50, 100]) {
      draw('line', {x1: 65, x2: 615, y1: y(value), y2: y(value), stroke: '#dfe7e9'});
      draw('text', {x: 55, y: y(value) + 6, 'text-anchor': 'end', 'font-size': 20, fill: '#526071'}, value + '%');
    }
    const points = history.map((reading, index) => `${x(index)},${y(reading.occupancy)}`);
    draw('polyline', {points: points.join(' '), fill: 'none', stroke: '#168b66', 'stroke-width': 4});
    const last = history.length - 1;
    draw('circle', {cx: x(last), cy: y(history[last].occupancy), r: 6, fill: '#168b66'});
    draw('text', {x: x(0), y: 176, 'text-anchor': history.length === 1 ? 'middle' : 'start', 'font-size': 20, fill: '#526071'}, date(history[0].date));
    if (last) draw('text', {x: x(last), y: 176, 'text-anchor': 'end', 'font-size': 20, fill: '#526071'}, date(history[last].date));
  }
  ['bin-search','bin-type','bin-status'].forEach(id=>$('#'+id).addEventListener(id==='bin-search'?'input':'change',renderBins));
  $('#reset-bins').onclick=()=>{$('#bin-search').value='';$('#bin-type').value='all';$('#bin-status').value='all';renderBins();};
  $('#alert-list').addEventListener('click',e=>{const row=e.target.closest('[data-id]');if(row)openPoint(current.bins.find(b=>b.id===row.dataset.id));});

  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.addEventListener('click', () => {
      if (dialog.open) dialog.close();
      document.querySelectorAll('.nav-btn').forEach((item) => {
        item.classList.toggle('active', item === button);
        item.removeAttribute('aria-current');
      });
      button.setAttribute('aria-current', 'page');
      document.querySelectorAll('main > section').forEach((section) => {
        section.classList.toggle('hidden', section.id !== button.dataset.view);
      });
    });
  });
  $('#routeBtn').addEventListener('click', () => {
    const stops = document.createDocumentFragment();
    // Mapa fictício com corredores ortogonais de 15 m entre pontos.
    let position = {x: 0, y: 0};
    let distance = 0;
    current.route.stops.forEach((stop) => {
      const index = window.EcoDashboard.POINTS.findIndex(point => point.id === stop.id);
      const next = {x: (index % 4) + 1, y: Math.floor(index / 4)};
      const leg = 15 * (Math.abs(next.x - position.x) + Math.abs(next.y - position.y));
      distance += leg;
      position = next;
      const item = element('li');
      item.dataset.id = stop.id;
      item.append(element('strong', '', `${stop.name} · ${levels[stop.level]}`), element('small', '', `${stop.reason} · trecho estimado: ${leg} m`));
      stops.append(item);
    });
    $('#route-stops').replaceChildren(stops);
    $('#route-context').textContent = `${date(current.start)} a ${date(current.end, true)} · ${distance} m estimados da base até a última parada · mapa simulado`;
    dialog.showModal();
  });

  $('#record-collection').onclick = () => {
    if (!selectedBin) return;
    try {
      const records = collectionRecords();
      records.push({id: selectedBin.id, name: selectedBin.name, at: new Date().toISOString()});
      localStorage.setItem(collectionKey, JSON.stringify(records));
      $('#point-collection-status').textContent = 'Coleta registrada com o horário atual.';
      $('#record-collection').disabled = true;
      renderCollections();
    } catch {
      $('#point-collection-status').textContent = 'Não foi possível gravar a coleta neste navegador.';
    }
  };
  render($('#period').value);
  renderCollections();
})();
