import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { fakeHasher, queryable, testConfig } from './helpers.js';

const dbUp = () => Promise.resolve({ rows: [{ ok: 1 }] });
const dbDown = () => Promise.reject(new Error('connection refused'));

function appWith(query: () => Promise<{ rows: unknown[] }>) {
  return createApp({
    config: testConfig,
    db: queryable(query),
    hasher: fakeHasher(),
  });
}

describe('GET /api/health', () => {
  it('reports liveness without touching the database', async () => {
    const query = vi.fn(dbDown);

    const response = await request(appWith(query)).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    // The point of liveness: a dead database must not fail this probe.
    expect(query).not.toHaveBeenCalled();
  });
});

describe('GET /api/health/ready', () => {
  it('reports ready when the database answers', async () => {
    const response = await request(appWith(dbUp)).get('/api/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready', db: 'up' });
  });

  it('reports 503 when the database does not answer', async () => {
    const response = await request(appWith(dbDown)).get('/api/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready', db: 'down' });
  });
});

describe('error shape', () => {
  it('returns the documented envelope for an unknown route', async () => {
    const response = await request(appWith(dbUp)).get('/api/definitely-not-a-route');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
  });

  it('does not advertise the server technology', async () => {
    const response = await request(appWith(dbUp)).get('/api/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
