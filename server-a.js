// Server A: animal service and website. Adoption requests are forwarded to Server B.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 3000);
const ADOPTION_SERVICE_URL = process.env.ADOPTION_SERVICE_URL || 'http://server-b:3001';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const html = fs.readFileSync(path.join(__dirname, 'index.html'));
const adminHtml = fs.readFileSync(path.join(__dirname, 'admin.html'));

const ANIMAL_COLUMNS = `id, name, type, age, breed,
  fur_color AS "furColor", dark_color AS "darkColor", light_color AS "lightColor",
  bg_color AS "bgColor", ear_style AS "earStyle", description, needs, status`;

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  try {
    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
    }
    if (req.method === 'GET' && pathname === '/admin') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(adminHtml);
    }
    if (req.method === 'GET' && pathname === '/health') return send(res, 200, { status: 'ok', service: 'server-a' });

    if (req.method === 'GET' && pathname === '/animals') {
      const result = await pool.query(`SELECT ${ANIMAL_COLUMNS} FROM animals ORDER BY sort_order`);
      return send(res, 200, result.rows);
    }

    const animalMatch = pathname.match(/^\/animals\/([^/]+)$/);
    if (req.method === 'GET' && animalMatch) {
      const result = await pool.query(`SELECT ${ANIMAL_COLUMNS} FROM animals WHERE id = $1`, [decodeURIComponent(animalMatch[1])]);
      if (!result.rows.length) return send(res, 404, { error: 'Eläintä ei löytynyt', code: 'NOT_FOUND' });
      return send(res, 200, result.rows[0]);
    }

    const adoptMatch = pathname.match(/^\/animals\/([^/]+)\/adopt$/);
    if (req.method === 'POST' && adoptMatch) {
      const id = decodeURIComponent(adoptMatch[1]);
      const input = await readBody(req);
      const response = await fetch(`${ADOPTION_SERVICE_URL}/adoptions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, animalId: id })
      });
      const data = await response.json();
      return send(res, response.status, data);
    }

    // The admin page uses Server A as a same-origin gateway to Server B.
    if (req.method === 'GET' && pathname === '/api/adoptions') {
      const response = await fetch(`${ADOPTION_SERVICE_URL}/adoptions`, {
        headers: { authorization: req.headers.authorization || '' }
      });
      const data = await response.json();
      return send(res, response.status, data);
    }

    return send(res, 404, { error: 'Reittiä ei löytynyt', code: 'NOT_FOUND' });
  } catch (error) {
    console.error('Server A error:', error);
    return send(res, 500, { error: 'Palvelimessa tapahtui virhe', code: 'INTERNAL' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Server A (animals) listening on ${PORT}`));
