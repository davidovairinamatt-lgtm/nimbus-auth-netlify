import crypto from 'node:crypto';

const SESSION_DAYS = 30;
const MAX_BODY = 16 * 1024;
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 128;
const DAY = 24 * 60 * 60 * 1000;
const ACCOUNT_PREFIX = 'account/';
const SESSION_PREFIX = 'session/';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

const hits = new Map();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

/** Same UUID Minecraft derives for offline-mode players. */
function offlineUuid(name) {
  const bytes = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

function clientIp(req) {
  return (
    req.headers.get('x-nf-client-connection-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function checkCredentials({ username, password, repeat }, isRegister) {
  const name = String(username || '').trim();
  const pass = String(password || '');
  if (!NAME_RE.test(name)) {
    return { error: 'Ник: от 3 до 16 символов, только латиница, цифры и _' };
  }
  if (pass.length < MIN_PASSWORD || pass.length > MAX_PASSWORD) {
    return { error: `Пароль: от ${MIN_PASSWORD} до ${MAX_PASSWORD} символов` };
  }
  if (isRegister && pass !== String(repeat || '')) {
    return { error: 'Пароли не совпадают' };
  }
  return { name, pass };
}

function userView(record) {
  return {
    username: record.displayName,
    uuid: offlineUuid(record.displayName),
    createdAt: Number(record.createdAt)
  };
}

function bearer(req) {
  const header = req.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7);
}

async function readJson(req) {
  const length = Number(req.headers.get('content-length') || 0);
  if (length > MAX_BODY) throw new Error('too large');
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY) throw new Error('too large');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('bad json');
  }
}

/**
 * store: {
 *   get(key) -> { data, etag } | null
 *   set(key, value, { onlyIfNew, onlyIfMatch }) -> { modified, etag }
 *   delete(key) -> void
 * }
 */
export function createHandler(store) {
  async function createSession(key) {
    const token = crypto.randomBytes(32).toString('base64url');
    const result = await store.set(
      SESSION_PREFIX + token,
      { key, expires: Date.now() + SESSION_DAYS * DAY },
      { onlyIfNew: true }
    );
    if (!result.modified) return createSession(key);
    return token;
  }

  async function mutateAccount(key, update) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const entry = await store.get(ACCOUNT_PREFIX + key);
      if (!entry) return null;
      const next = update(entry.data);
      const result = await store.set(ACCOUNT_PREFIX + key, next, { onlyIfMatch: entry.etag });
      if (result.modified) return next;
    }
    return null;
  }

  return async function handler(req) {
    const method = req.method;
    const path = new URL(req.url).pathname;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      if (method === 'GET' && path === '/api/health') {
        return respond({ ok: true, service: 'nimbus-auth', version: 1, storage: 'netlify-blobs' });
      }

      const now = Date.now();
      const ip = clientIp(req);

      if (method === 'POST' && path === '/api/register') {
        if (limited(`reg:${ip}`, 10, 60 * 60 * 1000)) {
          return respond({ ok: false, error: 'Слишком много регистраций с этого адреса, попробуй позже' }, 429);
        }
        const body = await readJson(req);
        const check = checkCredentials(body, true);
        if (check.error) return respond({ ok: false, error: check.error }, 400);

        const key = check.name.toLowerCase();
        const salt = crypto.randomBytes(16).toString('hex');
        const record = {
          displayName: check.name,
          salt,
          hash: hashPassword(check.pass, salt),
          createdAt: now,
          lastLogin: now,
          failedCount: 0,
          failedAt: 0
        };
        const result = await store.set(ACCOUNT_PREFIX + key, record, { onlyIfNew: true });
        if (!result.modified) {
          return respond({ ok: false, error: 'Этот ник уже занят' }, 409);
        }
        const token = await createSession(key);
        return respond({ ok: true, token, user: userView(record) }, 201);
      }

      if (method === 'POST' && path === '/api/login') {
        if (limited(`login:${ip}`, 60, 10 * 60 * 1000)) {
          return respond({ ok: false, error: 'Слишком много запросов, подожди несколько минут' }, 429);
        }
        const body = await readJson(req);
        const check = checkCredentials(body, false);
        if (check.error) return respond({ ok: false, error: check.error }, 400);

        const key = check.name.toLowerCase();
        const entry = await store.get(ACCOUNT_PREFIX + key);
        if (!entry) {
          return respond({ ok: false, error: 'Неверный ник или пароль' }, 401);
        }

        const record = entry.data;
        const failedAt = Number(record.failedAt || 0);
        const windowStart = now - 15 * 60 * 1000;
        if (failedAt > windowStart && Number(record.failedCount) >= 8) {
          return respond({ ok: false, error: 'Слишком много неверных попыток. Подожди 15 минут' }, 429);
        }

        const given = Buffer.from(hashPassword(check.pass, record.salt), 'hex');
        const expected = Buffer.from(record.hash, 'hex');
        if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
          await mutateAccount(key, (current) => {
            const within = Number(current.failedAt || 0) > windowStart;
            return {
              ...current,
              failedCount: within ? Number(current.failedCount || 0) + 1 : 1,
              failedAt: now
            };
          });
          return respond({ ok: false, error: 'Неверный ник или пароль' }, 401);
        }

        await mutateAccount(key, (current) => ({
          ...current,
          failedCount: 0,
          failedAt: 0,
          lastLogin: now
        }));
        const token = await createSession(key);
        return respond({ ok: true, token, user: userView(record) });
      }

      if (method === 'GET' && path === '/api/me') {
        const token = bearer(req);
        if (!token) {
          return respond({ ok: false, error: 'Сессия истекла, войди снова' }, 401);
        }
        const session = await store.get(SESSION_PREFIX + token);
        if (!session) {
          return respond({ ok: false, error: 'Сессия истекла, войди снова' }, 401);
        }
        if (Number(session.data.expires) <= now) {
          await store.delete(SESSION_PREFIX + token);
          return respond({ ok: false, error: 'Сессия истекла, войди снова' }, 401);
        }
        const account = await store.get(ACCOUNT_PREFIX + session.data.key);
        if (!account) {
          return respond({ ok: false, error: 'Сессия истекла, войди снова' }, 401);
        }
        return respond({ ok: true, user: userView(account.data) });
      }

      if (method === 'POST' && path === '/api/logout') {
        const token = bearer(req);
        if (token) await store.delete(SESSION_PREFIX + token);
        return respond({ ok: true });
      }

      return respond({ ok: false, error: 'Нет такого адреса' }, 404);
    } catch (error) {
      if (error.message === 'bad json' || error.message === 'too large') {
        return respond({ ok: false, error: 'Некорректный запрос' }, 400);
      }
      console.error('[auth]', error);
      return respond({ ok: false, error: 'Внутренняя ошибка сервера' }, 500);
    }
  };
}
