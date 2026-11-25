# EcoCondomínio IA

**Entrega 2 de Laboratório de Projeto de Software · PUC-SP · Grupo 4**

Protótipo acadêmico que monitora 12 pontos de coleta de um condomínio. O dashboard
acompanha ocupação e volume de resíduos, prevê lotação e organiza a coleta
interna. As leituras, o mapa e as estimativas usam dados fictícios.

## Executar localmente

1. Extraia a pasta inteira do ZIP da entrega.
2. No Windows de 64 bits, dê dois cliques em **Iniciar-Windows.bat**. O ZIP portátil inclui o Node.js.
3. Mantenha a janela aberta e acesse [127.0.0.1:8765](http://127.0.0.1:8765) se o navegador não abrir automaticamente.

No macOS, Linux ou em um checkout do GitHub, use **Node.js 24 ou superior**
e execute na pasta do projeto:

```sh
node server.cjs
```

SQLite e servidor HTTP usam módulos nativos do Node.js. Para executar o app,
basta o runtime. A aplicação escuta em `127.0.0.1` e cria
`data/ecocondominio.sqlite` automaticamente no primeiro uso.
`ECO_PORT` permite escolher outra porta e `ECO_DB_PATH`, outro arquivo de banco.
Abrir `index.html` diretamente carrega a demonstração estática com armazenamento
do navegador, mantida para a publicação estática do projeto.

## Roteiro de demonstração

1. Troque entre 7, 14, 30 dias ou um intervalo personalizado. O filtro afeta os indicadores históricos e o gráfico. A ocupação e os alertas operacionais mostram o último estado disponível.
2. Gere uma rota. A primeira parada no banco recém-criado é **Torre B — Orgânico (94%)**. Abra a parada, informe o responsável e registre a coleta. A ocupação zera, o alerta fecha e a rota salva registra a parada atendida.
3. Veja o registro em **Registro de coletas**. Feche e reabra o servidor para verificar a persistência no SQLite.
4. No detalhe da Torre B, envie uma nova leitura simulada de **94%** para abrir um novo alerta. Leituras com mais de 30 minutos ficam fora da rota. **Atualizar leituras simuladas** renova os horários mantendo os níveis atuais.

Os indicadores usam 60 dias de leituras diárias fictícias (31/08 a 29/10/2026).
Volume, reciclagem e economia correspondem a esse histórico. As leituras ao
vivo simuladas alteram ocupação, alertas e rota. O histórico operacional de
coletas mostra os registros SQLite dos últimos 90 dias.

A previsão das próximas 24 horas usa uma regra local que extrapola a
tendência positiva. A rota prioriza níveis críticos (90% ou mais), altos
(80% a 89%) e pontos com previsão de pelo menos 90%. Para desempate,
considera previsão, distância de Manhattan no mapa fictício e identificador.
O MVP local usa um único condomínio e o responsável informado na tela.

## Documentação e testes

- [Entrega 2 em PDF](docs/Entrega2_LPS_EcoCondominio_IA.pdf) — modelo de domínio, casos de uso, diagramas de sequência e contratos de operações.
- [Planejamento original](docs/Planejamento_EcoCondominio_IA.pdf) e [validação do protótipo anterior](docs/VALIDACAO_MVP_2026-10-29.md).
- `npm test` roda os testes do dashboard e do SQLite com o Node.js 24, sem dependências externas.
- Para a suíte de interface existente, use `npm ci` e `npm run test:ui`. Ela usa Playwright e Chrome. Para usar o Edge, configure `BROWSER_CHANNEL=msedge`.
