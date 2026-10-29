# EcoCondomínio IA

POC acadêmica do **Sistema Inteligente de Coleta de Lixo em condomínios**.
Este MVP representa o marco de **29/10/2026 — Weekly 7 / Sprint Review 3**:
dashboard estabilizado, períodos sincronizados e revisão de usabilidade e
responsividade realizada, com um refinamento visual planejado para 05/11.

Todos os dados são fictícios. A aplicação funciona inteiramente no navegador,
sem backend, sensores conectados, persistência ou modelo de IA em produção.
As recomendações demonstram regras de priorização, não uma otimização real de trajetos.

## Executar a versão desta branch

Abra `index.html` no navegador. Mantenha `dashboard-model.js` e `dashboard.js`
na mesma pasta; não é necessário instalar dependências para usar o dashboard.

Opcionalmente, com Python instalado, execute na raiz do repositório:

```sh
python -m http.server 8080 --bind 127.0.0.1
```

Acesse [http://localhost:8080](http://localhost:8080).

A [demonstração publicada anteriormente](https://ecocondominio-ia.felipegilaverte.chatgpt.site)
é uma versão de referência e **não recebe automaticamente as alterações desta branch**.
O deploy do marco atualizado permanece para a etapa de 05/11.

## Estado do MVP em 29/10

- Visual original preservado: paleta, navegação, cartões, gráfico e painel de alertas.
- Seleção de 7/30 dias atualiza, em uma única operação síncrona, indicadores,
  comparações, gráfico, contador, lista de alertas e recomendação.
- Retornar de “Como funciona” preserva o período; trocas rápidas não deixam dados antigos.
- Recomendações refletem os mesmos pontos e a mesma ordem dos alertas. O diálogo
  permanece aberto para leitura até ser fechado por botão ou Escape, com retorno do foco.
- Navegação e seletor utilizáveis por teclado; controles com nomes acessíveis,
  anúncio da atualização e tabela expansível com os valores do gráfico.
- POC revisada em computador, tablet e celular, de 320 a 1440 px de largura.

## Dados e regras da demonstração

Uma série determinística de 60 dias, de 31/08 a **29/10/2026**, contém medidas de
12 pontos. A data final é fixa para tornar a apresentação reproduzível, independentemente
da data do computador. Os 7 dias são exatamente o recorte final da janela de 30 dias.

| Indicador | Regra |
| --- | --- |
| Volume coletado | Soma dos quilos diários no período. |
| Reciclagem | Quilos recicláveis / volume total × 100; média ponderada pelo volume. |
| Comparações | Período anterior de igual duração, sem sobreposição; reciclagem em pontos percentuais. |
| Economia estimada | Cada leitura diária com ocupação abaixo de 40% representa uma visita evitada, avaliada ficticiamente em R$ 30. Não é uma economia financeira medida. |
| Tendência | Variação do volume em relação ao período anterior: alta acima de +5%, queda abaixo de −5%, estável no intervalo. Não é previsão de IA. |
| Ocupação crítica/alta | Última leitura do período: crítico a partir de 90%, alto de 80% a menos de 90%. |
| Padrão incomum | Volume do último dia pelo menos 50% e 5 kg acima da média dos dias anteriores da janela; ambos os critérios devem ser atendidos. |
| Prioridade | Crítico → alto → revisar; desempate por ocupação decrescente e identificador. Um ponto aparece apenas uma vez. |

Ocupações críticas e altas permanecem iguais ao trocar de período porque ambas
as janelas terminam na mesma data. Alertas de padrão incomum podem mudar porque
a base de comparação usa 6 ou 29 dias anteriores. Isso é esperado, e o texto de
cada alerta informa a média e a regra aplicadas. Pontos “Revisar” devem ser
verificados antes da coleta.

O gráfico usa **quilos reais da simulação**, com soma idêntica ao indicador de volume:

- 7 dias: sete barras diárias, de 23 a 29/10.
- 30 dias: cinco intervalos consecutivos, de 30/09 a 29/10, sem omissões ou duplicações.
  Os quatro primeiros contêm 7 dias e o último, 28–29/10, contém **somente 2 dias**;
  sua barra menor não indica necessariamente queda na demanda. A escala se ajusta
  a cada visão; compare valores e datas pela tabela, não alturas entre visões.

| Referência para apresentação | 7 dias | 30 dias |
| --- | --- | --- |
| Volume | 1.268 kg | 5.084 kg |
| Reciclagem exibida | 73,5% | 71,6% |
| Economia simulada | R$ 750 | R$ 3.300 |
| Alertas | 3 (2 para coleta + 1 revisão) | 4 (2 para coleta + 2 revisões) |

## Validação

Testes de regras usam apenas Node.js 20 ou superior:

```sh
npm test
```

Para os testes de interface, instale as dependências de desenvolvimento e use
Google Chrome instalado:

```sh
npm ci
npm run test:ui
```

Também é possível usar Microsoft Edge definindo `BROWSER_CHANNEL=msedge`.
No PowerShell: `$env:BROWSER_CHANNEL='msedge'; npm run test:ui`.
Para salvar capturas em `artifacts/`, defina `CAPTURE_SCREENSHOTS=1`.

Foram aprovados **15 testes de regras + 10 testes de interface** em Chrome headless.
O [registro de validação](docs/VALIDACAO_MVP_2026-10-29.md) descreve os cenários,
as larguras verificadas e os limites. São verificações técnicas e uma inspeção de
usabilidade; não representam pesquisa com usuários, teste de carga ou validação
com sensores reais.

## Pendência proposital para 05/11/2026

**Legibilidade do gráfico em telas menores:** revisar espaçamento entre barras e
rótulos, tamanho do texto e apresentação dos intervalos de 30 dias. Os rótulos
continuam compactos e podem quebrar em duas linhas no celular. A tabela permite
consultar os valores, mas não encerra o refinamento visual do gráfico.

Esse ajuste permanece aberto conforme o marco acadêmico; não bloqueia a troca
de períodos, os indicadores ou as recomendações. Para 05/11 estão previstos o
refinamento final de UI/UX, nova rodada de testes, deploy do MVP e retrospectiva.
Release final prevista para 12/11, sem ser declarada concluída nesta entrega.

## Estrutura

- `index.html`: interface e estilos originais com ajustes pontuais de usabilidade.
- `dashboard-model.js`: dados simulados, agregações e regras puras.
- `dashboard.js`: atualização síncrona da interface e navegação.
- `tests/`: regressão das regras e testes de interface.
- `docs/Planejamento_EcoCondominio_IA.pdf`: planejamento original da atividade.
- `docs/VALIDACAO_MVP_2026-10-29.md`: evidências da validação deste marco.

## Exploração interativa
Selecione 7, 14 ou 30 dias, ou Personalizado para aplicar datas entre 31/08 e 29/10/2026. Explore as 12 lixeiras com busca, filtros de tipo e situação. Clique em uma lixeira ou alerta para consultar ocupação, pico, volume e leituras diárias. Filtros afetam somente a lista; os indicadores permanecem globais. Intervalos sem histórico anterior completo não exibem comparação.
