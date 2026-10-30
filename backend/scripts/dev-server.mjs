#!/usr/bin/env node
/**
 * Local Node.js HTTP Server hosting the Cloudflare Worker (`src/index.js`)
 * backed by local SQLite (`backend/.local/dev.sqlite`) and `.dev.vars`.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';
import { createSqliteD1Adapter } from '../src/db/d1-sqlite-adapter.js';
import { runMigrations } from '../src/db/migrator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

export function loadDotDevVars(filePath = path.join(backendRoot, '.dev.vars')) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

export function createNodeRequestHandler(baseEnv, { host = '127.0.0.1', port = 8787 } = {}) {
  return async (req, res) => {
    try {
      const originHost = req.headers.host || `${host}:${port}`;
      const fullUrl = `http://${originHost}${req.url || '/'}`;

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) {
          for (const item of v) headers.append(k, item);
        } else if (typeof v === 'string') {
          headers.set(k, v);
        }
      }

      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      let bodyBuffer = undefined;
      if (hasBody) {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        bodyBuffer = Buffer.concat(chunks);
      }

      const webRequest = new Request(fullUrl, {
        method: req.method,
        headers,
        body: hasBody && bodyBuffer && bodyBuffer.length > 0 ? bodyBuffer : undefined
      });

      const webResponse = await worker.fetch(webRequest, baseEnv, {});

      res.statusCode = webResponse.status;
      const setCookies = typeof webResponse.headers.getSetCookie === 'function'
        ? webResponse.headers.getSetCookie()
        : [];
      if (setCookies.length > 0) {
        res.setHeader('Set-Cookie', setCookies);
      }

      webResponse.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') return;
        res.setHeader(key, value);
      });

      const arrayBuf = await webResponse.arrayBuffer();
      res.end(Buffer.from(arrayBuf));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        ok: false,
        error: {
          code: 'LOCAL_SERVER_ERROR',
          message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์พัฒนา'
        }
      }));
    }
  };
}

export async function startLocalWorkerServer({
  port = Number(process.env.PORT || 8787),
  host = '127.0.0.1',
  dbPath = path.join(backendRoot, '.local', 'dev.sqlite'),
  envOverrides = {},
  listen = true
} = {}) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = createSqliteD1Adapter(dbPath);
  await runMigrations(db);

  const fileVars = loadDotDevVars();
  const baseEnv = {
    APP_ENV: 'development',
    FRONTEND_ORIGIN: 'http://localhost:8080',
    ALLOWED_ORIGINS: 'http://localhost:8080,http://127.0.0.1:8080',
    COOKIE_SAME_SITE: 'Lax',
    SESSION_TTL_SECONDS: '604800',
    POLICY_VERSION: '2026-01',
    ...fileVars,
    ...process.env,
    ...envOverrides,
    DB: db
  };

  const handler = createNodeRequestHandler(baseEnv, { host, port });
  const server = http.createServer(handler);

  let actualPort = port;
  if (listen) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    const address = server.address();
    actualPort = typeof address === 'object' && address ? address.port : port;
  }

  return {
    server,
    handler,
    db,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    async close() {
      if (server.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
      db.close();
    }
  };
}

// Run directly if invoked as CLI entrypoint
const isMainModule = Boolean(
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
);

if (isMainModule) {
  const instance = await startLocalWorkerServer();
  console.log(JSON.stringify({
    event: 'local_worker.started',
    url: instance.url,
    healthUrl: `${instance.url}/api/v1/health`
  }));

  const shutdown = async () => {
    await instance.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
