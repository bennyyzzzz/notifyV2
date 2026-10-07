# PROMPT — Notify v2 (reconstrução do zero, pronta para produção)

> Cole este documento inteiro como instrução para o agente/desenvolvedor que vai construir a v2.
> Ele foi escrito a partir da análise completa do código da v1 (`notification-main`). As seções 2 e 3 descrevem o que a v1 faz e o que está errado nela; as seções seguintes são a especificação da v2.

---

## 0. Seu papel e como trabalhar

Você é um engenheiro de software sênior, com foco em segurança de aplicações (OWASP ASVS nível 2) e em sistemas SaaS multi-tenant. Sua tarefa é construir **do zero** a v2 do **Notify**, uma plataforma SaaS de push notifications com IA, automações por eventos e Firebase Cloud Messaging (FCM HTTP v1).

Regras de trabalho:

1. **Segurança e regras de negócio vêm antes de funcionalidade e de estética.** Se uma funcionalidade não puder ser entregue com segurança, entregue-a menor, nunca insegura.
2. **Nada da v1 deve ser copiado.** Use-a só como referência de produto. Os erros listados na seção 3 viram **testes de regressão obrigatórios**.
3. Trabalhe em **fases** (seção 13). Ao final de cada fase, o sistema precisa compilar, os testes precisam passar e o `README` precisa estar atualizado.
4. Quando a especificação for ambígua, escolha a opção **mais restritiva** (negar por padrão), registre a decisão em `docs/decisions/` (ADR curto) e siga em frente.
5. Todo código em **TypeScript estrito** (`strict: true`, sem `any` implícito). Todo texto da interface em **pt-BR**. Código, nomes de tabela e logs em inglês.
6. Não invente credenciais, chaves ou usuários padrão. Nenhum segredo pode estar no repositório.

---

## 1. Visão do produto

O Notify permite que empresas (clientes do SaaS) criem, agendem e enviem push notifications para seus apps/sites via Firebase, com:

- **Geração de copy com IA**: 5 opções de push por campanha, respeitando limites de tamanho e tom de voz.
- **Fila / checkout de envio**: revisar, editar, duplicar, agendar, enviar e cancelar.
- **Automações por eventos**: um SDK coleta eventos do app/site (ex.: `add_to_cart`) e regras disparam pushes automaticamente, com delay real.
- **Multi-painel**: cada cliente tem um ou mais painéis (apps), cada um com suas integrações Firebase, usuários e permissões.
- **Auditoria completa** de ações sensíveis.

### Glossário (use estes nomes no código e na UI)

| Termo (UI) | Entidade (código) | Definição |
|---|---|---|
| Organização | `Organization` | Cliente do SaaS. **Fronteira de isolamento de dados (tenant).** |
| Painel / App | `App` | Um app ou site do cliente. Pertence a uma Organização. |
| Integração Firebase | `FirebaseIntegration` | Service Account criptografada usada para enviar via FCM. Pertence a um App. |
| Chave de eventos | `IngestKey` | Chave pública (publishable) usada pelo SDK para enviar eventos a um App. |
| Campanha | `Campaign` | Agrupa o briefing (tema, segmento, tom, oferta) e as notificações geradas. |
| Notificação | `Notification` | Um push concreto (título, corpo, link, público, agendamento). Tem máquina de estados. |
| Envio | `Delivery` / `DeliveryAttempt` | Resultado do envio de uma Notificação (por destinatário/lote). |
| Dispositivo | `Device` | Token FCM conhecido de um usuário final, com consentimento. |
| Evento | `Event` | Evento comportamental recebido do SDK. |
| Automação | `AutomationRule` | Regra "quando evento X ocorrer → enviar push Y após Z minutos". |
| Log de auditoria | `AuditLog` | Registro imutável de ação sensível. |

---

## 2. O que a v1 faz (escopo funcional a manter e melhorar)

- Login por e-mail/senha com JWT.
- Papéis: global `master` / `user`; por painel `admin` / `operator` / `viewer`.
- Admin (master): CRUD de usuários, criação de painéis, vínculo de usuário↔painel com papel, visualização de logs de auditoria.
- Integrações Firebase: upload do JSON da Service Account, extração de `project_id`, `client_email`, `private_key`; chave privada criptografada; geração de `eventKey`; status "aguardando eventos / eventos ativos"; snippet do SDK para copiar.
- Criação de campanha: nome, tema, segmento (lista + "Outro"), tom (direto, elegante, divertido, urgente, premium, jovem), promoção/categoria/produto/cupom/desconto opcionais, URL de redirecionamento, público (token, lista de tokens com upload CSV, tópico, condição), envio imediato ou agendado.
- IA gera 5 opções (título ≤ 5 palavras, corpo ≤ 10 palavras, CTA, estratégia). **Na v1 a IA está desligada e retorna um mock fixo.**
- Edição da opção escolhida com preview de celular e contador de palavras → adicionar à fila.
- Fila/checkout: enviar agora, duplicar, remover; agendadas são enviadas por um cron de 1 em 1 minuto.
- Histórico de envios por painel.
- UTM automática no link (`utm_source`, `utm_medium`, `utm_campaign`).
- SDK JS (`notify-sdk.js`): `track`, `identify`, atalhos por evento, interceptação do bridge `flutter_inappwebview.callHandler("googleAnalytics", ...)`.
- Endpoint público `/events` que registra evento e dispara automações na hora.
- Tela de debug de eventos.
- Tema claro/escuro, visual monocromático.

---

## 3. Diagnóstico da v1 — falhas que NÃO podem se repetir

Cada item abaixo deve virar **pelo menos um teste automatizado** na v2 (pasta `tests/security/regressions/`), com o identificador `V1-XX` no nome do teste.

### 3.1 Críticas (exploráveis hoje)

| ID | Falha na v1 | Impacto | Exigência na v2 |
|---|---|---|---|
| V1-01 | `POST /send-notification` **não tem autenticação**. Qualquer pessoa na internet envia push usando qualquer `firebaseIntegrationId`. | Envio de spam/phishing em nome de qualquer cliente. | Toda rota é autenticada por padrão; envio exige papel e checagem de que integração, notificação e app pertencem ao mesmo tenant. |
| V1-02 | `requireAppRole` lê `appId` de `req.body` **antes** do `appId` do recurso. Um operador do painel A edita/apaga/duplica itens do painel B enviando `appId=A` no corpo ou na query. | Quebra total do isolamento entre clientes (IDOR). | O tenant/app de um recurso existente é **sempre derivado do próprio recurso** no banco, nunca do input. |
| V1-03 | `firebaseIntegrationId` aceito do cliente sem verificar se pertence ao painel (fila, automações, envio). | Usar credenciais Firebase de outro cliente. | Validar pertencimento em toda referência entre entidades (FK + checagem de tenant). |
| V1-04 | `POST /events` é público e, com só a `eventKey` (que fica exposta no HTML do site), aceita **qualquer token FCM** e dispara push automaticamente. Sem rate limit. | Qualquer visitante vira relay de push para qualquer dispositivo do app; abuso de cota. | Ver seção 7.8: chave publishable com allowlist de origem, rate limit, eventos permitidos no servidor, tokens só via `identify` com consentimento, frequency cap. |
| V1-05 | `POST /generate-push-options` sem autenticação. | Consumo ilimitado da conta OpenAI por terceiros. | Autenticado, por papel, com cota por app e rate limit. |
| V1-06 | `GET /apps/:id/users` exige só login: qualquer usuário lista e-mails e papéis de qualquer painel. | Vazamento de dados pessoais. | Somente `master`, `org_admin` da organização ou `admin` do painel. |
| V1-07 | Mass assignment: `PUT /queue/:id` e `PUT /automations/:id` fazem `data = {...req.body}`. Dá para mudar `status` para `sent`, trocar `campaignId`, etc. | Fraude de estado e bypass de regras. | Schemas de entrada com allowlist de campos (Zod `.strict()`), nunca espalhar o body. |
| V1-08 | `crypto.js` usa fallback `"default-secret-key"` se `ENCRYPTION_SECRET` faltar, AES-256-**CBC** sem autenticação, chave = SHA-256 de uma frase. | Chaves privadas Firebase descriptografáveis; sem detecção de adulteração. | AES-256-GCM, chave de 32 bytes aleatória (ou KMS), envelope encryption, `keyId` para rotação, app **não sobe** sem a chave. |
| V1-09 | O `.env` foi distribuído dentro do zip, com segredos em texto legível (`"minha-chave-..."`, `"uma-chave-jw..."`). Seed cria `master@notify.com / admin123` e a tela de login **mostra essa senha**. | Tomada de conta e forja de JWT. | Nenhum segredo ou credencial padrão. Bootstrap do primeiro master por comando CLI com senha forte gerada e troca obrigatória. Validação de env na inicialização. **Rotacionar todos os segredos da v1.** |

