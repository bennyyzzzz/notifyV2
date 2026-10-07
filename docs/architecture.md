# Arquitetura (estado da Fase 1)

## Processos

```
             HTTPS                         ┌──────────────┐
 painel ──────────────► apps/api ─────────►│ PostgreSQL 16│◄────── apps/worker
 SDK    ──(Fase 6)────►  (Fastify)         └──────────────┘          (jobs)
                            │                                          │
                            └──────────────► Redis 7 ◄─────────────────┘
                              rate limit, cache        filas BullMQ (Fase 5), heartbeat
```

- API e worker são **stateless** e escalam horizontalmente.
- Os dois usam o papel de banco `notify_app` (DML). As migrações rodam como `notify_migrator`, em um job separado (target `migrate` do Dockerfile).

## Camadas no backend

`rota (schema Zod) → policy → service → repository`

| Camada | Responsabilidade | Fase |
|---|---|---|
| Rota | Valida a entrada com schemas estritos. Não acessa o Prisma. | 1 |
| Policy | Funções puras `can(ator, ação, recurso)`. | 2 |
| Service | Regras de negócio. | 2+ |
| Repository | Roda dentro de `withTenant(...)`; o guard do Prisma injeta e valida o tenant. | 2+ |

## Pipeline de uma requisição

1. **Correlation id**: aceita o cabeçalho de entrada se for seguro, senão gera um. Vai nos logs e na resposta.
2. **Helmet / CORS**: cabeçalhos de segurança e allowlist de origens.
3. **Rate limit**: por IP, com store no Redis.
4. **Autenticação**: obrigatória, exceto nas rotas da allowlist pública.
5. **Validação Zod**: campos desconhecidos geram 400.
6. **Handler.**
7. **Erros**: tudo passa por um único handler RFC 7807.

## Pacotes

| Pacote | Conteúdo |
|---|---|
| `@notify/crypto` | `encryptEnvelope` / `decryptEnvelope` / `rewrapEnvelope`, `LocalKeyRing`, `generateOpaqueToken`, `hashToken`, `safeEqual` |
| `@notify/shared` | Enums do domínio, `buildProblem`, máscaras |
| `@notify/shared/server` | `apiEnvSchema` / `workerEnvSchema` / `parseEnv`, `createLogger` (com redact), `resolveCorrelationId` |
| `@notify/db` | `createDbClient`, `withTenant`, `withSystemScope`, tipos e enums gerados pelo Prisma |

## Modelo de dados

Definido em `packages/db/prisma/schema.prisma`, seguindo a seção 5 da especificação.

**Convenções**

- UUID v7; tabelas e colunas em `snake_case`; `timestamptz`; JSONB para propriedades e metadados.
- `organization_id` em toda tabela de negócio, mais `app_id` quando aplicável.

**Acréscimos em relação à seção 5**

- `support_sessions` — modo suporte do master (seção 6.2).
- `mfa_recovery_codes`.
- `one_time_tokens` — unifica os tokens de convite e de reset de senha.
- `users.must_change_password`.
- `devices.is_test_device` — modo teste das automações.
- `organization_id`/`app_id` em `app_members`, `delivery_attempts`, `automation_runs` e `audience_list_entries`, para a regra "toda tabela de negócio tem tenant".

As garantias de integridade entre tenants estão no [ADR 0002](decisions/0002-tenant-isolation.md).
