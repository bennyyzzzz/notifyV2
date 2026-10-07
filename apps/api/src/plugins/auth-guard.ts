import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { HttpProblem } from '../errors.js';

/**
 * §6.3 rule 1 — deny by default. Only these paths may be declared public; any other route
 * declaring `config.auth = 'public'` makes the server fail at startup (V1-01, V1-04, V1-05).
 */
export const PUBLIC_ROUTE_ALLOWLIST: readonly RegExp[] = [
  /^\/api\/v1\/auth\/login$/,
  /^\/api\/v1\/auth\/mfa\/verify$/,
  /^\/api\/v1\/auth\/refresh$/,
  /^\/api\/v1\/auth\/password-reset\/[a-z-]+$/,
  /^\/api\/v1\/auth\/invite\/accept$/,
  /^\/v1\/ingest\/[a-z-]+$/,
  /^\/health\/[a-z-]+$/,
  /^\/sdk\/.+$/,
];

export function isAllowlistedPublicRoute(url: string): boolean {
  return PUBLIC_ROUTE_ALLOWLIST.some((pattern) => pattern.test(url));
}

export interface Principal {
  userId: string;
  sessionId: string;
}

/** Resolves the caller from the request (access token). Phase 2 provides the real implementation. */
export type Authenticator = (request: FastifyRequest) => Promise<Principal | null>;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Omit for authenticated routes (the default). */
    auth?: 'public';
  }
  interface FastifyRequest {
    principal: Principal | null;
  }
}

export const denyAllAuthenticator: Authenticator = async () => null;

export const authGuardPlugin = fp(
  async (app: FastifyInstance, options: { authenticate: Authenticator }) => {
    app.decorateRequest('principal', null);

    const requireAuthentication = async (request: FastifyRequest): Promise<void> => {
      const principal = await options.authenticate(request);
      if (principal === null) {
        throw new HttpProblem('unauthorized');
      }
      request.principal = principal;
    };

    // Attached per route (not as a global hook) so it runs AFTER the rate limiter's
    // route-level hook: unauthenticated floods are still rate limited.
    app.addHook('onRoute', (route) => {
      if (route.config?.auth === 'public') {
        if (!isAllowlistedPublicRoute(route.url)) {
          throw new Error(`Route ${route.method} ${route.url} is declared public but is not in the public allowlist`);
        }
        return;
      }
      const existing = route.onRequest === undefined ? [] : Array.isArray(route.onRequest) ? route.onRequest : [route.onRequest];
      route.onRequest = [...existing, requireAuthentication];
    });
  },
  { name: 'notify-auth-guard' },
);
