import { describe, expect, it } from 'vitest';
import { maskEmail, maskToken, normalizeEmail } from './masking.js';
import { buildProblem, problemTypeUri, PROBLEMS } from './problem.js';

describe('problem details', () => {
  it('builds RFC 7807 bodies without internal details', () => {
    expect(buildProblem('notFound', 'cid-12345678')).toEqual({
      type: 'urn:notify:problem:not-found',
      title: 'Recurso não encontrado.',
      status: 404,
      correlationId: 'cid-12345678',
    });
  });

  it('includes field errors and detail only when provided', () => {
    const problem = buildProblem('validation', 'cid', {
      detail: 'Verifique os campos.',
      errors: [{ path: 'name', code: 'too_small', message: 'Muito curto' }],
    });
    expect(problem.errors).toHaveLength(1);
    expect(problem.detail).toBe('Verifique os campos.');
    expect(buildProblem('validation', 'cid', { errors: [] })).not.toHaveProperty('errors');
  });

  it('maps every kind to a stable URN and an HTTP error status', () => {
    for (const kind of Object.keys(PROBLEMS) as (keyof typeof PROBLEMS)[]) {
      expect(problemTypeUri(kind)).toMatch(/^urn:notify:problem:[a-z-]+$/);
      expect(PROBLEMS[kind].status).toBeGreaterThanOrEqual(400);
    }
  });
});

describe('masking', () => {
  it('masks tokens', () => {
    expect(maskToken('abcdefghijklmnopwxyz')).toBe('abcd…wxyz');
    expect(maskToken('short')).toBe('•••••');
    expect(maskToken('')).toBe('');
  });

  it('masks e-mails', () => {
    expect(maskEmail('joana@exemplo.com.br')).toBe('jo•••@exemplo.com.br');
    expect(maskEmail('a@x.com')).toBe('a•••@x.com');
    expect(maskEmail('invalid')).toBe('•••');
  });

  it('normalizes e-mails', () => {
    expect(normalizeEmail('  Joana@Exemplo.COM ')).toBe('joana@exemplo.com');
  });
});
