# ADR 0005 — Convenções HTTP: rotas públicas, erros, rate limit e correlation id

- Status: aceito
- Data: 2026-10-07
- Fase: 1
- Relacionado: V1-01, V1-04, V1-05, V1-12, V1-18, V1-20, seções 6.3 e 8

## Decisão

**Negar por padrão**

- Toda rota exige autenticação. Uma rota só é pública com `config: { auth: 'public' }` **e** se o caminho estiver na allowlist da seção 6.3 (`PUBLIC_ROUTE_ALLOWLIST`).
- Declarar como pública uma rota fora da allowlist **impede a API de iniciar** (checagem no hook `onRoute`).
- Até a Fase 2 o autenticador padrão nega tudo (`denyAllAuthenticator`).

**Ordem dos hooks.** O hook de autenticação é anexado *por rota*, depois do hook do rate limit. Se fosse global, rodaria antes e um flood de requisições sem login nunca chegaria ao limite (há teste: `[401, 401, 429]`).

**Caminhos**

- API autenticada: `/api/v1/...`.
- Ingestão: `/v1/ingest/*`, fora de `/api`, como na seção 6.3. Ela terá CORS próprio, validado contra `IngestKey.allowedOrigins`, e pode ser roteada para outra borda.
- Health checks (`/health/*`) e SDK (`/sdk/*`) ficam na raiz.

**Erros (RFC 7807)**

- Corpo: `type` (URN estável `urn:notify:problem:<tipo>`), `title` genérico em pt-BR, `status`, `correlationId` e, só em validação, `errors[]` por campo.
- Mensagens internas, stack traces e erros do Prisma/Firebase vão apenas para o log.
- Erros do guard de tenant viram 500 com log de segurança.

**Validação.** Schemas Zod estritos: campos desconhecidos geram 400 (`unrecognized_keys`). Uma regra de lint (`no-restricted-syntax`) proíbe espalhar `req.body` (V1-07).

**Correlation id.** O cabeçalho `X-Correlation-Id` recebido é aceito só se for curto e seguro (`[A-Za-z0-9._-]{8,64}`); caso contrário a API gera um UUID. O valor volta na resposta, aparece em todos os logs e entrará na auditoria.

**Cabeçalhos de segurança**

- CSP `default-src 'none'; frame-ancestors 'none'` (a API só serve JSON).
- HSTS de 1 ano com `includeSubDomains`, `Referrer-Policy: strict-origin-when-cross-origin`, `nosniff`, `Cache-Control: no-store`.

**Limites e proxies**

- CORS por allowlist (`CORS_ORIGINS`).
- Body máximo de 100 KB e timeout de requisição.
- Rate limit global por IP, com store no Redis.
- `TRUST_PROXY_HOPS` confia em exatamente N proxies, para que o IP do cliente não possa ser forjado via `X-Forwarded-For`.

**Health checks.** `/health/ready` responde `{"status":"ok"|"unavailable"}` sem dizer qual dependência falhou.
