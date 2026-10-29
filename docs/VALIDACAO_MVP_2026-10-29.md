# Validação do marco de 29/10/2026

Marco: **Weekly 7 / Sprint Review 3**. Verificação técnica realizada em 28/10/2026
para a entrega de 29/10, usando o snapshot simulado fixo nessa data.

## Ambiente e execução

- Windows, Node.js 22.19.0, Playwright 1.62.1, Google Chrome headless.
- Página carregada diretamente por `file://`, sem backend, build ou rede para dados.
- `npm test`: 15 testes aprovados.
- `npm run test:ui`: 10 testes aprovados; nenhum erro de console ou JavaScript.
- Inspeção visual das capturas de 375, 768 e 1440 px, em 7 e 30 dias, comparada ao dashboard original.

## Cenários

| Cenário | Resultado |
| --- | --- |
| Série diária e interseção 7/30 | Datas consecutivas; mesmos dados nos dias compartilhados. |
| Agregação do gráfico | Soma das barras igual ao volume; 30 dias cobertos exatamente uma vez. |
| Indicadores e comparações | Totais e reciclagem ponderada derivados da janela; comparação com janela anterior de igual duração. |
| Limiares de ocupação | 79% sem alerta de ocupação; 80% alto; 89% alto; 90% crítico. |
| Padrão incomum | Exige aumento simultâneo de 50% e 5 kg; último dia excluído da média histórica. |
| Contagem e prioridade | Lista, contador, resumo e recomendação concordam; nenhum ponto duplicado. |
| Reversibilidade | 7 → 30 → 7 recupera o estado inicial; modelo verificado em 50 repetições. |
| Trocas rápidas na interface | 20 alterações consecutivas e espera após a transição sem estado obsoleto. |
| Recomendação | Ordem igual à lista; contexto do período; fecha com Escape/botão e devolve foco. |
| Atualização com diálogo aberto | Fecha a recomendação anterior; reabertura mostra a nova janela. |
| Navegação | “Como funciona” e retorno mantêm período; `aria-current` acompanha a seleção. |
| Teclado | Seletor por setas/Enter e navegação por Enter funcionam. |
| Tabela do gráfico | Abre e fecha; linhas correspondem às barras e permanecem dentro da tela. |

## Responsividade e inspeção de usabilidade

As duas visões foram verificadas em **320, 375, 650, 768, 1024 e 1440 px**.
Não houve rolagem horizontal do documento, controles cortados ou diálogo fora
da largura disponível. Painel, cartões, navegação, tabela e recomendação continuaram utilizáveis.
O espaçamento entre resumo da rota e botão foi ajustado após inspeção visual.

A revisão preservou cores, estrutura de cartões e navegação do original. A
interface identifica os dados como simulados também no celular, explica os
critérios dos alertas e distingue a recomendação de uma rota geográfica otimizada.
O gráfico de 30 dias informa que o último intervalo contém somente dois dias.

Capturas de referência após a validação:

- [Desktop, 30 dias](evidencias/dashboard-desktop-30.png)
- [Celular, 30 dias](evidencias/dashboard-mobile-30.png)

## Pendência aberta — 05/11

**UI-01: legibilidade do gráfico em telas menores.** Rótulos compactos e quebra
dos intervalos em duas linhas permanecem para refinamento de espaçamento e
tipografia. A tabela é uma alternativa de consulta, não a conclusão desse ajuste.
Os dados e as interações estão consistentes; a apresentação visual do gráfico
em celular ainda requer a rodada final de UI/UX.

Não foram realizados testes com participantes, sensores reais, cargas de backend
ou todos os navegadores/dispositivos físicos. A validação acima é técnica e
reproduzível e não deve ser apresentada como pesquisa de usabilidade com usuários.
