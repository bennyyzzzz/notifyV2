/**
 * Database-level guarantees, run against a real PostgreSQL with migrations applied and the
 * runtime role (notify_app). Enabled when TEST_DATABASE_URL is set (CI service container).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, type DbClient } from './client.js';
import { TenantContextMissingError, withSystemScope, withTenant } from './tenant/context.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(url === undefined)('database guarantees (integration)', () => {
  let db: DbClient;
  const run = randomBytes(4).toString('hex');
  const ids = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    appA: randomUUID(),
    appB: randomUUID(),
    fbA: randomUUID(),
    fbB: randomUUID(),
    campaignB: randomUUID(),
    user: randomUUID(),
    outsider: randomUUID(),
  };

  const bytes = () => randomBytes(16);
  const firebase = (id: string, organizationId: string, appId: string, projectId: string) => ({
    id,
    organizationId,
    appId,
    name: 'Firebase',
    projectId,
    clientEmail: `svc@${projectId}.iam.gserviceaccount.com`,
    privateKeyCiphertext: bytes(),
    dekCiphertext: bytes(),
    keyId: 'k1',
    iv: randomBytes(12),
    authTag: randomBytes(16),
  });
  const notification = (organizationId: string, appId: string, firebaseIntegrationId: string, extra: Record<string, unknown> = {}) => ({
    organizationId,
    appId,
    firebaseIntegrationId,
    title: 'Oferta',
    body: 'Aproveite hoje',
    redirectUrl: 'https://loja.example/x',
    trackedUrl: 'https://loja.example/x?utm_medium=push',
    audienceType: 'topic' as const,
    audienceRef: { topic: 'news' },
    ...extra,
  });

  beforeAll(async () => {
    db = createDbClient({ connectionString: url! });
    await withSystemScope('integration test setup', async () => {
      await db.organization.createMany({
        data: [
          { id: ids.orgA, name: 'Org A', slug: `org-a-${run}` },
          { id: ids.orgB, name: 'Org B', slug: `org-b-${run}` },
        ],
      });
      await db.app.createMany({
        data: [
          { id: ids.appA, organizationId: ids.orgA, name: 'App A', platform: 'web' },
          { id: ids.appB, organizationId: ids.orgB, name: 'App B', platform: 'web' },
        ],
      });
      await db.firebaseIntegration.createMany({
        data: [firebase(ids.fbA, ids.orgA, ids.appA, `proj-a-${run}`), firebase(ids.fbB, ids.orgB, ids.appB, `proj-b-${run}`)],
      });
      await db.campaign.create({
        data: {
          id: ids.campaignB,
          organizationId: ids.orgB,
          appId: ids.appB,
          name: 'Campanha B',
          slug: 'campanha-b',
          theme: 't',
          segment: 's',
          tone: 'direto',
          redirectUrl: 'https://b.example',
        },
      });
      await db.user.createMany({
        data: [
          { id: ids.user, name: 'Ana', email: `ana-${run}@example.com` },
          { id: ids.outsider, name: 'Bia', email: `bia-${run}@example.com` },
        ],
      });
      await db.organizationMember.create({ data: { organizationId: ids.orgA, userId: ids.user, role: 'member' } });
    });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it('V1-03: rejects a notification that uses another app’s Firebase integration (composite FK)', async () => {
    await expect(
      withSystemScope('integration test', () => db.notification.create({ data: notification(ids.orgA, ids.appA, ids.fbB) })),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects rows whose app belongs to another organization', async () => {
    await expect(
      withSystemScope('integration test', () => db.notification.create({ data: notification(ids.orgB, ids.appA, ids.fbA) })),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects optional references across apps (trigger)', async () => {
    await expect(
      withSystemScope('integration test', () =>
        db.notification.create({ data: notification(ids.orgA, ids.appA, ids.fbA, { campaignId: ids.campaignB }) }),
      ),
      // campaignB exists, so the single-column FK passes: only the same-app trigger can reject this.
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('§7.1: only members of the organization can be added to its apps', async () => {
    await withSystemScope('integration test', () =>
      db.appMember.create({ data: { organizationId: ids.orgA, appId: ids.appA, userId: ids.user, role: 'operator' } }),
    );
    await expect(
      withSystemScope('integration test', () =>
        db.appMember.create({ data: { organizationId: ids.orgA, appId: ids.appA, userId: ids.outsider, role: 'viewer' } }),
      ),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('§7.2: one active integration per (app, project); revoked ones do not count', async () => {
    const duplicate = firebase(randomUUID(), ids.orgA, ids.appA, `proj-a-${run}`);
    await expect(withSystemScope('integration test', () => db.firebaseIntegration.create({ data: duplicate }))).rejects.toMatchObject({
      code: 'P2002',
    });
    await withSystemScope('integration test', () =>
      db.firebaseIntegration.create({ data: { ...duplicate, revokedAt: new Date(), status: 'revoked' } }),
    );
  });

  it('V1-02: the tenant guard isolates reads and fails closed without context', async () => {
    await withSystemScope('integration test', () =>
      db.notification.createMany({
        data: [notification(ids.orgA, ids.appA, ids.fbA), notification(ids.orgB, ids.appB, ids.fbB)],
      }),
    );
    const visible = await withTenant({ organizationId: ids.orgA, appId: ids.appA }, () => db.notification.findMany());
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((n) => n.appId === ids.appA && n.organizationId === ids.orgA)).toBe(true);

    const crossTenant = await withTenant({ organizationId: ids.orgA }, () => db.app.findUnique({ where: { id: ids.appB } }));
    expect(crossTenant).toBeNull();

    await expect(db.notification.findMany()).rejects.toBeInstanceOf(TenantContextMissingError);
  });

  it('§7.11: audit logs are append-only for the application role', async () => {
    const entry = await withTenant({ organizationId: ids.orgA }, () =>
      db.auditLog.create({
        data: { actorType: 'system', action: 'test.created', targetType: 'test', correlationId: `cid-${run}` },
      }),
    );
    await expect(
      withSystemScope('integration test', () => db.auditLog.update({ where: { id: entry.id }, data: { action: 'tampered' } })),
    ).rejects.toThrow(/permission denied|append-only/);
    await expect(withSystemScope('integration test', () => db.auditLog.delete({ where: { id: entry.id } }))).rejects.toThrow(
      /permission denied|retained/,
    );
  });

  it('enforces CHECK constraints (normalized e-mail, automation delay bounds)', async () => {
    await expect(
      withSystemScope('integration test', () => db.user.create({ data: { name: 'X', email: `UPPER-${run}@Example.com` } })),
    ).rejects.toThrow(/users_email_lowercase_chk/);
    await expect(
      withSystemScope('integration test', () =>
        db.automationRule.create({
          data: {
            organizationId: ids.orgA,
            appId: ids.appA,
            name: 'r',
            slug: 'r',
            triggerEvent: 'add_to_cart',
            delayMinutes: 20_000,
            firebaseIntegrationId: ids.fbA,
            title: 't',
            body: 'b',
            redirectUrl: 'https://a.example',
          },
        }),
      ),
    ).rejects.toThrow(/automation_rules_delay_chk/);
  });
});
