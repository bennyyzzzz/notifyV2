import { TenantContextMissingError, TenantScopeViolationError } from '@notify/db';
import { buildProblem, PROBLEM_CONTENT_TYPE, type FieldError, type ProblemKind } from '@notify/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { HttpProblem } from '../errors.js';

const FASTIFY_CODE_TO_KIND: Readonly<Record<string, ProblemKind>> = {
  FST_ERR_CTP_BODY_TOO_LARGE: 'payloadTooLarge',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'unsupportedMediaType',
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: 'badRequest',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'badRequest',
  FST_ERR_CTP_INVALID_JSON_BODY: 'badRequest',
  FST_ERR_VALIDATION: 'validation',
};

const STATUS_TO_KIND: Readonly<Record<number, ProblemKind>> = {
  400: 'badRequest',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  405: 'methodNotAllowed',
  409: 'conflict',
  413: 'payloadTooLarge',
  415: 'unsupportedMediaType',
  428: 'preconditionRequired',
  429: 'rateLimited',
  503: 'serviceUnavailable',
};

export function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  kind: ProblemKind,
  extra: { detail?: string; errors?: FieldError[] } = {},
): FastifyReply {
  const problem = buildProblem(kind, request.id, extra);
  return reply.code(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
}

function zodFieldErrors(error: unknown): FieldError[] {
  if (!hasZodFastifySchemaValidationErrors(error)) return [];
  return error.validation.map((issue) => ({
    path: issue.instancePath.replace(/^\//, '').replaceAll('/', '.') || '(root)',
    code: issue.keyword,
    message: issue.message ?? 'Valor inválido.',
  }));
}

/**
 * Single exit point for errors: RFC 7807 body, generic message, correlationId (V1-12).
 * Internal error messages, stacks and library details are logged, never returned.
 */
export const errorHandlerPlugin = fp(
  async (app: FastifyInstance) => {
    app.setErrorHandler((error: FastifyError, request, reply) => {
      if (error instanceof HttpProblem) {
        if (error.cause !== undefined) request.log.warn({ err: error.cause, kind: error.kind }, 'request rejected');
        const extra: { detail?: string; errors?: FieldError[] } = {};
        if (error.detail !== undefined) extra.detail = error.detail;
        if (error.fieldErrors !== undefined) extra.errors = error.fieldErrors;
        return sendProblem(request, reply, error.kind, extra);
      }

      if (hasZodFastifySchemaValidationErrors(error)) {
        return sendProblem(request, reply, 'validation', { errors: zodFieldErrors(error) });
      }

      if (isResponseSerializationError(error)) {
        request.log.error({ err: error }, 'response failed schema serialization');
        return sendProblem(request, reply, 'internal');
      }

      if (error instanceof TenantScopeViolationError || error instanceof TenantContextMissingError) {
        // Always a programming error: a repository tried to cross or skip the tenant boundary.
        request.log.error({ err: error, security: true }, 'tenant isolation guard triggered');
        return sendProblem(request, reply, 'internal');
      }

      const byCode = error.code !== undefined ? FASTIFY_CODE_TO_KIND[error.code] : undefined;
      const byStatus =
        typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500
          ? (STATUS_TO_KIND[error.statusCode] ?? 'badRequest')
          : undefined;
      const kind = byCode ?? byStatus;
      if (kind !== undefined) {
        request.log.info({ code: error.code, statusCode: error.statusCode }, 'client error');
        return sendProblem(request, reply, kind);
      }

      request.log.error({ err: error }, 'unhandled error');
      return sendProblem(request, reply, 'internal');
    });

    app.setNotFoundHandler((request, reply) => sendProblem(request, reply, 'notFound'));
  },
  { name: 'notify-error-handler' },
);