### 3.2 Altas

| ID | Falha | Exigência na v2 |
|---|---|---|
| V1-10 | JWT de 7 dias salvo em `localStorage`, sem revogação; mudar senha/papel não derruba sessões. | Access token de 15 min + refresh token rotativo em cookie `httpOnly; Secure; SameSite=Strict`, com detecção de reuso e revogação. |
| V1-11 | Login sem rate limit, sem bloqueio, sem MFA. | Rate limit por IP e por conta, bloqueio progressivo, MFA TOTP obrigatório para `master` e `org_admin`, opcional para os demais. |
| V1-12 | Todas as respostas de erro devolvem `details: error.message` (mensagens do Prisma, do Firebase, stack). | Erros padronizados (RFC 7807) com mensagem genérica + `correlationId`; detalhes só no log do servidor. |
| V1-13 | `redirectUrl` sem validação (aceita `javascript:`, `http:`, domínios de terceiros). | Só `https://` ou deep link com esquema registrado, e domínio na allowlist do App. |
| V1-14 | Logs de auditoria gravam `audienceValue` (tokens FCM) e um log por evento recebido. `DELETE_USER` registra o e-mail de quem apagou, não de quem foi apagado; `CREATE_USER` registra o novo usuário como autor. | Auditoria com `actorId` e `target` corretos, sem tokens/segredos, e eventos de alto volume fora da auditoria. |
| V1-15 | Master pode criar usuário com qualquer `globalRole` livre (string). | Enum no banco e no schema; elevação para `master` exige reautenticação + MFA e gera alerta. |
| V1-16 | Scheduler com `node-cron` dentro do processo da API: duplica envios com mais de uma instância, sem retry, item fica preso em `sending` se o processo cair. | Fila persistente (BullMQ/Redis) em processo `worker` separado, com locks, idempotência, retry com backoff e recuperação de jobs travados. |
| V1-17 | Envio para lista de tokens é sequencial, gera um access token Google por mensagem e não registra falhas no histórico. | Cache do access token (~55 min), concorrência controlada, registro de sucesso **e falha** por destinatário, tratamento de `UNREGISTERED`. |

### 3.3 Médias / qualidade

- V1-18: CORS fixo em `http://localhost:5173` e `baseURL` fixo em `http://localhost:3001` → configuração por ambiente.
- V1-19: Caminho do banco fixo (`file:./dev.db`) ignorando `DATABASE_URL`; SQLite → PostgreSQL.
- V1-20: Sem `helmet`, sem limite de tamanho de body, `express.json()` registrado duas vezes.
- V1-21: `delayMinutes` das automações existe no banco e na tela, mas **é ignorado** (envio imediato).
- V1-22: Papéis inconsistentes: o README fala em `master/admin/user`, o código usa `admin/operator/viewer`, e o padrão de vínculo é `viewer`.
- V1-23: Aba "Debug Eventos" aparece para operador, mas `GET /events` é só para master → tela quebrada.
- V1-24: `App.jsx` importa `./components/AdminPanel` mas o arquivo é `adminPanel.jsx` → build quebra em Linux.
- V1-25: UTM inconsistente: README diz `utm_medium=push`, código usa `utm_medium=notifyauto`; concatenação manual de string quebra URLs com `#fragmento` e duplica UTMs existentes.
- V1-26: Validação de "palavras" só por espaço; nenhum limite de caracteres (FCM e SOs truncam).
- V1-27: Modelos `Company` e `Campaign` existem mas não são usados.
- V1-28: `alert()`/`window.confirm()` como UX; nenhum estado de carregamento consistente; sem paginação no histórico.
- V1-29: Tokens CSV lidos no navegador e enviados como uma string gigante; sem limite, sem deduplicação.
- V1-30: Remover usuário apaga vínculos com `deleteMany` sem transação; exclusões físicas em vez de soft delete onde há histórico.

---

## 4. Stack e arquitetura

### 4.1 Stack (use exatamente esta, salvo ADR justificando)

- **Monorepo** com `pnpm` workspaces + Turborepo.
- **Backend API**: Node.js 22 LTS, TypeScript, **Fastify** (com `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/cookie`, `@fastify/cors`, `@fastify/multipart`), validação com **Zod** (`fastify-type-provider-zod`), OpenAPI gerado a partir dos schemas.
- **Banco**: PostgreSQL 16 + **Prisma**. Migrações versionadas. Row-Level Security opcional como segunda camada (ver 6.3).
- **Filas / jobs**: Redis 7 + **BullMQ**, em processo **`worker`** separado da API.
- **Frontend**: React 19 + Vite + TypeScript, **React Router**, **TanStack Query**, **React Hook Form + Zod** (mesmos schemas do backend via pacote compartilhado), Tailwind CSS + componentes acessíveis (Radix UI / shadcn).
- **SDK**: TypeScript, build ESM + IIFE minificado, sem dependências, < 6 KB gzip.
- **IA**: provedor atrás de uma interface `CopyGenerator` (implementação OpenAI e implementação "mock" para testes/dev), com saída estruturada (JSON schema).
- **Observabilidade**: logs estruturados com **pino** (com `redact`), OpenTelemetry (traces), métricas Prometheus, Sentry (ou equivalente) para erros.
- **Infra**: Docker (imagens multi-stage, usuário não-root, filesystem read-only), `docker-compose` para dev, healthchecks `/health/live` e `/health/ready`.
- **CI**: GitHub Actions: lint, typecheck, testes, `pnpm audit`, Semgrep (SAST), Gitleaks (segredos), Trivy (imagem), build.

### 4.2 Estrutura do repositório

```
notify/
├── apps/
│   ├── api/            # Fastify: rotas HTTP, autenticação, autorização
│   ├── worker/         # BullMQ: envios, agendamentos, automações, limpeza/retensão
│   └── web/            # React: painel administrativo
├── packages/
│   ├── shared/         # Schemas Zod, enums, tipos, regras de negócio puras (validações de push, URL, UTM)
│   ├── db/             # Prisma schema, client, extensões de tenant, seeds de DEV
│   ├── fcm/            # Cliente FCM HTTP v1 (auth, cache de token, envio, classificação de erros)
│   ├── crypto/         # Envelope encryption AES-256-GCM, rotação de chaves
│   └── sdk/            # Notify SDK (browser + bridge Flutter)
├── docs/
│   ├── decisions/      # ADRs
│   ├── security/       # Threat model, matriz de permissões, política de retenção
│   └── api/            # OpenAPI gerado
├── tests/
│   ├── e2e/            # Playwright
│   └── security/       # Testes de autorização e regressões V1-XX
└── docker-compose.yml
```

### 4.3 Camadas no backend

`route (schema Zod) → policy (autorização) → service (regras de negócio) → repository (acesso a dados com escopo de tenant)`.

- **Rotas** não acessam Prisma diretamente.
- **Policies** são funções puras e testáveis: `can(actor, action, resource) → boolean`.
- **Repositories** recebem sempre um `TenantContext` (`organizationId`, `appId?`) e **nunca** fazem consulta sem esse filtro.
- Regras de negócio puras (limites de texto, validação de URL, UTM, máquina de estados) ficam em `packages/shared` e são reaproveitadas no frontend apenas como UX; **o backend é a fonte da verdade**.

