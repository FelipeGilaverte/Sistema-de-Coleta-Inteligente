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
      wrap.append(bar, element('span', 'bar-label', item.label));
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
    $('#point-title').textContent=b.name;$('#point-type').textContent=b.type;
    $('#point-period').textContent=`${range(current.start,current.end)} · ${current.period} dias`;
    $('#point-occupancy').textContent=b.occupancy+'%';$('#point-volume').textContent=number.format(b.volumeKg)+' kg';
    $('#point-peak').textContent=Math.max(...b.history.map(h=>h.occupancy))+'%';
    $('#point-reason').textContent=b.reason;$('#point-action').textContent=b.action;
    $('#point-history-table').replaceChildren();b.history.forEach(h=>{const row=element('tr');row.append(element('td','',date(h.date)),element('td','',number.format(h.kg)),element('td','',h.occupancy+'%'));$('#point-history-table').append(row);});
    $('#point-history').classList.add('hidden');$('#point-dialog details').open=true;$('#point-dialog').showModal();
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
    current.route.stops.forEach((stop) => {
      const item = element('li');
      item.dataset.id = stop.id;
      item.append(element('strong', '', `${stop.name} · ${levels[stop.level]}`), element('small', '', stop.reason));
      stops.append(item);
    });
    $('#route-stops').replaceChildren(stops);
    $('#route-context').textContent = `${date(current.start)} a ${date(current.end, true)} · ${current.period} dias · dados simulados`;
    dialog.showModal();
  });

  render($('#period').value);
})();
