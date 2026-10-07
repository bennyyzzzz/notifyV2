# ADR 0003 — Criptografia em envelope e formato das chaves

- Status: aceito
- Data: 2026-10-07
- Fase: 1
- Relacionado: V1-08, V1-09, seção 7.2

## Contexto

A v1 usava AES-256-CBC sem autenticação, chave derivada por SHA-256 de uma frase e fallback `"default-secret-key"`.

## Decisão

- **AES-256-GCM** com IV aleatório de 12 bytes e tag de 16 bytes.
- **Envelope**: cada registro tem uma DEK aleatória de 32 bytes. A DEK cifra o dado; a KEK cifra a DEK. A DEK é zerada da memória após o uso.
- **Contexto como AAD**: a cifra é ligada ao registro (ex.: `firebase_integration:<id>`). Copiar o ciphertext para outro registro faz a decifragem falhar.
- **KEK**: interface `KeyEncryptionProvider`. A implementação local (`LocalKeyRing`) lê `ENCRYPTION_KEYS=keyId:base64,...` e `ENCRYPTION_ACTIVE_KEY_ID`. Um provedor KMS pode ser plugado sem mudar quem chama.
- **Formato da DEK cifrada**: `versão(1) | iv(12) | tag(16) | ciphertext(32)`.
- **Rotação**: `rewrapEnvelope` re-cifra só a DEK com a chave ativa; o dado não é tocado. O job de re-encriptação entra na Fase 3.
- **Chaves fracas são recusadas**: cada chave precisa ter exatamente 32 bytes em base64 canônico. São rejeitadas chaves que parecem texto (frase) ou têm entropia baixa. Não existe derivação a partir de frase nem chave padrão.
- **Tokens opacos** (refresh, convite, reset, server keys) são armazenados só como HMAC-SHA256 com `TOKEN_PEPPER`. Senhas usarão argon2id (Fase 2).
- **Validação de env**: API e worker não sobem se faltar uma chave, se ela for fraca ou se contiver marcadores de placeholder (`change-me`, `minha-chave`...). A mensagem de erro lista o nome da variável, nunca o valor.

## Consequências

- Perder todas as KEKs torna os dados cifrados irrecuperáveis. As chaves vão para o secret manager com backup.
- Toda chave antiga deve ficar no anel até o job de rotação terminar.