---

## 5. Modelo de dados

Requisitos gerais:

- IDs públicos: **UUID v7** (ou cuid2). Nunca expor IDs autoincrementais.
- Toda tabela de negócio tem `organizationId` (e `appId` quando aplicável), `createdAt`, `updatedAt`, e `deletedAt` quando houver histórico ligado (soft delete).
- Enums nativos do Postgres para papéis, status e tipos.
- `JSONB` para propriedades de eventos e metadados (nunca `String` com `JSON.stringify`).
- Índices em todas as FKs e nos filtros usados pelas telas (status, datas, `appId`).

Entidades (mínimo):

```
Organization(id, name, slug, status[active|suspended], plan, settings JSONB, createdAt, updatedAt)

User(id, organizationId?, name, email UNIQUE (citext), passwordHash (argon2id),
     platformRole[master|none], status[invited|active|disabled],
     mfaSecretEnc?, mfaEnabledAt?, failedLoginCount, lockedUntil?, lastLoginAt?,
     passwordChangedAt, createdAt, updatedAt, deletedAt?)

OrganizationMember(organizationId, userId, role[org_admin|member])        UNIQUE(organizationId, userId)

App(id, organizationId, name, platform[web|android|ios|flutter_webview],
    timezone (default 'America/Sao_Paulo'), allowedRedirectDomains TEXT[], allowedDeepLinkSchemes TEXT[],
    utmDefaults JSONB, contentLimits JSONB, quietHours JSONB, frequencyCaps JSONB,
    allowedEvents TEXT[], createdById, createdAt, updatedAt, deletedAt?)

AppMember(appId, userId, role[admin|operator|viewer], createdById, createdAt)   UNIQUE(appId, userId)

FirebaseIntegration(id, organizationId, appId, name, projectId, clientEmail,
    privateKeyCiphertext BYTEA, dekCiphertext BYTEA, keyId, iv, authTag,
    status[pending_verification|active|failing|revoked], lastVerifiedAt?, lastErrorCode?,
    createdById, createdAt, updatedAt, revokedAt?)                          UNIQUE(appId, projectId) WHERE revokedAt IS NULL

IngestKey(id, organizationId, appId, publicKey (prefixo 'pk_live_'/'pk_test_'), allowedOrigins TEXT[],
    status[active|revoked], lastEventAt?, createdById, createdAt, revokedAt?)

ServerKey(id, organizationId, appId, keyPrefix, keyHash (argon2/sha256+pepper), scopes TEXT[],
    lastUsedAt?, createdById, createdAt, revokedAt?)        -- para envio de eventos servidor→servidor (HMAC)

Device(id, organizationId, appId, externalUserId?, fcmTokenCiphertext, fcmTokenHash (para busca/dedupe),
    platform, consentAt, consentSource, status[active|invalid|opted_out], lastSeenAt, createdAt, updatedAt)

Campaign(id, organizationId, appId, name, theme, segment, tone, offer JSONB, redirectUrl,
    createdById, createdAt, updatedAt, deletedAt?)

Notification(id, organizationId, appId, campaignId?, firebaseIntegrationId,
    title, body, imageUrl?, redirectUrl, trackedUrl, data JSONB,
    audienceType[device|token_list|topic|condition], audienceRef JSONB, estimatedRecipients,
    status[draft|queued|pending_approval|scheduled|sending|sent|partially_sent|failed|canceled],
    scheduledAt?, sentAt?, canceledAt?, approvedById?, approvedAt?,
    idempotencyKey UNIQUE, version INT (optimistic locking),
    createdById, updatedById, createdAt, updatedAt)

AudienceList(id, organizationId, appId, name, size, createdById, createdAt)   -- upload CSV
AudienceListEntry(audienceListId, fcmTokenCiphertext, fcmTokenHash)          UNIQUE(audienceListId, fcmTokenHash)

Delivery(id, notificationId, organizationId, appId, total, succeeded, failed, invalidTokens,
    startedAt, finishedAt?)
DeliveryAttempt(id, deliveryId, target (token hash | topic | condition), status[sent|failed|retrying],
    fcmMessageId?, errorCode?, attempt INT, createdAt)

Event(id, organizationId, appId, ingestKeyId, clientEventId?, name, externalUserId?, deviceId?,
    properties JSONB, origin?, receivedAt)        UNIQUE(appId, clientEventId)   -- particionar por mês

AutomationRule(id, organizationId, appId, name, triggerEvent, conditions JSONB,
    cancelOnEvents TEXT[], delayMinutes, firebaseIntegrationId,
    title, body, redirectUrl, enabled, testMode, perUserCooldownHours,
    createdById, updatedById, createdAt, updatedAt, deletedAt?)
AutomationRun(id, ruleId, eventId, deviceId, status[scheduled|sent|skipped|canceled|failed],
    skipReason?, scheduledFor, executedAt?, jobId)

AiGeneration(id, organizationId, appId, campaignId, userId, provider, model,
    inputTokens, outputTokens, costCents, status, createdAt)

RefreshToken(id, userId, familyId, tokenHash, userAgent, ip, expiresAt, revokedAt?, replacedById?)
PasswordResetToken / InviteToken(id, userId, tokenHash, expiresAt, usedAt?)

AuditLog(id, organizationId?, appId?, actorType[user|system|api_key], actorId?, action,
    targetType, targetId, ip, userAgent, correlationId, changes JSONB (antes/depois, já redigido),
    createdAt)        -- append-only: sem UPDATE/DELETE para o usuário da aplicação
```

---

## 6. Autenticação, autorização e multi-tenancy

### 6.1 Papéis

| Nível | Papel | Quem é |
|---|---|---|
| Plataforma | `master` | Equipe interna do Notify. Gerencia organizações e suporte. |
| Organização | `org_admin` | Responsável do cliente. Gerencia painéis e usuários **da própria organização**. |
| Organização | `member` | Usuário comum do cliente; só acessa painéis aos quais foi vinculado. |
| Painel | `admin` | Integrações, chaves, automações, usuários do painel, campanhas, envios. |
| Painel | `operator` | Cria campanhas, usa IA, monta fila, agenda e envia. Vê automações (sem editar) e debug de eventos. |
| Painel | `viewer` | Somente leitura de histórico e métricas. |

### 6.2 Matriz de permissões (fonte da verdade — implementar e testar célula a célula)

| Ação | master | org_admin | app admin | operator | viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| Criar/suspender organização | ✅ | ❌ | ❌ | ❌ | ❌ |
| Convidar/desativar usuário da org | ✅ | ✅ | ❌ | ❌ | ❌ |
| Criar/arquivar painel | ✅ | ✅ | ❌ | ❌ | ❌ |
| Vincular usuário ao painel / mudar papel | ✅ | ✅ | ✅ (até `admin`, só usuários da mesma org) | ❌ | ❌ |
| Listar membros do painel | ✅ | ✅ | ✅ | ❌ | ❌ |
| Criar/revogar integração Firebase | ✅* | ✅ | ✅ | ❌ | ❌ |
| Criar/revogar chave de eventos / server key | ✅* | ✅ | ✅ | ❌ | ❌ |
| Configurar painel (domínios, UTM, limites, quiet hours, eventos permitidos) | ✅* | ✅ | ✅ | ❌ | ❌ |
| Criar/editar/excluir automação | ✅* | ✅ | ✅ | ❌ | ❌ |
| Ver automações | ✅ | ✅ | ✅ | ✅ | ❌ |
| Gerar copy com IA | ✅* | ✅ | ✅ | ✅ | ❌ |
| Criar/editar/duplicar/cancelar notificação | ✅* | ✅ | ✅ | ✅ | ❌ |
| Enviar para token único / lista ≤ limite | ✅* | ✅ | ✅ | ✅ | ❌ |
| Enviar para tópico, condição ou lista > limite (envio em massa) | ✅* | ✅ | ✅ | 🔶 exige aprovação de um `admin` | ❌ |
| Ver fila | ✅ | ✅ | ✅ | ✅ | ❌ |
| Ver histórico e métricas | ✅ | ✅ | ✅ | ✅ | ✅ |
| Exportar histórico (CSV) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Debug de eventos (tokens mascarados) | ✅ | ✅ | ✅ | ✅ | ❌ |
| Auditoria do painel | ✅ | ✅ | ✅ | ❌ | ❌ |
| Auditoria da plataforma inteira | ✅ | ❌ | ❌ | ❌ | ❌ |

