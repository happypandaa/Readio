import { resolve, dirname, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, chmod } from 'node:fs/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_MESSAGE = 8192;
let initialized = false;
let stopping = false;
let instanceId;
let server;
let initializePromise;
let pending = Buffer.alloc(0);
let queue = Promise.resolve();
const diagnostic = message => process.stderr.write(`[Readio managed] ${message}\n`);
// stdout is protocol-only; any library logging goes to stderr or is suppressed.
for (const name of ['log', 'info', 'debug', 'warn', 'error']) console[name] = () => diagnostic('Library diagnostic suppressed.');
const emit = (type, extra = {}) => process.stdout.write(`${JSON.stringify({ protocolVersion: 1, type, instanceId, ...extra })}\n`);
const initTimer = setTimeout(() => { diagnostic('Initialization timed out.'); void stop(1); }, 10_000);

function inside(parent, child) {
  const path = relative(parent, child);
  return !path || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function validMessage(message, keys) {
  // Require only the declared keys; accept any extra fields the platform may add.
  return message && typeof message === 'object' && !Array.isArray(message)
    && message.protocolVersion === 1 && keys.every(key => key in message);
}
function id(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value); }

async function initialize(message) {
  if (initialized || initializePromise) throw new Error('initialize received more than once');
  if (!validMessage(message, ['protocolVersion', 'type', 'instanceId', 'token'])) throw new Error('initialize missing required fields or wrong protocolVersion');
  if (!id(message.instanceId)) throw new Error('initialize instanceId invalid');
  if (typeof message.token !== 'string') throw new Error('initialize token is not a string');
  if (!/^[\x21-\x7e]{32,512}$/.test(message.token)) throw new Error('initialize token invalid (must be 32-512 visible ASCII bytes)');
  instanceId = message.instanceId;
  initializePromise = (async () => {
    // Readio keeps its data in the browser (IndexedDB); the backend is stateless.
    // The platform still injects APP_DATA_DIR/CACHE/TEMP. Ensure data dir exists so
    // any future server-side persistence has a home, without requiring it to hold state.
    for (const name of ['APP_DATA_DIR', 'APP_CACHE_DIR', 'APP_TEMP_DIR']) {
      const dir = process.env[name];
      if (typeof dir !== 'string' || !isAbsolute(dir) || dir.includes('\0')) throw new Error(`invalid ${name}`);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700);
    }
    process.env.TMPDIR = process.env.TMP = process.env.TEMP = process.env.APP_TEMP_DIR;
    process.env.DOTENV_CONFIG_QUIET = 'true';
    process.chdir(process.env.APP_TEMP_DIR);
    const { createApp } = await import('./server.js');
    server = createApp(
      { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, DOUBAO_API_KEY: process.env.DOUBAO_API_KEY,
        DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL, DOUBAO_RESOURCE_ID: process.env.DOUBAO_RESOURCE_ID,
        DOUBAO_VOICE: process.env.DOUBAO_VOICE },
      fetch,
      { managed: { instanceId, token: message.token } });
    if (stopping) return;
    const listenHost = process.env.APP_HOST || '127.0.0.1';
    const listenPort = Number.parseInt(process.env.APP_PORT ?? '0', 10) || 0;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(listenPort, listenHost, resolve);
    });
    if (stopping) return;
    initialized = true;
    clearTimeout(initTimer);
    emit('ready', { host: '127.0.0.1', port: server.address().port });
    diagnostic('Ready.');
  })();
  await initializePromise;
}

async function stop(code = 0, requestId) {
  if (stopping) { if (code) process.exitCode = code; return; }
  stopping = true;
  clearTimeout(initTimer);
  if (instanceId) emit('stopping', requestId ? { requestId } : {});
  const timer = setTimeout(() => { diagnostic('Shutdown timed out.'); process.exit(1); }, 5000);
  try {
    await initializePromise?.catch(() => {});
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    clearTimeout(timer);
    process.exit(process.exitCode || code);
  } catch {
    diagnostic('Shutdown failed.');
    process.exit(1);
  }
}

async function dispatch(message) {
  if (stopping) return;
  if (message?.type === 'initialize') return initialize(message);
  if (!initialized) throw new Error('control message before initialize');
  if (message?.instanceId !== instanceId) throw new Error('control message instanceId mismatch');
  if (message.type === 'ping' && validMessage(message, ['protocolVersion', 'type', 'instanceId', 'requestId']) && id(message.requestId)) {
    emit('pong', { requestId: message.requestId }); return;
  }
  if (message.type === 'shutdown' && validMessage(message, ['protocolVersion', 'type', 'instanceId'])
    && (message.requestId === undefined || id(message.requestId))) return stop(0, message.requestId);
  throw new Error(`unsupported or malformed control message (type=${message?.type})`);
}

function invalid(reason) { diagnostic(`Invalid or oversized control message: ${reason}`); void stop(1); }

process.stdin.on('data', chunk => {
  if (stopping) return;
  pending = Buffer.concat([pending, chunk]);
  while (true) {
    const newline = pending.indexOf(10);
    if (newline < 0) break;
    const line = pending.subarray(0, newline);
    pending = pending.subarray(newline + 1);
    if (!line.length) return invalid('empty line');
    if (line.length > MAX_MESSAGE) return invalid(`line exceeds ${MAX_MESSAGE} bytes`);
    let message;
    try { message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); }
    catch (error) { return invalid(`not valid JSON (${error.message})`); }
    queue = queue.then(() => dispatch(message)).catch(error => { invalid(error.message || 'unknown dispatch error'); });
  }
  if (pending.length > MAX_MESSAGE) invalid(`pending buffer exceeds ${MAX_MESSAGE} bytes`);
});

process.stdin.on('end', () => {
  if (pending.length) return invalid('truncated final line');
  void queue.then(() => stop(initialized ? 0 : 1));
});
process.stdin.on('error', () => { diagnostic('Control channel failed.'); void stop(1); });
process.on('SIGINT', () => { void stop(0); });
process.on('SIGTERM', () => { void stop(0); });
process.on('uncaughtException', () => { diagnostic('Unexpected process failure.'); void stop(1); });
process.on('unhandledRejection', () => { diagnostic('Unexpected asynchronous failure.'); void stop(1); });
