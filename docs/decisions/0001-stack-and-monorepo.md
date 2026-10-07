# ADR 0001 — Stack, versões e monorepo

- Status: aceito
- Data: 2026-10-07
- Fase: 1

## Contexto

A seção 4.1 da especificação define a stack. Algumas versões publicadas em outubro de 2026 têm incompatibilidades no ecossistema.

## Decisão

- **pnpm workspaces + Turborepo**, pacotes ESM (`"type": "module"`), `module: NodeNext`.
- **TypeScript 6.0.x**, não 7.x: o `typescript-eslint` 8.x só aceita `typescript <6.1`. Reavaliar quando o lint suportar a 7.
- **Prisma 7.10** (estável), não 8.0: a tag `latest` do npm aponta para um release candidate.
- **Zod 4** com `fastify-type-provider-zod` 7; mensagens de validação em pt-BR (`z.locales.pt()`).
- Pacotes internos são compilados para `dist/` (o Node não executa TypeScript dentro de `node_modules`). O Turborepo ordena os builds (`dependsOn: ["^build"]`).
- `@notify/shared` tem dois pontos de entrada:
  - `.` — seguro para o navegador (enums, Problem Details, máscaras);
  - `./server` — só Node (validação de env, logger, correlation id).
  Assim o frontend reaproveita os tipos sem puxar dependências de servidor.
- Scripts de instalação de dependências são opt-in (`allowBuilds` em `pnpm-workspace.yaml`): apenas `prisma`, `@prisma/engines` e `esbuild`.
- O worker da Fase 1 é só o processo (env, conexões, heartbeat, desligamento). BullMQ entra na Fase 5, junto com os jobs reais.

## Consequências

- Migrar para TypeScript 7 ou Prisma 8 exige novo ADR.
- Testar um pacote exige o build das dependências dele; o `turbo` cuida disso.