`✅*` = o `master` só age dentro de uma organização cliente em **modo suporte**: precisa abrir uma sessão de suporte com justificativa, que expira em 60 min, fica visível para o `org_admin` e gera auditoria de cada ação.

`org_admin` tem implicitamente papel `admin` em todos os painéis da própria organização.

### 6.3 Regras de isolamento (obrigatórias)

1. **Negar por padrão.** Toda rota é autenticada, salvo allowlist explícita (`/auth/login`, `/auth/refresh`, `/auth/password-reset/*`, `/auth/invite/accept`, `/v1/ingest/*`, `/health/*`, `/sdk/*`).
2. Para **recursos existentes** (`/notifications/:id`, `/automations/:id`, ...), carregar o recurso, pegar `organizationId`/`appId` **do recurso** e só então avaliar a policy. Parâmetros `appId` do body/query são ignorados nesses casos.
3. Para **criação**, o `appId` vem da rota (`/apps/:appId/notifications`), e a policy verifica o vínculo do usuário com esse app.
4. Toda FK recebida do cliente (`firebaseIntegrationId`, `campaignId`, `audienceListId`) é validada como pertencente **ao mesmo app**.
5. Recurso de outro tenant responde **404** (não 403), para não revelar existência.
6. Extensão do Prisma que injeta `organizationId` em todas as queries de modelos com tenant e lança erro se o contexto estiver ausente.
7. Segunda camada recomendada: Postgres Row-Level Security com `SET app.current_org` por transação.
8. Testes automatizados de autorização gerados a partir da matriz 6.2: **para cada endpoint × cada papel × (mesmo tenant | outro tenant)**.

### 6.4 Autenticação e sessão

- Senha: **argon2id** (m=19 MiB, t=2, p=1 ou superior). Política: mínimo 12 caracteres, checagem contra lista de senhas vazadas (k-anonymity HIBP ou lista local top-100k), sem regras de composição arbitrárias.
- **Sem cadastro aberto.** Usuários entram por **convite** por e-mail (token de uso único, 72 h). Ninguém define a senha de outra pessoa.
- Primeiro `master` criado por CLI: `pnpm --filter api cli create-master --email ...`, que gera senha temporária forte, exibe uma única vez e força troca + MFA no primeiro login.
- Access token JWT (EdDSA ou RS256, chave em secret manager) com **15 min**, contendo só `sub`, `sid`, `iat`, `exp`. Papéis **não** vão no token; são lidos do banco/cache a cada requisição (cache Redis de até 60 s, invalidado em mudança de papel).
- Refresh token opaco em cookie `__Host-refresh` (`HttpOnly; Secure; SameSite=Strict; Path=/`), 7 dias deslizante / 30 dias absoluto, **rotação a cada uso** com detecção de reuso (reuso → revoga a família inteira e audita).
- Proteção CSRF: SameSite=Strict + header customizado obrigatório (`X-Requested-With`) + checagem de `Origin` nas rotas com cookie.
- Trocar senha, mudar papel, desativar usuário ou desativar MFA **revoga todas as sessões** do usuário.
- MFA TOTP (com 10 códigos de recuperação) obrigatório para `master` e `org_admin`.
- Login: mensagem genérica ("E-mail ou senha inválidos"), tempo de resposta constante (hash dummy quando o usuário não existe), rate limit 5/min por IP+e-mail e 20/min por IP, bloqueio progressivo após 10 falhas (15 min, 1 h, 24 h), alerta por e-mail ao usuário.
- Reset de senha por e-mail com token de uso único (30 min), resposta sempre igual exista ou não o e-mail.
- Tela "Minhas sessões" com revogação individual.

---

## 7. Regras de negócio por módulo

### 7.1 Organizações e painéis

- Organização `suspended` → todos os usuários dela perdem acesso (exceto leitura pelo master) e **nenhum envio ou automação é executado**; jobs pendentes ficam pausados.
- Painel arquivado (`deletedAt`) → automações desligadas, chaves de eventos revogadas, notificações agendadas canceladas (com auditoria). Pode ser restaurado em até 30 dias.
- Não é permitido remover o último `admin` de um painel ativo nem o último `org_admin` de uma organização.
- Um usuário só pode ser vinculado a painéis da organização da qual é membro.

### 7.2 Integrações Firebase

- Upload do JSON da Service Account **direto para o backend** (multipart, máx. 16 KB, `application/json`). O arquivo é processado em memória e **nunca é gravado em disco**. O frontend não lê nem guarda a chave privada.
- Validação no servidor: `type === "service_account"`, `project_id`, `client_email` (`*.iam.gserviceaccount.com`), `private_key` em PEM válido.
- **Verificação ativa** antes de ativar: obter access token e fazer um envio com `validate_only: true` para o FCM. Sucesso → `active`; falha → `pending_verification` com código do erro (sem expor a mensagem crua).
- Criptografia: **envelope encryption**. Uma DEK aleatória (32 bytes) por integração cifra a chave privada com AES-256-GCM; a DEK é cifrada pela KEK (KMS ou `ENCRYPTION_KEYS` no formato `keyId:base64`). Guardar `keyId`, `iv` (12 bytes aleatórios), `authTag`. Suportar rotação da KEK com job de re-encriptação.
- A chave privada **nunca** sai do backend/worker em nenhuma resposta, log, erro ou auditoria. Descriptografar só no momento do envio, dentro do worker.
- Mesmo `projectId` não pode estar ativo duas vezes no mesmo painel.
- "Remover" = **revogar** (soft): a integração deixa de ser usada; notificações agendadas e automações que dependem dela são marcadas e o admin é avisado na tela antes de confirmar.
- Health check periódico (diário) com `validate_only`; ao falhar 3 vezes seguidas → `failing` + e-mail aos admins do painel.
- Cache do access token do Google por integração (expira 5 min antes do `expires_in`), guardado só em memória do worker.

### 7.3 Chaves de eventos (substitui a `eventKey` da v1)

- **IngestKey (publishable, `pk_live_...`)**: vai no SDK, é pública por natureza. Só permite enviar eventos para **um** app; nunca lê dados; vale apenas para as origens em `allowedOrigins` (checar `Origin` no navegador; para apps nativos/WebView, usar o modo servidor ou validação por app id).
- **ServerKey (secreta, `sk_live_...`)**: para backends do cliente enviarem eventos servidor→servidor, com assinatura **HMAC-SHA256** do corpo + timestamp (janela de 5 min, anti-replay). Mostrada uma única vez na criação; só o hash fica no banco.
- Chaves podem ser revogadas e rotacionadas (com período de convivência de até 24 h).
- O snippet do SDK na tela usa a URL real da API (variável de ambiente `PUBLIC_API_URL`), não um placeholder.

### 7.4 Campanhas e geração com IA

- Campos: nome (3–80 chars), tema (até 80), segmento (lista configurável + "Outro" com texto até 60), tom (enum), oferta opcional (promoção, categoria, produto, cupom, % de desconto 1–99), URL de redirecionamento.
- **A IA só conhece o que foi informado**: o prompt do sistema proíbe inventar desconto, cupom, prazo ou produto não informado. A saída é validada: se citar cupom/percentual diferente do informado, a opção é descartada.
- Mitigação de prompt injection: campos do usuário entram como **dados** delimitados (JSON), nunca concatenados como instruções; limites de tamanho por campo; saída via **JSON schema estruturado**; resposta validada por Zod; o link nunca é enviado ao modelo.
- Validação da saída com as mesmas regras de conteúdo de 7.5. Opções inválidas são regeneradas uma vez; se ainda faltarem, retorna as válidas e informa quantas faltaram.
- **Cota** por app e por usuário (ex.: 50 gerações/dia por app, configurável por plano), rate limit 10/min por usuário, timeout de 20 s, registro de tokens e custo em `AiGeneration`.
- Modo mock só em `NODE_ENV !== 'production'`; em produção, ausência de `AI_API_KEY` desabilita o botão com mensagem clara, sem quebrar o resto.

