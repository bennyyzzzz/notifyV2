# ADR 0004 — Papéis do banco, constraints manuais e auditoria append-only

- Status: aceito
- Data: 2026-10-07
- Fase: 1
- Relacionado: seções 7.2, 7.11 e 8

## Contexto

A especificação pede usuário da aplicação sem DDL, auditoria append-only, um `projectId` ativo por painel e validação de pertencimento entre entidades. Parte disso o Prisma não expressa.

## Decisão

**Papéis** (`packages/db/sql/roles.sql`; localmente, `docker/postgres/init.sh`):

- `notify_migrator` é dono do schema e roda só `prisma migrate deploy` (via `MIGRATION_DATABASE_URL`). Não tem `CREATE` no banco.
- `notify_app` é usado pela API e pelo worker: apenas DML via *default privileges*, sem DDL.
- As senhas vêm de variáveis do `psql`; o arquivo não contém segredos.

**Constraints manuais** (migração `20261007000100_constraints`):

- Só `CHECK`s, funções e triggers — objetos que o diff do Prisma ignora. Assim, um `migrate dev` futuro não tenta apagá-los. O CI confirma isso com `prisma migrate diff --exit-code` contra o banco migrado.
- **Unicidade do Firebase por painel**: trigger com `pg_advisory_xact_lock`, e não índice parcial. O Prisma não modela índices parciais e geraria `DROP INDEX` na próxima migração.
- **Auditoria append-only**, em duas camadas:
  - a migração revoga `UPDATE/DELETE/TRUNCATE` de `notify_app` em `audit_logs`;
  - um trigger bloqueia `UPDATE` para todos e `DELETE` de registros com menos de 2 anos (piso de retenção da seção 7.12). O job de retenção da Fase 7 usará um papel próprio.

**Regras dos arquivos de migração** (verificadas por teste):

- Só ASCII: servidores com encoding diferente de UTF-8 rejeitam caracteres não traduzíveis, mesmo em comentários. Isso aconteceu nos testes locais.
- Nenhum `CREATE SCHEMA`: o Prisma gera `CREATE SCHEMA IF NOT EXISTS "public"`, que exige `CREATE` no banco e falhava com o `notify_migrator`. A linha foi removida da migração inicial.

**E-mail**: em vez de `citext`, o e-mail é normalizado em minúsculas na aplicação (`normalizeEmail`) e o banco garante isso com `CHECK (email = lower(email))`.

## Consequências

- Toda migração nova precisa ser revisada e mantida em ASCII.
- A retenção de auditoria precisa de um papel dedicado (pendência da Fase 7).
