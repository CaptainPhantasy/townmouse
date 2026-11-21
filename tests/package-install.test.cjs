'use strict';

/*
 * Package install gate.
 *
 * Packs the release artifact, installs it the way a user does, and checks the
 * installed application — not this checkout. On macOS it installs with
 * --ignore-scripts (npm 12 skips dependency install scripts by default), which
 * is the hardest case. On Linux it must allow scripts: node-pty has no Linux
 * prebuild, so the native module is compiled by its install script.
 *
 * Run with:
 *   scripts/node-runtime.sh exec tests/package-install.test.cjs
 *   npm run test:package
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { resolveChrome } = require('../src/chrome-resolve');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PACKAGE_PORT || 11610);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
let workdir = '';
let app = null;

function ensure(condition, message, detail) {
  if (!condition) {
    throw new Error(detail === undefined ? message : `${message} | ${JSON.stringify(detail)}`);
  }
}

async function run(title, fn) {
  try {
    const outcome = await fn();
    if (outcome && outcome.skipped) {
      results.push({ title, ok: true, skipped: true });
      console.log(`SKIP ${title}`);
      return;
    }
    results.push({ title, ok: true });
    console.log(`PASS ${title}`);
  } catch (error) {
    results.push({ title, ok: false, error: error.message });
    console.log(`FAIL ${title}\n     ${error.message}`);
  }
}

async function health() {
  try {
    const response = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return response.status;
  } catch (_) { return 0; }
}

async function waitForHealth(timeoutMs = 30000) {
  const started = Date.now();
  for (;;) {
    if (await health() === 200) return;
    if (Date.now() - started > timeoutMs) throw new Error('installed server did not become healthy');
    await sleep(250);
  }
}

(async () => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-package-'));
  const packDir = path.join(workdir, 'pack');
  const appDir = path.join(workdir, 'app');
  const homeDir = path.join(workdir, 'home');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  try {
    let tarball = '';
    await run('pack: npm pack produces the release artifact', () => {
      const output = execFileSync('npm', ['pack', '--pack-destination', packDir], { cwd: ROOT, encoding: 'utf8' });
      const name = output.trim().split('\n').pop();
      tarball = path.join(packDir, name);
      ensure(fs.existsSync(tarball), 'tarball exists', tarball);
      const size = fs.statSync(tarball).size;
      ensure(size > 100_000 && size < 50_000_000, 'tarball has a plausible size', size);
    });
    if (!tarball) throw new Error('no tarball to install');

    // node-pty has no prebuilt Linux addon; Linux consumer installs must compile it.
    const needsNativeBuild = process.platform === 'linux';
    const installMode = needsNativeBuild ? 'with the native build' : 'with scripts ignored';
    await run(`install: a clean project installs the package ${installMode}`, () => {
      fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'tm-consumer', version: '1.0.0', private: true }, null, 2));
      const installFlags = needsNativeBuild ? [] : ['--ignore-scripts'];
      execFileSync('npm', ['install', ...installFlags, tarball], { cwd: appDir, encoding: 'utf8', stdio: 'pipe' });
      const pkg = path.join(appDir, 'node_modules', 'townmouse');
      ensure(fs.existsSync(pkg), 'the package is installed', pkg);
      const launch = path.join(appDir, 'node_modules', '.bin', 'townmouse');
      ensure(fs.existsSync(launch), 'the CLI is linked', launch);
    });

    // The test HOME has no Puppeteer cache; pass the checkout's resolved browser.
    const systemBrowser = resolveChrome();
    await run('start: the installed application answers and serves its engine assets', async () => {
      const bin = path.join(appDir, 'node_modules', '.bin', 'townmouse');
      app = spawn(bin, ['--port', String(PORT), '--no-open'], {
        cwd: appDir,
        env: {
          ...process.env,
          PORT: String(PORT),
          HOME: homeDir,
          ...(systemBrowser ? { TERMINALONE_CHROME: systemBrowser.path } : {})
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      app.stdout.on('data', () => {});
      app.stderr.on('data', () => {});
      await waitForHealth();
      for (const route of [
        '/panes.html',
        '/panes.mjs',
        '/node_modules/@xterm/xterm/lib/xterm.mjs',
        '/node_modules/@xterm/xterm/css/xterm.css',
        '/node_modules/@xterm/addon-fit/lib/addon-fit.mjs'
      ]) {
        const response = await fetch(BASE + route, { signal: AbortSignal.timeout(5000) });
        ensure(response.status === 200, `asset ${route} is served`, response.status);
      }
    });

    await run('first run: the workspace token and data directory have safe modes', () => {
      const stateDir = path.join(homeDir, '.townmouse');
      ensure(fs.existsSync(stateDir), 'data directory created', stateDir);
      const tokenFile = path.join(stateDir, 'pane-token');
      ensure(fs.existsSync(tokenFile), 'pane token created', tokenFile);
      if (process.platform !== 'win32') {
        const dirMode = fs.statSync(stateDir).mode & 0o777;
        const fileMode = fs.statSync(tokenFile).mode & 0o777;
        ensure(dirMode === 0o700, 'data directory is 0700', dirMode.toString(8));
        ensure(fileMode === 0o600, 'token file is 0600', fileMode.toString(8));
      }
    });

    let token = '';
    let paneId = '';
    await run('terminal: a PTY starts and runs a tracked command', async () => {
      const page = await fetch(`${BASE}/panes.html`, { headers: { Accept: 'text/html' } });
      const cookies = typeof page.headers.getSetCookie === 'function'
        ? page.headers.getSetCookie()
        : [page.headers.get('set-cookie')];
      const cookie = (cookies || []).filter(Boolean).find((value) => value.startsWith('townmouse_owner='));
      ensure(cookie, 'owner cookie is issued');
      const boot = await fetch(`${BASE}/api/panes/bootstrap`, { headers: { Cookie: cookie.split(';')[0] } });
      ensure(boot.status === 200, 'bootstrap succeeds', boot.status);
      const body = await boot.json();
      token = body.token;
      const pane = body.state.tabs[0].panes[0];
      paneId = pane.id;
      ensure(pane.kind === 'terminal', 'the seeded pane is a terminal', pane);
      await sleep(500);
      const state = await fetch(`${BASE}/api/panes/state`, { headers: { 'X-Townmouse-Token': token } });
      const current = await state.json();
      const live = current.tabs[0].panes[0];
      ensure(live.program.status === 'running', 'the PTY is running, not wedged', live.program);

      const panes = path.join(appDir, 'node_modules', 'townmouse', 'scripts', 'panes');
      const output = execFileSync(process.execPath, [panes, 'pane', 'exec', paneId, '--', 'printf "package-ok\\n"'], {
        cwd: appDir,
        env: {
          ...process.env,
          TOWNMOUSE_API: `${BASE}/api/panes`,
          TOWNMOUSE_TOKEN: token,
          TOWNMOUSE_PANE_ID: paneId
        },
        encoding: 'utf8'
      });
      const job = JSON.parse(output);
      ensure(job.status === 'completed', 'the tracked job completed', job);
      ensure(job.exitCode === 0, 'the tracked job reports exit 0', job.exitCode);
      ensure(job.stdout.includes('package-ok'), 'output came back from the installed app', job.stdout);
    });

    await run('browser: a pane can open a page', async () => {
      if (!systemBrowser) return { skipped: true };
      const tab = await fetch(`${BASE}/api/panes/tabs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Townmouse-Token': token },
        body: JSON.stringify({ title: 'package-browser', createdBy: 'agent' })
      });
      const created = await tab.json();
      ensure(tab.status === 200, 'tab created', tab.status);
      const pane = await fetch(`${BASE}/api/panes/tabs/${created.id}/panes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Townmouse-Token': token },
        body: JSON.stringify({ kind: 'browser', url: BASE + '/panes.html', createdBy: 'agent' })
      });
      const browserPane = await pane.json();
      ensure(pane.status === 200, 'browser pane created', { status: pane.status, body: browserPane });
      await sleep(1200);
      const snapshot = await fetch(`${BASE}/api/panes/panes/${browserPane.id}/browser/snapshot`, {
        headers: { 'X-Townmouse-Token': token },
        signal: AbortSignal.timeout(15000)
      });
      const snap = await snapshot.json();
      ensure(snapshot.status === 200, 'snapshot answered', snapshot.status);
      ensure(typeof snap.image === 'string' && snap.image.length > 1000, 'a real screenshot came back', { bytes: snap.image && snap.image.length });
    });
  } finally {
    if (app) { try { app.kill('SIGTERM'); } catch (_) { /* gone */ } }
    await sleep(500);
    if (app && app.exitCode === null && app.signalCode === null) { try { app.kill('SIGKILL'); } catch (_) {} }
    if (workdir) fs.rmSync(workdir, { recursive: true, force: true });
  }

  const failures = results.filter((result) => !result.ok);
  console.log('\n' + '='.repeat(72));
  console.log(`RESULT passed=${results.length - failures.length} total=${results.length} failures=${failures.length}`);
  if (failures.length) {
    for (const failure of failures) console.log(`- ${failure.title}: ${failure.error}`);
    process.exitCode = 1;
  }
})();