### 7.5 Regras de conteúdo do push (em `packages/shared`, aplicadas no backend)

- Título: 1–5 palavras **e** ≤ 50 caracteres. Corpo: 1–10 palavras **e** ≤ 120 caracteres. (Valores padrão; configuráveis por painel dentro de limites máximos da plataforma: título ≤ 65, corpo ≤ 240.)
- Contagem de palavras com `Intl.Segmenter` (granularidade `word`, `isWordLike`), emojis não contam como palavra mas contam como caractere (contar por grafema).
- Sem só espaços, sem caracteres de controle, sem HTML; normalizar Unicode NFC; trim.
- Máximo de 3 emojis por campo (regra de produto "emoji sem exagero").
- Imagem opcional: só `https`, domínio permitido, ≤ 1 MB (validar por HEAD no worker antes do envio).

### 7.6 Links, deep links e UTM

- `redirectUrl` obrigatório. Aceito somente se: `https:` com host na `allowedRedirectDomains` do painel (permitindo subdomínios explicitamente configurados), **ou** deep link com esquema em `allowedDeepLinkSchemes`. Rejeitar `javascript:`, `data:`, `file:`, `http:`, IPs, `localhost`, credenciais na URL (`user:pass@`), e URLs > 2048 chars.
- UTM montada com a API `URL`/`URLSearchParams` (respeita `?` e `#`):
  - `utm_source` = padrão do painel (default `notify`), `utm_medium` = `push` (padroniza a inconsistência da v1), `utm_campaign` = slug da campanha (ou `auto_<slug-da-regra>` em automações), `utm_content` = id curto da notificação.
  - **Não sobrescrever** UTMs que já existam na URL informada.
- O `trackedUrl` final é calculado no backend e salvo na notificação (o que foi enviado fica registrado exatamente).

### 7.7 Notificações, fila e envio

**Máquina de estados** (transições fora desta tabela retornam 409):

```
draft ──► queued ──► sending ──► sent
  │         │           ├──► partially_sent
  │         │           └──► failed ──► queued (reenviar, cria nova Delivery)
  │         ├──► scheduled ──► sending
  │         │         └──► queued (desagendar)
  │         └──► pending_approval ──► sending | scheduled  (aprovado por admin)
  │                        └──► draft                       (rejeitado, com motivo)
  └──► canceled  ◄── queued | scheduled | pending_approval | failed
```

- `status` **nunca** é aceito como input direto; muda só por ações (`/schedule`, `/unschedule`, `/send`, `/cancel`, `/retry`, `/approve`).
- Edição permitida só em `draft`, `queued`, `scheduled` (e `scheduled` só até **5 min antes** do horário). Edição usa **optimistic locking** (`version`); conflito → 409 com mensagem "Esta notificação foi alterada por outra pessoa".
- Duplicar → cria nova em `draft`, sem agendamento, com "(cópia)" no nome da campanha.
- Remover = `cancel` (soft). Itens `sent`/`partially_sent` nunca são removidos (histórico).
- **Agendamento**: `scheduledAt` ≥ agora + 2 min e ≤ agora + 90 dias; armazenado em UTC; exibido e digitado no fuso do painel (`App.timezone`, padrão `America/Sao_Paulo`). Se cair em quiet hours do painel, avisar (não bloquear envio manual; bloquear em automação).
- **Envio em massa** (tópico, condição ou lista > 1.000 tokens, valor configurável): exige tela de confirmação digitando o nome da campanha; se o autor for `operator`, a notificação vai para `pending_approval` e precisa de aprovação de um `admin` (que não pode ser o próprio autor).
- **Idempotência**: `POST /send` exige header `Idempotency-Key`; repetir com a mesma chave devolve o mesmo resultado e não reenvia. Clique duplo no botão não pode gerar dois envios.
- O envio é **sempre assíncrono**: a API muda para `sending`, enfileira um job e responde 202. A UI acompanha o progresso (polling ou SSE).
- Público:
  - `device`: um token (validar formato: 100–4096 chars, `[A-Za-z0-9_:\-]`).
  - `token_list`: via `AudienceList` com upload CSV pelo backend (máx. 5 MB / 100.000 linhas; coluna `token` ou uma por linha; deduplicar; informar válidos/inválidos/duplicados antes de confirmar).
  - `topic`: regex do FCM `^[a-zA-Z0-9-_.~%]{1,900}$`.
  - `condition`: validar sintaxe (`'x' in topics`, `&&`, `||`, parênteses, máx. 5 tópicos — limite do FCM).
- **Worker de envio**: concorrência configurável (ex.: 50 req simultâneas por integração), respeito a 429 com `Retry-After`, retry exponencial com jitter (máx. 5 tentativas) para 429/5xx/timeout; **sem retry** para 400/403/404. Erro `UNREGISTERED`/`INVALID_ARGUMENT` em token → marcar `Device` como `invalid`. Cada tentativa vira `DeliveryAttempt`; o agregado vira `Delivery` e define `sent` / `partially_sent` / `failed`.
- Job travado em `sending` por > 15 min sem heartbeat → recuperado pelo reaper e retomado sem duplicar destinatários já confirmados.
- Organização suspensa ou integração revogada no momento do envio → `failed` com motivo claro, sem chamar o FCM.

### 7.8 Ingestão de eventos e SDK

Endpoint: `POST /v1/ingest/events` (público, autenticado por IngestKey ou ServerKey).

- Responde **202** rápido; o processamento (gravação + automações) acontece no worker. A resposta **não** devolve dados internos (nada de `eventLog`, `automationResults`).
- Body máx. 8 KB por evento, lote de até 20 eventos por requisição; `properties` com no máximo 50 chaves, profundidade 3, strings ≤ 500 chars.
- `name` precisa estar em `App.allowedEvents` (padrão: `screen_view`, `view_item`, `add_to_cart`, `session_start`, `first_open`, `initiate_checkout`, `purchase`); fora da lista → descartado e contabilizado em métrica, sem erro para o cliente.
- `clientEventId` (UUID gerado pelo SDK) para deduplicação.
- Rate limit por chave (ex.: 100 eventos/s) e por IP (ex.: 20/s), com 429.
- **Tokens FCM não chegam em eventos.** Tokens são registrados só por `Notify.identify({ externalUserId, fcmToken, consent: true })` → cria/atualiza `Device` (token cifrado + hash). Sem `consent: true`, o token é rejeitado. Um mesmo IP/chave registrando > N tokens novos por minuto → bloqueio temporário e alerta (anti-abuso).
- Eventos referenciam o dispositivo por `externalUserId`/`deviceId` já identificado; automações só enviam para `Device` ativos daquele app.
- Atualizar `IngestKey.lastEventAt` e status "eventos ativos" no máximo uma vez por minuto (não a cada evento).
- **SDK**: sem segredos; `endpoint` padrão = URL de produção; fila local com retry e envio em lote via `fetch(..., { keepalive: true })` / `sendBeacon`; não loga nada fora do modo `debug`; não sobrescreve o bridge Flutter se já envolvido; respeita opt-out (`Notify.optOut()`); distribuído com versão no caminho (`/sdk/v2/notify.min.js`) e hash SRI publicado na tela de integração.

### 7.9 Automações

