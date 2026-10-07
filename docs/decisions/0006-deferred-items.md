# ADR 0006 — Itens adiados conscientemente na Fase 1

- Status: aceito
- Data: 2026-10-07
- Fase: 1

| Item | Motivo | Quando |
|---|---|---|
| Row-Level Security (camada 3 de isolamento) | Opcional pela spec; as camadas 1 e 2 já falham fechadas. Exige `SET app.current_org` por transação junto com o adapter `pg`. | Avaliar na Fase 3 |
| Particionamento mensal de `events` | O Prisma não gerencia tabelas particionadas; sem volume real ainda. | Fase 6 |
| `idempotency_key` em `notifications` | Coluna criada com `UNIQUE(app_id, idempotency_key)`. O fluxo de `/send` pode exigir uma tabela própria de idempotência. | Fase 5 |
| BullMQ no worker | Não há jobs reais na Fase 1. | Fase 5 |
| OpenTelemetry, métricas Prometheus, Sentry | Dependem das rotas e jobs reais para ter valor. | Fase 7 (logs estruturados e correlation id já existem) |
| Papel de banco para o job de retenção | O trigger já protege a auditoria. | Fase 7 |
| Frontend (`apps/web`) | Começa com as telas de login. | Fase 2 |
