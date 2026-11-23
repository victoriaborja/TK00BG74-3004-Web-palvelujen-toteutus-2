// Server B: adoption service. It validates and stores adoption applications in PostgreSQL.
const http = require('http');
const { Pool } = require('pg');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3001);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const str = value => typeof value === 'string' ? value.trim() : '';
const sha = value => crypto.createHash('sha256').update(value).digest();

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1_000_000) reject(new Error('Request too large')); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Virheellinen JSON')); }
    });
    req.on('error', reject);
  });
}
function requireAdmin(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  let password = '';
  if (scheme === 'Basic' && token) {
    const decoded = Buffer.from(token, 'base64').toString();
    password = decoded.slice(decoded.indexOf(':') + 1);
  }
  return Boolean(ADMIN_PASSWORD && crypto.timingSafeEqual(sha(password), sha(ADMIN_PASSWORD)));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'ok', service: 'server-b' });

    if (req.method === 'POST' && url.pathname === '/adoptions') {
      const input = await readBody(req);
      const animalId = str(input.animalId);
      const fullName = str(input.fullName);
      const email = str(input.email);
      const phone = str(input.phone);
      const message = str(input.message);
      if (!animalId) return send(res, 400, { error: 'Eläimen tunniste puuttuu', code: 'BAD_USER_INPUT' });
      if (fullName.split(/\s+/).filter(Boolean).length < 2) return send(res, 400, { error: 'Kirjoita etu- ja sukunimi', code: 'BAD_USER_INPUT' });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: 'Virheellinen sähköpostiosoite', code: 'BAD_USER_INPUT' });
      if (!/^\+?[\d\s-]{7,16}$/.test(phone)) return send(res, 400, { error: 'Virheellinen puhelinnumero', code: 'BAD_USER_INPUT' });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Row locking prevents two simultaneous requests from adopting the same animal.
        const animal = await client.query('SELECT name, status FROM animals WHERE id = $1 FOR UPDATE', [animalId]);
        if (!animal.rows.length) {
          await client.query('ROLLBACK');
          return send(res, 404, { error: 'Eläintä ei löytynyt', code: 'NOT_FOUND' });
        }
        if (animal.rows[0].status === 'adopted') {
          await client.query('ROLLBACK');
          return send(res, 409, { error: `${animal.rows[0].name} on jo adoptoitu`, code: 'ALREADY_ADOPTED' });
        }
        const inserted = await client.query(
          'INSERT INTO adoptions (animal_id, full_name, email, phone, message) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [animalId, fullName, email, phone, message]
        );
        await client.query("UPDATE animals SET status = 'adopted' WHERE id = $1", [animalId]);
        await client.query('COMMIT');
        return send(res, 201, { adoptionId: inserted.rows[0].id, animalName: animal.rows[0].name, message: 'Hakemus vastaanotettu' });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') return send(res, 409, { error: 'Eläimelle on jo tehty adoptiohakemus', code: 'ALREADY_ADOPTED' });
        console.error('Adoption database error:', error);
        return send(res, 500, { error: 'Hakemuksen tallennus epäonnistui', code: 'INTERNAL' });
      } finally {
        client.release();
      }
    }

    if (req.method === 'GET' && url.pathname === '/adoptions') {
      if (!requireAdmin(req)) return send(res, 401, { error: 'Väärä salasana', code: 'UNAUTHORIZED' });
      const result = await pool.query(
        `SELECT a.id, a.animal_id AS "animalId", n.name AS "animalName", a.full_name AS "fullName",
                a.email, a.phone, a.message, a.created_at::text AS "createdAt"
         FROM adoptions a JOIN animals n ON n.id = a.animal_id ORDER BY a.created_at DESC`
      );
      return send(res, 200, result.rows);
    }

    return send(res, 404, { error: 'Reittiä ei löytynyt', code: 'NOT_FOUND' });
  } catch (error) {
    console.error('Server B error:', error);
    return send(res, 500, { error: 'Palvelimessa tapahtui virhe', code: 'INTERNAL' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Server B (adoptions) listening on ${PORT}`));