- Campos: nome, evento gatilho (select dos `allowedEvents`, não texto livre), condições opcionais sobre `properties` (ex.: `value >= 100`, `category == "tenis"`; operadores `==, !=, >, >=, <, <=, in, contains`), **eventos que cancelam** (ex.: gatilho `add_to_cart`, cancela se `purchase` ocorrer antes), delay (0–10.080 min), integração Firebase do mesmo painel, título/corpo/link com as mesmas regras de 7.5/7.6.
- Delay **real**: cada disparo cria `AutomationRun` com `scheduledFor` e um job atrasado no BullMQ; ao executar, reavalia: regra ainda ativa? dispositivo ainda válido? evento de cancelamento ocorreu? está em quiet hours (adiar para o fim)? cooldown/frequency cap respeitado?
- **Frequency caps** (configuráveis por painel): por regra e por dispositivo, padrão 1 envio a cada 24 h; global por dispositivo, padrão máx. 3 pushes automáticos/dia. Excedeu → `skipped` com motivo.
- **Quiet hours** padrão 22:00–08:00 no fuso do painel para automações.
- **Modo teste**: envia apenas para uma lista de dispositivos de teste do painel.
- Desativar ou excluir uma regra cancela os `AutomationRun` pendentes.
- Toda execução (enviada, ignorada, cancelada, falha) fica visível na tela da regra com o motivo.

### 7.10 Histórico e métricas

- Lista paginada (cursor), filtros por período, status, campanha, tipo (manual/automação), integração.
- Detalhe mostra: conteúdo enviado, `trackedUrl`, público (tokens **mascarados**: `abcd…wxyz`), totais de sucesso/falha, códigos de erro agregados, quem criou/aprovou/enviou.
- Dashboard do painel: envios por dia, taxa de sucesso, tokens inválidos, automações disparadas vs. ignoradas, eventos recebidos por tipo.
- Exportação CSV (apenas admin), assíncrona, com link de download temporário (15 min) e auditoria. Proteger contra CSV injection (prefixar `'` em células iniciadas por `= + - @`).

### 7.11 Auditoria

- Registrar: login (sucesso/falha), logout, MFA, troca/reset de senha, convites, mudanças de papel, criação/revogação de integrações e chaves, mudanças de configuração do painel, CRUD de automações, criação/edição/agendamento/aprovação/envio/cancelamento de notificações, exportações, sessões de suporte do master, suspensão de organização.
- **Não** registrar eventos do SDK na auditoria (vão para `Event`/métricas).
- Cada registro: `actorType`, `actorId`, `organizationId`, `appId`, `action`, `targetType`, `targetId`, `ip`, `userAgent`, `correlationId`, `changes` (antes/depois **redigido**).
- Nunca conter: senhas, hashes, chaves privadas, tokens FCM completos, server keys, cookies.
- Tabela append-only: o usuário de banco da aplicação tem só `INSERT`/`SELECT` nela.

### 7.12 LGPD e retenção de dados

- Minimização: guardar de usuários finais só `externalUserId` (fornecido pelo cliente), token cifrado, plataforma e consentimento.
- Retenção padrão (configurável por organização, com job diário de limpeza): eventos 90 dias, `DeliveryAttempt` 180 dias, `Delivery`/`Notification` 2 anos, auditoria 2 anos, dispositivos inválidos 30 dias.
- Endpoint de titular (`DELETE /apps/:appId/end-users/:externalUserId`, via ServerKey ou admin) apaga dispositivos e eventos daquele usuário final e registra a solicitação.
- Mascaramento de tokens e e-mails em telas de debug e em logs.
- Documentar em `docs/security/data-inventory.md` quais dados pessoais existem, onde e por quanto tempo.

---

## 8. Requisitos de segurança transversais (checklist de aceite)

**HTTP / API**
- [ ] `helmet` com CSP restritiva no web (`default-src 'self'`; sem `unsafe-inline` em scripts), HSTS (1 ano, `includeSubDomains`), `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`.
- [ ] CORS: allowlist vinda de `CORS_ORIGINS` para a API autenticada; o endpoint de ingestão tem CORS próprio validado contra `IngestKey.allowedOrigins`.
- [ ] Limite global de body 100 KB (exceções explícitas para uploads), timeouts de requisição.
- [ ] Rate limit global por IP + limites específicos: login, reset de senha, IA, envio, ingestão, exportação.
- [ ] Todas as entradas validadas por Zod `.strict()` (campos desconhecidos → 400). Paginação com limite máximo (100).
- [ ] Erros no formato RFC 7807 (`type`, `title`, `status`, `correlationId`), sem `details` internos.
- [ ] Versionamento `/api/v1`.

**Segredos e criptografia**
- [ ] Validação das variáveis de ambiente na inicialização (Zod); processo **não sobe** se faltar algo ou se o segredo for fraco (< 32 bytes de entropia).
- [ ] Segredos via secret manager em produção; `.env.example` sem valores reais; `.env*` no `.gitignore`; Gitleaks no CI e em pre-commit.
- [ ] AES-256-GCM com envelope e rotação de chaves; nenhuma derivação de chave a partir de frase.
- [ ] Tokens (refresh, convite, reset, server keys) armazenados só como hash.

**Logs e monitoramento**
- [ ] pino com `redact` para `authorization`, `cookie`, `password`, `privateKey`, `private_key`, `fcmToken`, `token`, `*.secret`.
- [ ] `correlationId` em toda requisição e job; propagado para logs e auditoria.
- [ ] Alertas: picos de 401/403, reuso de refresh token, bloqueios de login, falhas de integração, taxa de erro de envio > 20%, fila com atraso > 5 min.

**Frontend**
- [ ] Nenhum token em `localStorage`/`sessionStorage`; access token só em memória; refresh por cookie httpOnly.
- [ ] Sem `dangerouslySetInnerHTML`; conteúdo de usuário sempre escapado.
- [ ] Guards de rota e esconder botões são **só UX**; o backend reaplica tudo.
- [ ] Logout limpa o cache do TanStack Query.

**Supply chain e infra**
- [ ] Lockfile commitado, Renovate/Dependabot, `pnpm audit --prod` sem vulnerabilidades altas no CI.
- [ ] Imagens Docker com usuário não-root, sem ferramentas de build no runtime, escaneadas com Trivy.
- [ ] Banco com TLS, usuário da aplicação sem permissão de DDL (migrações com usuário separado), backups diários com teste de restauração documentado.
- [ ] Ambientes separados (dev, staging, prod) com credenciais Firebase e chaves diferentes.

**Documentação de segurança**
- [ ] `docs/security/threat-model.md` (STRIDE) cobrindo: painel, ingestão pública, SDK, worker, integrações Firebase, IA.
- [ ] `SECURITY.md` com processo de reporte de vulnerabilidade.

---

## 9. Layout e UX

### 9.1 Identidade visual (evoluir a da v1, não descartar)

- Manter o estilo **monocromático** (preto `#050505` / off-white `#F5F5F0`), temas claro e escuro, com respeito a `prefers-color-scheme` e escolha manual persistida.
- A fonte pixel (`Press Start 2P`) fica **só no logotipo** "NOTIFY"; o resto usa uma sans legível (Inter ou similar) e mono (JetBrains Mono) para códigos/IDs.
- Adicionar cores **semânticas** só para estado (sucesso, alerta, erro, info), com contraste AA nos dois temas. Na v1 `--danger` era igual ao texto — botões destrutivos precisam ser distinguíveis.
- Tokens de design em CSS variables (cores, espaçamento 4/8 px, raios, sombras, tipografia) consumidos pelo Tailwind.

### 9.2 Estrutura

- **App shell**: sidebar fixa à esquerda (colapsável; vira menu inferior/drawer no mobile), topbar com **seletor de organização/painel**, busca rápida (Ctrl/Cmd+K), menu do usuário (perfil, segurança/MFA, sessões, tema, sair).
- Rotas com URL real (`/o/:orgSlug/apps/:appId/notifications/:id`), para que links possam ser compartilhados e o botão voltar funcione.
- Navegação por painel:
  1. **Visão geral** (dashboard)
  2. **Campanhas** → wizard de criação
  3. **Fila** (rascunhos, na fila, agendadas, aguardando aprovação, com falha)
  4. **Histórico**
  5. **Automações**
  6. **Eventos** (debug ao vivo)
  7. **Configurações do painel**: Integrações Firebase, Chaves & SDK, Domínios e deep links, UTM, Limites de conteúdo, Quiet hours & frequência, Membros, Auditoria
