# ADR 0002 — Isolamento de tenant em três camadas

- Status: aceito
- Data: 2026-10-07
- Fase: 1
- Relacionado: V1-02, V1-03, seção 6.3

## Contexto

Na v1, um operador do painel A editava itens do painel B passando outro `appId` no corpo da requisição. A especificação pede que o tenant seja derivado do recurso, que FKs recebidas sejam validadas e que uma extensão do Prisma injete `organizationId` em toda query.

## Decisão

**Camada 1 — banco de dados (não depende do código estar certo).**

- `apps` tem `UNIQUE(id, organization_id)`. Toda tabela ligada a um painel referencia `(app_id, organization_id)`, então uma linha não pode apontar para um painel de outra organização.
- Relações obrigatórias entre entidades do mesmo painel usam FKs compostas com `app_id`. Exemplo: `notifications(firebase_integration_id, app_id) → firebase_integrations(id, app_id)`.
- `app_members(organization_id, user_id) → organization_members` garante que só membros da organização entram nos painéis dela (seção 7.1).
- Relações **opcionais** (`notifications.campaign_id`, `events.device_id` etc.) não podem ter FK composta no Prisma, que exige a relação obrigatória quando algum campo é obrigatório. Elas usam FK simples mais o trigger `notify_assert_same_app`.

**Camada 2 — extensão do Prisma (`packages/db/src/tenant`).**

- O escopo fica em um `AsyncLocalStorage`, definido com `withTenant({ organizationId, appId? }, fn)` ou `withSystemScope(motivo, fn)`.
- A função pura `applyTenantScope`:
  - injeta `organizationId`/`appId` no `where` e no `data`;
  - **lança erro** se o `where` ou o `data` apontar para outro tenant;
  - rejeita `connect` por relação (`app: { connect }`), que contornaria as checagens;
  - **lança erro** se não houver contexto (falha fechada), inclusive para SQL cru.
- Modelos de identidade (`User`, `RefreshToken`, `OneTimeToken`, `MfaRecoveryCode`) ficam fora do escopo porque são usados antes de o tenant ser conhecido (login).
- Um teste lê o `schema.prisma` e falha se surgir um modelo com `organizationId`/`appId` sem configuração de escopo.
- `withSystemScope` exige um motivo descritivo, para que os usos fiquem fáceis de achar e revisar.

**Camada 3 — Row-Level Security no Postgres.** Opcional pela especificação; adiada (ver ADR 0006).

## Achado durante a implementação

As queries do Prisma são *lazy*: só executam quando `.then()` é chamado. `withTenant(ctx, () => db.x.findMany())` devolvia a promise sem executar e o `await` externo acontecia **fora** do contexto. O guard falhava fechado (erro, sem vazamento), mas quebraria toda chamada. Os helpers agora fazem `await` dentro do `storage.run` e retornam sempre `Promise<T>`. Há teste unitário com um *thenable* lazy e testes de integração contra PostgreSQL real.

## Consequências

- Repositórios usam campos escalares (`appId`, `organizationId`), nunca `connect` em `app`/`organization`.
- Violação de escopo é bug de programação: a API responde 500 genérico e registra log com `security: true`.
- Recursos de outro tenant aparecem como "não encontrado", porque o filtro injetado os exclui. Isso atende a regra "outro tenant responde 404".
