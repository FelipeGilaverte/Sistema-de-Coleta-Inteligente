'use strict';

const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { execFile } = require('node:child_process');
const { openDatabase, OperationError } = require('./database.cjs');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8765;
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/dashboard-model.js': ['dashboard-model.js', 'text/javascript; charset=utf-8'],
  '/dashboard.js': ['dashboard.js', 'text/javascript; charset=utf-8'],
};

function respond(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new OperationError(415, 'Envie os dados como JSON.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 4096) {
      req.resume();
      throw new OperationError(413, 'Requisição muito grande.');
    }
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new OperationError(400, 'O corpo da requisição deve ser um objeto JSON.');
  }
}

function createLocalServer({
  filename = join(__dirname, 'data', 'ecocondominio.sqlite'),
  clock,
} = {}) {
  const database = openDatabase(filename, clock);
  const server = createServer(async (req, res) => {
    try {
      const boundPort = server.address().port ?? DEFAULT_PORT;
      const allowedHosts = [`${HOST}:${boundPort}`, `localhost:${boundPort}`];
      if (!allowedHosts.includes(req.headers.host)) {
        throw new OperationError(403, 'Use o endereço local exibido ao iniciar o EcoCondomínio.');
      }
      const path = new URL(req.url, `http://${HOST}`).pathname;
      if (req.method === 'GET' && Object.hasOwn(files, path)) {
        const [name, type] = files[path];
        let content = readFileSync(join(__dirname, name), 'utf8');
        if (name === 'index.html') content = content.replace('<body>', '<body data-sqlite="true">');
        return respond(res, 200, content, type);
      }
      if (req.method === 'GET' && path === '/api/initial') {
        return respond(res, 200, { history: database.getHistory(), state: database.getState() });
      }
      if (req.method === 'GET' && path === '/api/state') {
        return respond(res, 200, database.getState());
      }
      if (req.method === 'POST' && path.startsWith('/api/')) {
        const origin = req.headers.origin;
        if (origin && !allowedHosts.some(host => origin === `http://${host}`)) {
          throw new OperationError(403, 'A operação deve ser iniciada na aplicação local.');
        }
        const data = await readJson(req);
        if (path === '/api/readings') {
          return respond(res, 201, database.registerReading(data.sensorId, data.occupancy));
        }
        if (path === '/api/readings/refresh') return respond(res, 200, database.refreshReadings());
        if (path === '/api/routes') {
          const route = database.generateRoute();
          return respond(res, route ? 201 : 200, { route, state: database.getState() });
        }
        if (path === '/api/collections') {
          return respond(res, 201, database.registerCollection(data.pointId, data.responsible));
        }
      }
      respond(res, 404, { error: 'Endereço não encontrado.' });
    } catch (error) {
      if (error instanceof OperationError) return respond(res, error.status, { error: error.message });
      console.error(error);
      respond(res, 500, { error: 'Erro no banco de dados local. Consulte o terminal.' });
    }
  });
  server.once('close', () => database.close());
  return server;
}

function openBrowser(url) {
  const launch = process.platform === 'win32' ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
    : process.platform === 'darwin' ? ['open', url] : ['xdg-open', url];
  execFile(launch[0], launch.slice(1), error => {
    if (error) console.log(`Abra manualmente no navegador: ${url}`);
  });
}

if (require.main === module) {
  try {
    const port = Number(process.env.ECO_PORT ?? DEFAULT_PORT);
    const filename = process.env.ECO_DB_PATH ? resolve(process.env.ECO_DB_PATH) : undefined;
    const server = createLocalServer({ filename });
    server.once('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `A porta ${port} já está em uso.` : error.message);
      process.exitCode = 1;
    });
    server.once('listening', () => {
      const url = `http://${HOST}:${server.address().port}/`;
      console.log(`EcoCondomínio IA: ${url}\nMantenha esta janela aberta durante o uso. Ctrl+C encerra o servidor.`);
      if (process.argv.includes('--open')) openBrowser(url);
    });
    server.listen(port, HOST);
  } catch (error) {
    console.error(`Não foi possível iniciar o EcoCondomínio: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { createLocalServer };
