# Inventário de dados pessoais e sensíveis (seção 7.12)

> Versão inicial, baseada no schema da Fase 1. Atualizar a cada fase que adicionar dados.
> Retenções marcadas com * dependem do job de limpeza da Fase 7.

## Usuários do painel (clientes do SaaS)

| Dado | Onde | Proteção | Retenção |
|---|---|---|---|
| Nome, e-mail | `users` | E-mail normalizado; mascarado em telas de debug e logs | Enquanto a conta existir; soft delete (`deleted_at`) |
| Senha | `users.password_hash` | argon2id (Fase 2); nunca logada (redact) | Enquanto a conta existir |
| Segredo MFA | `users.mfa_secret_enc` | Cifrado (envelope) | Até desativar o MFA |
| Códigos de recuperação | `mfa_recovery_codes.code_hash` | Somente hash | Até serem usados ou regenerados |
| Sessões (IP, user agent) | `refresh_tokens` | Token somente como hash | 30 dias (expiração absoluta)* |
| Convites e resets | `one_time_tokens` | Somente hash; uso único | 72 h / 30 min de validade* |

## Usuários finais (dos apps dos clientes)

| Dado | Onde | Proteção | Retenção |
|---|---|---|---|
| `externalUserId` | `devices`, `events` | Fornecido pelo cliente; sem nome nem e-mail | Até exclusão do titular |
| Token FCM | `devices`, `audience_list_entries` | Cifrado + HMAC para busca; mascarado (`abcd…wxyz`) | Inválidos: 30 dias* |
| Consentimento | `devices.consent_at`, `devices.consent_source` | — | Junto do dispositivo |
| Eventos comportamentais | `events.properties` | Limites de tamanho na ingestão (Fase 6) | 90 dias* |
| Origem / IP da requisição | `events.origin` | — | 90 dias* |

## Credenciais de clientes

| Dado | Onde | Proteção |
|---|---|---|
| Chave privada da Service Account Firebase | `firebase_integrations` | AES-256-GCM em envelope, AAD por registro; descifrada só no worker, no momento do envio |
| Server keys | `server_keys.key_hash` | Somente HMAC; exibida uma única vez |

## Registros operacionais

| Dado | Onde | Retenção |
|---|---|---|
| Auditoria | `audit_logs` (append-only, sem tokens nem segredos) | 2 anos (piso imposto por trigger) |
| Tentativas de envio | `delivery_attempts` (alvo = hash do token, nunca o token) | 180 dias* |
| Envios e notificações | `deliveries`, `notifications` | 2 anos* |
| Logs da aplicação | stdout (pino com redact) | Conforme a plataforma de logs |
