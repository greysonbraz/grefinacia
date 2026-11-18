# Grefinacia — Purple Edition (sistema visual)

Tokens em `src/styles.css` (`:root` escuro e `[data-theme='light']`). Componentes em `src/ui/kit.tsx`.

## Cor
| Papel | Escuro | Claro | Uso |
|---|---|---|---|
| Fundo / fundo 2 | #0B0914 / #12101E | #F6F4FB / #EFEBF8 | tela |
| Superfície / elevada | #1A1729 / #211C35 | #FFFFFF / #F1EDFA | grupos, cartões |
| Texto / secundário | #F8FAFC / #A1A1AA | #15121F / #5B5670 | 6,4:1 ou mais nas superfícies |
| Roxo de ação (`--accent`) | #A78BFA (texto escuro em cima, 7,3:1) | #6D28D9 (texto branco, 7,1:1) | botão principal, seleção, foco, links |
| Roxo forte / profundo | #8B5CF6 / #6D28D9 | #7C3AED / #5B21B6 | linha do patrimônio, brilho do destaque |
| Positivo / negativo / atenção | #22C55E / #F87171 / #FBBF24 | #15803D / #C8283A / #9A6700 | valores e estados |
| Séries de gráfico | violeta, azul-céu, verde, âmbar, rosa, índigo, laranja, vermelho | versões escuras | categorias |

Regras: o roxo marca ação, seleção, gráfico e a Grefinacia AI; superfícies ficam neutras. Degradê só no destaque do patrimônio (um brilho radial). Texto branco sobre #8B5CF6 não passa no contraste (4,05:1): não usar.

## Tipo
Geist (variável), uma família. Números com algarismos tabulares (`.num`). Escala: 38 (patrimônio) · 22–24 (título) · 20 (valores de destaque) · 16 (seções) · 15 (corpo) · 13 · 12.

## Forma e espaço
Cantos: 10 · 14 · 20 · 26 (`--r-*`). Áreas de toque ≥ 44px; barra de baixo 56px. Margem lateral 16px.
Listas e resumos em grupos com divisórias (`.group`), não um cartão por número. O destaque do patrimônio é o único bloco com brilho.

## Movimento
150–220 ms, saída suave (`--ease`). Só para mudança de estado: toque, troca de aba, abrir/fechar, valor que muda (`CountMoney`, 450 ms). "Reduzir movimento" do Android mantém as mudanças sem deslocamento.

## Comportamento
- Olho no Início: oculta todos os valores e gráficos (`data-hide`).
- Botão voltar do Android fecha a janela/tela aberta; sem nenhuma, volta ao Início; no Início, minimiza.
- Vibração leve ao trocar de aba e confirmar/errar uma ação (só no Android).
