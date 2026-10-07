# Política de segurança

## Como reportar uma vulnerabilidade

**Não abra issue pública.** Envie o relato pelo canal privado de segurança da equipe (GitHub Security Advisories do repositório → "Report a vulnerability") com:

- descrição e impacto esperado;
- passos para reproduzir ou prova de conceito;
- versão, commit ou ambiente afetado.

Prazos:

| Etapa | Prazo |
|---|---|
| Confirmação de recebimento | 2 dias úteis |
| Avaliação inicial | 5 dias úteis |
| Correção de achados críticos e altos | Priorizada antes de qualquer outra entrega |

Pedimos divulgação coordenada: aguarde a correção antes de publicar.

## Escopo

API (`apps/api`), worker (`apps/worker`), SDK, painel web e infraestrutura descrita neste repositório.

Fora do escopo:

- DoS volumétrico;
- engenharia social;
- vulnerabilidades em dependências sem caminho de exploração no Notify.

## Práticas adotadas

- Nenhum segredo no repositório: Gitleaks no CI e no pre-commit (`lefthook.yml`).
- Validação de ambiente na inicialização; segredos fracos impedem o processo de subir.
- SAST (Semgrep), auditoria de dependências (`pnpm audit`) e scan de imagens (Trivy) no CI.
- Testes de regressão para cada falha conhecida da v1 (`tests/security/regressions`).

## Segredos da v1

O `.env` da v1 foi distribuído com segredos em texto e com credencial padrão de administrador. **Considere todos os segredos da v1 comprometidos e rotacione-os**: chaves de criptografia, segredo JWT, Service Accounts do Firebase e senhas de banco e de usuários.