- Área **Organização** (org_admin): painéis, usuários e convites, auditoria da organização, retenção de dados.
- Área **Plataforma** (master): organizações, sessões de suporte, auditoria global, saúde do sistema.

### 9.3 Fluxos principais

- **Wizard de campanha** em 4 passos com barra de progresso e rascunho salvo automaticamente:
  1. Briefing (nome, tema, segmento, tom, oferta) →
  2. Gerar com IA (5 cards; selecionar um; regenerar; ou "escrever manualmente") →
  3. Editar e pré-visualizar (preview **Android e iOS**, claro/escuro, contadores de palavras **e** caracteres em tempo real, avisos de truncamento) →
  4. Público e envio (integração, tipo de público com validação ao vivo, upload CSV com relatório, agora/agendar com fuso exibido, resumo final + confirmação; envio em massa pede digitar o nome da campanha).
- **Fila**: tabela com abas por status, ações em linha (editar, duplicar, agendar, enviar, cancelar), barra de progresso nos itens `sending`, badge de "aguardando aprovação" com ação de aprovar/rejeitar para admins.
- **Integração Firebase**: wizard (upload → verificação automática com resultado → nome → pronto), cartão de status com último teste e botão "testar agora".
- **Chaves & SDK**: criar chave, definir origens permitidas, snippet pronto com URL real e SRI, botão "enviar evento de teste", indicador "último evento recebido há X".
- **Automações**: construtor visual "Quando [evento] + [condições] → esperar [X] → enviar [push] — exceto se [evento de cancelamento]", com preview e lista de execuções recentes e motivos de skip.
- **Eventos (debug)**: stream ao vivo (SSE) com filtro por evento/usuário, payload expansível, tokens mascarados.

### 9.4 Padrões de interface

- Substituir todo `alert()`/`confirm()` por **toasts** e **diálogos de confirmação** acessíveis; ações destrutivas mostram o impacto ("3 automações usam esta integração").
- Estados de **carregando (skeleton)**, **vazio** (com próxima ação sugerida) e **erro** (com "tentar novamente") em todas as telas.
- Formulários com validação em tempo real, mensagens de erro ao lado do campo, foco no primeiro erro.
- Datas relativas + absolutas no fuso do painel ("há 5 min · 07/10/2026 11:27 BRT").
- Botões de ação assíncrona com estado de carregamento e bloqueio de clique duplo.
- **Acessibilidade WCAG 2.1 AA**: navegação completa por teclado, foco visível, `aria-*` corretos, contraste verificado, `prefers-reduced-motion`.
- Responsivo de 360 px a desktop largo; tabelas viram cards no mobile.
- Toda a UI em pt-BR, com textos centralizados (i18n pronto para outras línguas).

---

## 10. API (resumo dos endpoints)

Todas sob `/api/v1`, autenticadas salvo indicação. O OpenAPI completo deve ser gerado dos schemas.

```
Auth
POST   /auth/login                      (público)  {email, password} → exige MFA se habilitado
POST   /auth/mfa/verify                 (público, com token intermediário)
POST   /auth/refresh                    (cookie)
POST   /auth/logout
POST   /auth/password-reset/request     (público)
POST   /auth/password-reset/confirm     (público)
POST   /auth/invite/accept              (público)
GET    /me                              | PATCH /me | POST /me/password | POST /me/mfa/* | GET/DELETE /me/sessions/:id

Plataforma (master)
GET/POST /platform/organizations        | PATCH /platform/organizations/:id (suspender/reativar)
POST     /platform/support-sessions     {organizationId, reason}

Organização
GET/POST   /orgs/:orgId/apps            | PATCH/DELETE /orgs/:orgId/apps/:appId
GET/POST   /orgs/:orgId/members         (convites) | PATCH/DELETE /orgs/:orgId/members/:userId
GET        /orgs/:orgId/audit-logs

Painel
GET/PATCH  /apps/:appId/settings
GET/POST   /apps/:appId/members         | PATCH/DELETE /apps/:appId/members/:userId
GET/POST   /apps/:appId/firebase-integrations          (POST multipart)
POST       /apps/:appId/firebase-integrations/:id/verify
POST       /apps/:appId/firebase-integrations/:id/revoke
GET/POST   /apps/:appId/ingest-keys     | POST /apps/:appId/ingest-keys/:id/revoke
GET/POST   /apps/:appId/server-keys     | POST /apps/:appId/server-keys/:id/revoke
GET/POST   /apps/:appId/campaigns       | GET/PATCH /apps/:appId/campaigns/:id
POST       /apps/:appId/campaigns/:id/generate          (IA)
POST       /apps/:appId/audience-lists  (multipart CSV) | GET /apps/:appId/audience-lists/:id
GET/POST   /apps/:appId/notifications   (filtros, cursor)
GET/PATCH  /notifications/:id           (If-Match: version)
POST       /notifications/:id/duplicate | /schedule | /unschedule | /send (Idempotency-Key) | /cancel | /retry | /approve | /reject
GET        /notifications/:id/deliveries
GET/POST   /apps/:appId/automations     | GET/PATCH/DELETE /automations/:id
GET        /automations/:id/runs
GET        /apps/:appId/events          (debug, paginado) | GET /apps/:appId/events/stream (SSE)
GET        /apps/:appId/metrics
POST       /apps/:appId/exports/history | GET /exports/:id
GET        /apps/:appId/audit-logs
DELETE     /apps/:appId/end-users/:externalUserId        (LGPD)

Ingestão (pública, por chave)
POST   /v1/ingest/events                (IngestKey via header + Origin, ou ServerKey + HMAC)
POST   /v1/ingest/identify              (registro de dispositivo com consentimento)

Saúde
GET    /health/live | /health/ready     (público, sem detalhes internos)
```

---

## 11. Requisitos não funcionais

- p95 de leitura < 300 ms; ingestão p95 < 50 ms (só valida e enfileira).
- Envio: 10.000 tokens em < 2 min por integração (limitado pelas cotas do FCM).
- API e worker **stateless**, escaláveis horizontalmente; nada de estado em memória além de cache descartável.
- Desligamento gracioso (SIGTERM): parar de aceitar requisições, terminar jobs em andamento ou devolvê-los à fila.
- Migrações sem downtime (expand/contract).
- Configuração 12-factor; `.env.example` documentado item a item.

---

## 12. Testes (obrigatórios para considerar pronto)

- **Unitários** (Vitest): regras de conteúdo, URL/UTM, máquina de estados, policies, criptografia (incluindo adulteração → falha), parser de condição de tópicos, avaliação de condições de automação, frequency cap.
- **Integração** (Vitest + Testcontainers Postgres/Redis): cada endpoint com caminho feliz, validação e erros; FCM mockado com respostas reais (200, 400, 404 UNREGISTERED, 429 com Retry-After, 500).
- **Autorização**: suíte gerada a partir da matriz 6.2 — cada endpoint × cada papel × mesmo/outro tenant. Outro tenant sempre 404.
- **Regressões V1-01 a V1-30**: um teste por item da seção 3.
- **E2E** (Playwright): login com MFA, convite, criar integração, criar campanha com IA mock, agendar, enviar, aprovar envio em massa, criar automação e simular evento com delay, troca de tema, navegação por teclado.
- **Carga** (k6): ingestão e envio em massa.
- Cobertura mínima: 85% em `packages/shared`, `packages/crypto` e camadas de policy/service.

---

## 13. Fases de entrega

Cada fase só termina com: build verde, testes verdes, lint/typecheck limpos, README e ADRs atualizados, e uma demonstração descrita no PR.

