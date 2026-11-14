# Grefinacia

Controle financeiro pessoal e investimentos (B3) para Android, feito com Capacitor 8 + React + TypeScript.
Os dados ficam só no aparelho (IndexedDB no armazenamento privado do app).

## Gerar o APK

**Opção A: no seu computador** (Node 22, JDK 21 e Android Studio instalados)

```bash
npm install
npm test                 # testes de cálculo e de segurança
npm run android:sync     # compila a interface e copia para o projeto Android
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Ou `npm run android:open` para abrir no Android Studio e instalar direto no S26 Ultra pelo cabo.

**Opção B: sem instalar nada** — crie um repositório no GitHub, envie esta pasta e abra a aba *Actions*.
O fluxo "Gerar APK" (`.github/workflows/build-apk.yml`) compila e deixa o `app-debug.apk` para download.

Para testar no navegador do computador: `npm run dev`.

## O que funciona hoje

| Módulo | Situação |
|---|---|
| Painel, movimentações, cartões, parcelas, recorrências | Funcional |
| Plano salarial, reservas, orçamento por categoria | Funcional |
| Dívidas: prioridade, extra mensal, antecipação, portabilidade, avalanche × bola de neve | Funcional |
| Bolsa (ações, FIIs, ETFs), preço médio, renda fixa com estimativa e IR | Funcional |
| Dividendos: previsão, calendário, histórico, confirmação de recebimento | Funcional (cadastro manual sempre disponível) |
| Grefinacia AI | Chat local por cálculo (IA externa paga desligada nesta fase) |
| Fechamento mensal, PDF mensal/anual, planilha CSV | Funcional |
| PIN, biometria, bloqueio automático, backup AES-256 | Funcional (biometria só no aparelho) |
| Notificações Android | Agendadas localmente; ver limites abaixo |
| Open Finance, pagamentos automáticos, sincronização em nuvem | **Não incluído**: exige provedor autorizado e servidor |

## Limites que você precisa conhecer

- **Não testado em aparelho.** O ambiente onde o app foi escrito não compila Android. A lógica e as telas foram
  testadas em navegador (412 px); notificações, biometria, compartilhamento de arquivos e o verificador em
  segundo plano dependem de plugins nativos e só podem ser validados no celular.
- **APIs de cotação não foram chamadas de verdade.** O código segue a documentação da brapi.dev e foi testado
  com respostas simuladas nos testes; a primeira consulta real será a sua.
- **brapi.dev, plano gratuito:** 1 ativo por consulta e **sem dados de dividendos** (exigem Startup ou Pro).
  Alternativas dentro do app: cadastro manual ou Yahoo Finance (não oficial, sem data de pagamento).
- **Cotações têm atraso**, não são tempo real.
- **Avisos de "provento anunciado"** dependem de o Android executar a verificação em segundo plano (a cada ~6 h,
  sem garantia). Na Samsung, coloque o app como "Não restrito" em Bateria.
- **Estimativas de dividendos, renda fixa e projeções** são contas sobre histórico ou sobre taxas que você digita.
  Não são valores garantidos.
- **IR sobre JCP** é calculado a 15%; confira a regra vigente.

## Estrutura

```
src/lib        dinheiro em centavos, datas, tipos
src/domain     regras de negócio puras (testadas em tests/)
src/services   cotações, notificações, segurança, backup, PDF, IA
src/db         IndexedDB
src/state      estado do app e ações
src/ui         telas
public/runners verificação de proventos em segundo plano
android        projeto Android gerado pelo Capacitor
```

## Documentação

- [Planejamento e auditoria](docs/PLANEJAMENTO.md)
- [Segurança, assinatura do APK e atualização sem perder dados](docs/SEGURANCA.md)
