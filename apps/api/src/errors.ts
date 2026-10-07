import type { FieldError, ProblemKind } from '@notify/shared';

/**
 * Thrown by services/policies to produce an RFC 7807 response. `detail` must be safe to show
 * to the user (pt-BR); internal causes go to `cause` and are only logged.
 */
export class HttpProblem extends Error {
  readonly kind: ProblemKind;
  readonly detail: string | undefined;
  readonly fieldErrors: FieldError[] | undefined;

  constructor(kind: ProblemKind, options: { detail?: string; errors?: FieldError[]; cause?: unknown } = {}) {
    super(kind, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'HttpProblem';
    this.kind = kind;
    this.detail = options.detail;
    this.fieldErrors = options.errors;
  }
}