1. **Fundação**: monorepo, CI completo (incluindo Gitleaks/Semgrep/audit), Docker Compose, validação de env, logger com redact, erros RFC 7807, Prisma + Postgres, extensão de tenant, pacote `crypto`.
2. **Identidade e acesso**: usuários, organizações, convites, login, refresh rotativo, MFA, reset de senha, sessões, CLI do primeiro master, policies + matriz de testes, auditoria.
3. **Painéis e integrações**: CRUD de painéis, membros, configurações, integração Firebase com upload server-side e verificação, chaves de ingestão/servidor.
4. **Campanhas e IA**: wizard, geração estruturada com validação e cotas, regras de conteúdo, URL/UTM, preview.
5. **Fila e envio**: máquina de estados, agendamento, worker BullMQ, envio FCM com retry/idempotência, listas de público CSV, aprovação de envio em massa, histórico.
6. **Eventos e automações**: SDK v2, ingestão, dispositivos com consentimento, automações com delay real, condições, cancelamento, quiet hours, frequency caps, debug ao vivo.
7. **Métricas, LGPD e operação**: dashboard, exportação, jobs de retenção, endpoint de titular, alertas, threat model, runbook de deploy e de incidente, teste de carga.

### 13.1 Registro de andamento

> Atualize esta planilha ao final de cada fase.
> Legenda: ✅ feito e verificado · ⚠️ feito, mas não executado/verificado · 🟡 base pronta (schema/infra), falta a funcionalidade · ⏳ a fazer

**Resumo por fase**

| Fase | Status | Concluída em | Observação |
|---|---|---|---|
| 1. Fundação | ✅ (com ressalvas ⚠️) | 2026-10-07 | 110 testes + 8 de integração (PostgreSQL 16). Docker e CI escritos, mas ainda não executados. |
| 2. Identidade e acesso | ⏳ | — | Tabelas já existem no schema (usuários, sessões, convites, MFA, auditoria). |
| 3. Painéis e integrações | ⏳ | — | Schema e criptografia em envelope já prontos. |
| 4. Campanhas e IA | ⏳ | — | — |
| 5. Fila e envio | ⏳ | — | Schema pronto; o worker ainda não tem BullMQ. |
| 6. Eventos e automações | ⏳ | — | Schema pronto; rota `/v1/ingest/*` já está na allowlist pública. |
| 7. Métricas, LGPD e operação | ⏳ | — | Inventário de dados inicial já escrito. |

**Itens por fase**

| Fase | Item | Status | Evidência / observação |
|---|---|---|---|
| 1 | Monorepo (pnpm + Turborepo, TS estrito, ESLint) | ✅ | `package.json`, `turbo.json`, `eslint.config.js` |
| 1 | CI completo (lint, typecheck, testes, audit, Semgrep, Gitleaks, Trivy, build) | ⚠️ | `.github/workflows/ci.yml` escrito; nunca rodou no GitHub |
| 1 | Docker Compose e imagens multi-stage | ⚠️ | `Dockerfile`, `docker-compose.yml`; não construídos (sem Docker no ambiente). `pnpm deploy` testado |
| 1 | Validação de env na inicialização | ✅ | `packages/shared/src/server/env.ts`; recusa segredos fracos |
| 1 | Logger com redact | ✅ | `packages/shared/src/server/logger.ts` |
| 1 | Erros RFC 7807 | ✅ | `apps/api/src/plugins/error-handler.ts` |
| 1 | Prisma + PostgreSQL (schema da seção 5 + migrações) | ✅ | Migrações aplicadas em PG16 real, sem drift |
| 1 | Extensão de tenant | ✅ | `packages/db/src/tenant`; FKs compostas e triggers no banco |
| 1 | Pacote `crypto` (AES-256-GCM em envelope, rotação) | ✅ | `packages/crypto`; 100% de cobertura |
| 1 | API: negar por padrão, helmet, CORS, rate limit, health checks | ✅ | `apps/api`; 17 testes |
| 1 | Worker: esqueleto com desligamento gracioso | ✅ | `apps/worker`; BullMQ fica para a Fase 5 |
| 1 | README, ADRs, SECURITY.md | ✅ | `docs/decisions/0001`–`0006` |
| 2 | Usuários e organizações | 🟡 | Tabelas prontas |
| 2 | Convites (token de uso único, 72 h) | 🟡 | Tabela `one_time_tokens` |
| 2 | Login (argon2id, rate limit, bloqueio progressivo) | ⏳ | — |
| 2 | Refresh token rotativo com detecção de reuso | 🟡 | Tabela `refresh_tokens` |
| 2 | MFA TOTP + códigos de recuperação | 🟡 | Tabela `mfa_recovery_codes` |
| 2 | Reset de senha | ⏳ | — |
| 2 | Tela/endpoints "Minhas sessões" | ⏳ | — |
| 2 | CLI do primeiro master | ⏳ | — |
| 2 | Policies + testes da matriz 6.2 | ⏳ | — |
| 2 | Auditoria (gravação) | 🟡 | Tabela append-only pronta |
| 2 | Início do frontend (`apps/web`): login | ⏳ | — |
| 3 | CRUD de painéis | ⏳ | — |
| 3 | Membros do painel | 🟡 | FK garante membro da organização |
| 3 | Configurações (domínios, UTM, limites, quiet hours, eventos) | ⏳ | — |
| 3 | Integração Firebase (upload no servidor + verificação `validate_only`) | 🟡 | Criptografia e unicidade por projeto prontas |
| 3 | Chaves de ingestão e de servidor | ⏳ | — |
| 4 | Wizard de campanha | ⏳ | — |
| 4 | Geração com IA (saída estruturada, validação, cotas) | ⏳ | — |
| 4 | Regras de conteúdo (palavras e caracteres) | ⏳ | — |
| 4 | URL / deep link / UTM | ⏳ | — |
| 4 | Preview Android/iOS | ⏳ | — |
| 5 | Máquina de estados das notificações | ⏳ | — |
| 5 | Agendamento | ⏳ | — |
| 5 | Worker BullMQ | ⏳ | — |
| 5 | Envio FCM com retry e idempotência | ⏳ | — |
| 5 | Listas de público via CSV | ⏳ | — |
| 5 | Aprovação de envio em massa | ⏳ | — |
| 5 | Histórico | ⏳ | — |
| 6 | SDK v2 | ⏳ | — |
| 6 | Ingestão de eventos | ⏳ | — |
| 6 | Dispositivos com consentimento | ⏳ | — |
| 6 | Automações com delay real, condições e cancelamento | ⏳ | — |
| 6 | Quiet hours e frequency caps | ⏳ | — |
| 6 | Debug de eventos ao vivo | ⏳ | — |
| 7 | Dashboard | ⏳ | — |
| 7 | Exportação CSV | ⏳ | — |
| 7 | Jobs de retenção | ⏳ | — |
| 7 | Endpoint de titular (LGPD) | ⏳ | — |
| 7 | Alertas | ⏳ | — |
| 7 | Threat model (STRIDE) | ⏳ | — |
| 7 | Runbooks de deploy e de incidente | ⏳ | — |
| 7 | Teste de carga (k6) | ⏳ | — |

**Regressões V1 (seção 3)**: 21 testes passando e 17 marcados como `todo`. Todos os itens V1-01…V1-30 estão rastreados em `tests/security/regressions/`.

---

## 14. Definição de pronto (produção)

- [ ] Todos os itens da seção 8 marcados.
- [ ] Nenhuma rota sem autenticação fora da allowlist de 6.3.
- [ ] Testes de regressão V1-01…V1-30 passando.
- [ ] Matriz de autorização 100% coberta por testes.
- [ ] Nenhum segredo no repositório (Gitleaks limpo no histórico inteiro).
- [ ] `README` com setup local em ≤ 5 comandos, `docs/` com arquitetura, threat model, inventário de dados, runbooks.
- [ ] Deploy reproduzível em staging a partir do CI, com rollback documentado.
- [ ] Revisão de segurança independente (pentest leve ou revisão por outra pessoa/agente que não escreveu o código) sem achados críticos ou altos abertos.

---

## 15. O que entregar ao final de cada resposta sua

1. Resumo do que foi implementado na fase.
2. Lista de decisões tomadas (com link para o ADR).
3. Como rodar e testar localmente.
4. Pendências e riscos conhecidos, em ordem de gravidade.
