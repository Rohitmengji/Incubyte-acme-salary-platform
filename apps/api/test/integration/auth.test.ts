import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, loginAs, prisma, resetDatabase, USERS, WEB_ORIGIN } from './helpers.ts';

const LOGIN = '/api/v1/auth/login';

describe('authentication and sessions', () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it('signs in with an HttpOnly, SameSite=Lax session cookie and never returns the password hash', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post(LOGIN)
      .send({ email: 'Manager@Test.example ', password: USERS.manager.password });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      email: USERS.manager.email,
      displayName: 'Test manager',
      role: 'HR_MANAGER',
    });
    expect(JSON.stringify(res.body)).not.toContain('argon2');
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/^acme_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
  });

  it('stores only an Argon2id hash of the password and a SHA-256 hash of the session token', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post(LOGIN)
      .send({ email: USERS.manager.email, password: USERS.manager.password });
    const token = /acme_session=([^;]+)/.exec(res.headers['set-cookie']?.[0] ?? '')?.[1];

    const user = await prisma.appUser.findUniqueOrThrow({ where: { email: USERS.manager.email } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    const sessions = await prisma.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sessions[0]!.tokenHash).not.toBe(token);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { app } = buildApp();
    const wrongPassword = await request(app)
      .post(LOGIN)
      .send({ email: USERS.manager.email, password: 'nope' });
    const unknownUser = await request(app)
      .post(LOGIN)
      .send({ email: 'ghost@test.example', password: 'nope' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.detail).toBe('Invalid email or password.');
    expect(unknownUser.body.detail).toBe(wrongPassword.body.detail);
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
  });

  it('rejects disabled accounts', async () => {
    const { app } = buildApp();
    await prisma.appUser.update({
      where: { email: USERS.viewer.email },
      data: { isActive: false },
    });
    const res = await request(app)
      .post(LOGIN)
      .send({ email: USERS.viewer.email, password: USERS.viewer.password });
    expect(res.status).toBe(401);
  });

  it('returns the current user for a valid session and 401 without one', async () => {
    const { app } = buildApp();
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    const agent = await loginAs(app, 'viewer');
    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('HR_VIEWER');
  });

  it('revokes the session on logout so the old cookie stops working', async () => {
    const { app } = buildApp();
    const login = await request(app)
      .post(LOGIN)
      .send({ email: USERS.manager.email, password: USERS.manager.password });
    const cookie = login.headers['set-cookie']![0]!.split(';')[0]!;

    const logout = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBe(204);
    expect(logout.headers['set-cookie']?.[0]).toMatch(/acme_session=;/);
    expect(await prisma.session.count()).toBe(0);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('expires sessions after the configured lifetime', async () => {
    const { app, clock } = buildApp({ config: { SESSION_TTL_HOURS: '8' } });
    const agent = await loginAs(app, 'manager');
    clock.advanceBy(8 * 60 * 60 * 1000 - 1000);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    clock.advanceBy(2000);
    const expired = await agent.get('/api/v1/auth/me');
    expect(expired.status).toBe(401);
    expect(expired.body.detail).toMatch(/expired/);
  });

  it('rate-limits repeated failed sign-ins per IP and email, without counting successes', async () => {
    const { app } = buildApp({ config: { LOGIN_RATE_LIMIT: '3' } });
    const attempt = (password: string) =>
      request(app).post(LOGIN).send({ email: USERS.manager.email, password });

    expect((await attempt(USERS.manager.password)).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await attempt('wrong')).status).toBe(401);
    const limited = await attempt(USERS.manager.password);
    expect(limited.status).toBe(429);
    expect(limited.headers['content-type']).toMatch(/application\/problem\+json/);
    // A different account from the same IP is not locked out by someone else's failures.
    expect(
      (
        await request(app)
          .post(LOGIN)
          .send({ email: USERS.viewer.email, password: USERS.viewer.password })
      ).status,
    ).toBe(200);
  });
});

describe('request security', () => {
  beforeEach(resetDatabase);

  it('rejects state-changing requests from a foreign origin but allows the web app origin', async () => {
    const { app } = buildApp();
    const body = { email: USERS.manager.email, password: USERS.manager.password };
    const foreign = await request(app).post(LOGIN).set('Origin', 'https://evil.example').send(body);
    expect(foreign.status).toBe(403);
    const crossSite = await request(app).post(LOGIN).set('Sec-Fetch-Site', 'cross-site').send(body);
    expect(crossSite.status).toBe(403);
    expect((await request(app).post(LOGIN).set('Origin', WEB_ORIGIN).send(body)).status).toBe(200);
  });

  it('only accepts JSON bodies on state-changing requests', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post(LOGIN)
      .type('form')
      .send(`email=${USERS.manager.email}&password=${USERS.manager.password}`);
    expect(res.status).toBe(415);
  });

  it('allows CORS only for the configured web origin, with credentials', async () => {
    const { app } = buildApp();
    const allowed = await request(app)
      .options('/api/v1/employees')
      .set('Origin', WEB_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');
    expect(allowed.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const denied = await request(app)
      .options('/api/v1/employees')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('marks API responses as non-cacheable and sends security headers', async () => {
    const { app } = buildApp();
    const agent = await loginAs(app, 'viewer');
    const res = await agent.get('/api/v1/reference-data');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('returns RFC 9457 problem details with a request id, without internals', async () => {
    const { app } = buildApp();
    const malformed = await request(app)
      .post(LOGIN)
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(malformed.status).toBe(400);
    expect(malformed.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(malformed.body).toEqual({
      type: 'https://acme-salary.example/problems/malformed-json',
      title: 'Malformed JSON',
      status: 400,
      detail: 'The request body is not valid JSON.',
      requestId: malformed.headers['x-request-id'],
    });

    const invalid = await request(app).post(LOGIN).send({ email: '' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.errors).toEqual(
      expect.arrayContaining([
        { path: 'email', message: 'Required' },
        { path: 'password', message: expect.any(String) },
      ]),
    );

    const missing = await request(app).get('/api/v1/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.title).toBe('Not found');
  });

  it('reports database health', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });
});
