# Notify v2

Plataforma SaaS multi-tenant de push notifications com IA, automações por eventos e Firebase Cloud Messaging (FCM HTTP v1).
Reconstrução do zero da v1, guiada por [`PROMPT_NOTIFY_V2.md`](PROMPT_NOTIFY_V2.md).

> **Status: Fase 1 de 7 (Fundação).** Ainda não há telas, login nem envio de push. Esta fase entrega a base segura sobre a qual as próximas são construídas. Veja [Roadmap](#roadmap).

## Setup local

Pré-requisitos: Node.js 22+, Docker (para Postgres e Redis) e Corepack.

```bash
corepack enable && pnpm install          # 1. dependências
cp .env.example .env                     # 2. preencha os valores (veja abaixo)
docker compose up -d postgres redis      # 3. infraestrutura
pnpm build && pnpm db:migrate            # 4. build + migrações (MIGRATION_DATABASE_URL)
pnpm dev:api                             # 5. API em http://localhost:3001
```

Valores do `.env` que precisam ser gerados (nunca use valores de exemplo):

```bash
# ENCRYPTION_KEYS
node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64'))"
# TOKEN_PEPPER
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`POSTGRES_SUPERUSER_PASSWORD`, `MIGRATOR_DB_PASSWORD` e `APP_DB_PASSWORD` são usados pelo compose para criar os papéis `notify_migrator` (DDL) e `notify_app` (runtime). Monte a URL de cada um:

- `DATABASE_URL` → `notify_app`
- `MIGRATION_DATABASE_URL` → `notify_migrator`

API e worker **se recusam a iniciar** se uma variável faltar ou se um segredo for fraco. A mensagem lista os nomes das variáveis.

Tudo em containers: `docker compose --profile app up --build`.

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm build` | Compila todos os pacotes (gera o client do Prisma antes) |
| `pnpm typecheck` / `pnpm lint` | TypeScript estrito / ESLint |
| `pnpm test` | Testes unitários e de regressão de segurança |
| `pnpm test:coverage` | Testes com limite mínimo de 85% em `crypto`, `shared` e `db` |
| `pnpm db:migrate` | `prisma migrate deploy` com o papel de migração |
| `pnpm openapi` | Regenera `docs/api/openapi.json` a partir dos schemas |
| `pnpm dev:api` / `pnpm dev:worker` | Desenvolvimento com reload |

**Testes de integração do banco** rodam quando `TEST_DATABASE_URL` aponta para um Postgres migrado, usando o papel `notify_app`:

```bash
TEST_DATABASE_URL=postgresql://notify_app:...@localhost:5432/notify pnpm --filter @notify/db test
```

## Estrutura

```
apps/
  api/        Fastify: HTTP, autenticação (negar por padrão), erros RFC 7807
  worker/     Processo de jobs (BullMQ na Fase 5)
packages/
  crypto/     AES-256-GCM em envelope, rotação de chaves, tokens opacos
  shared/     Enums, Problem Details, máscaras (browser) + env/logger (./server)
  db/         Schema Prisma, migrações, guard de tenant
tests/
  security/   Regressões V1-01…V1-30
docs/
  architecture.md, decisions/ (ADRs), security/, api/
```

Detalhes em [`docs/architecture.md`](docs/architecture.md).

## Segurança

- Isolamento de tenant em duas camadas ativas: FKs compostas e triggers no banco, e guard no Prisma que falha fechado ([ADR 0002](docs/decisions/0002-tenant-isolation.md)).
- Segredos com AES-256-GCM em envelope, sem chave padrão ([ADR 0003](docs/decisions/0003-envelope-encryption.md)).
- Auditoria append-only e papel de banco sem DDL ([ADR 0004](docs/decisions/0004-database-roles-and-append-only-audit.md)).
- Toda rota autenticada por padrão; erros sem detalhes internos ([ADR 0005](docs/decisions/0005-http-conventions.md)).
- Reporte de vulnerabilidades: [`SECURITY.md`](SECURITY.md).

> ⚠️ **Os segredos da v1 vazaram no zip distribuído (V1-09). Rotacione todos eles**: chaves de criptografia, segredo JWT, Service Accounts do Firebase e senhas.

## Roadmap

| Fase | Escopo | Status |
|---|---|---|
| 1. Fundação | Monorepo, CI, Docker, env, logger, RFC 7807, Prisma, tenant, crypto | ✅ código e testes · ⚠️ Docker e CI ainda não executados (ver pendências) |
| 2. Identidade e acesso | Usuários, convites, login, refresh rotativo, MFA, sessões, policies, auditoria | ⏳ |
| 3. Painéis e integrações | Painéis, membros, configurações, Firebase com verificação, chaves de ingestão | ⏳ |
| 4. Campanhas e IA | Wizard, geração estruturada, regras de conteúdo, URL/UTM | ⏳ |
| 5. Fila e envio | Máquina de estados, BullMQ, FCM com retry/idempotência, CSV, aprovação | ⏳ |
| 6. Eventos e automações | SDK v2, ingestão, consentimento, delay real, quiet hours, frequency caps | ⏳ |
| 7. Métricas, LGPD e operação | Dashboard, exportação, retenção, titular, alertas, threat model, carga | ⏳ |

### Fase 1 — o que foi verificado

- Lint, typecheck e build limpos.
- 110 testes passando: crypto 27, shared 20, db 22, api 17, worker 3, regressões 21.
- Mais 8 testes de integração do banco, que rodam com `TEST_DATABASE_URL`.
- 17 regressões V1 marcadas como `todo` para as fases correspondentes.
- Cobertura: `crypto` 100%, `db` (guard de tenant) 100%, `shared` 100% de linhas.
- Migrações aplicadas em PostgreSQL 16 real com o papel `notify_migrator`, sem drift em relação ao `schema.prisma`.
- Os 8 testes de integração do banco passaram com o papel `notify_app`.
- `pnpm deploy` (usado pelo Dockerfile) gera os pacotes de produção.

### Pendências e riscos conhecidos (por gravidade)

1. **Docker e compose não foram construídos** neste ambiente (Docker indisponível). O primeiro `docker build` no CI pode exigir ajustes.
2. **CI nunca foi executado no GitHub.** As versões das actions não estão fixadas por SHA; o Dependabot está configurado.
3. **API e worker não foram iniciados até o fim com Redis.** Sem Redis disponível, foi verificado que conectam no Postgres e saem de forma limpa quando o Redis falha.
4. Itens adiados de propósito: [ADR 0006](docs/decisions/0006-deferred-items.md).
