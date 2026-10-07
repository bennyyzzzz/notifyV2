/**
 * RFC 7807 problem details. Responses never carry internal messages (V1-12):
 * only a stable `type`, a generic pt-BR `title`, the status and a `correlationId`
 * that support can match against server logs.
 */

export interface FieldError {
  /** Dotted path of the invalid field, e.g. `offer.discountPercent`. */
  path: string;
  /** Machine-readable reason (zod issue code). */
  code: string;
  /** User-facing pt-BR message. */
  message: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  correlationId: string;
  detail?: string;
  errors?: FieldError[];
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

export const PROBLEMS = {
  validation: { status: 400, title: 'Dados inválidos.' },
  badRequest: { status: 400, title: 'Requisição inválida.' },
  unauthorized: { status: 401, title: 'Autenticação necessária.' },
  forbidden: { status: 403, title: 'Você não tem permissão para esta ação.' },
  notFound: { status: 404, title: 'Recurso não encontrado.' },
  methodNotAllowed: { status: 405, title: 'Método não permitido.' },
  conflict: { status: 409, title: 'O recurso está em um estado que não permite esta ação.' },
  versionConflict: { status: 409, title: 'Esta notificação foi alterada por outra pessoa.' },
  payloadTooLarge: { status: 413, title: 'Conteúdo maior que o permitido.' },
  unsupportedMediaType: { status: 415, title: 'Tipo de conteúdo não suportado.' },
  preconditionRequired: { status: 428, title: 'Cabeçalho de pré-condição obrigatório.' },
  rateLimited: { status: 429, title: 'Muitas requisições. Tente novamente em instantes.' },
  internal: { status: 500, title: 'Erro interno. Tente novamente mais tarde.' },
  serviceUnavailable: { status: 503, title: 'Serviço temporariamente indisponível.' },
} as const satisfies Record<string, { status: number; title: string }>;

export type ProblemKind = keyof typeof PROBLEMS;

export function problemTypeUri(kind: ProblemKind): string {
  return `urn:notify:problem:${kind.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

export function buildProblem(
  kind: ProblemKind,
  correlationId: string,
  extra: { detail?: string; errors?: FieldError[] } = {},
): ProblemDetails {
  const { status, title } = PROBLEMS[kind];
  const problem: ProblemDetails = { type: problemTypeUri(kind), title, status, correlationId };
  if (extra.detail !== undefined) problem.detail = extra.detail;
  if (extra.errors !== undefined && extra.errors.length > 0) problem.errors = extra.errors;
  return problem;
}
