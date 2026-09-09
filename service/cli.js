#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch, workerFor } = require('./browser');
const { GAMES, runAll, safeError } = require('./runner');
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');

async function writeReport(report) {
  const dir = path.join(dataDir, 'runs');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const text = JSON.stringify(report, null, 2) + '\n';
  const target = path.join(dir, `${report.id}.json`);
  await fs.writeFile(target + '.tmp', text, { mode: 0o600 });
  await fs.rename(target + '.tmp', target);
  await fs.writeFile(path.join(dataDir, 'latest.json.tmp'), text, { mode: 0o600 });
  await fs.rename(path.join(dataDir, 'latest.json.tmp'), path.join(dataDir, 'latest.json'));
  const files = (await fs.readdir(dir)).filter(n => n.endsWith('.json')).sort();
  for (const name of files.slice(0, -30)) await fs.unlink(path.join(dir, name));
}

async function main() {
  const command = process.argv[2] || 'run';
  if (command === 'status') {
    try { console.log(await fs.readFile(path.join(dataDir, 'latest.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; console.log('No runs yet.'); }
    return;
  }
  if (!['run', 'login', 'smoke'].includes(command)) throw new Error('Use run, login, status, or smoke.');
  let context;
  let stopping = false;
  const stop = async () => { stopping = true; await context?.close().catch(() => {}); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  let report;
  try {
    if (command === 'run') {
      report = { id: new Date().toISOString().replace(/[:.]/g, '-'), startedAt: new Date().toISOString(),
        status: 'running', extensionVersion: require('../manifest.json').version, results: [] };
      await writeReport(report);
    }
    context = await launch(dataDir, { headless: command !== 'login' });
    await workerFor(context);
    if (command === 'smoke') {
      await require('./smoke').smoke(context);
      return;
    }
    if (command === 'login') {
      const page = context.pages()[0] || await context.newPage();
      await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
      console.log('Login window ready at http://localhost:6080/vnc.html?autoconnect=1&resize=scale (SSH tunnel required).');
      console.log('Sign in directly to LinkedIn. This window closes once the authenticated feed or game page loads, or after 30 minutes.');
      const end = Date.now() + 30 * 60 * 1000;
      while (!stopping && Date.now() < end) {
        const authenticated = (await context.cookies('https://www.linkedin.com')).some(c => c.name === 'li_at' && c.value);
        if (authenticated && context.pages().some(p => /^https:\/\/www\.linkedin\.com\/(feed|games)\//.test(p.url()))) {
          console.log('Signed-in session saved. Daily runs can now use this profile.');
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      console.log('Login window closed.');
      return;
    }
    report.results = await runAll(context, { onResult: async results => {
      report.results = [...results];
      console.log(JSON.stringify(results.at(-1)));
      await writeReport(report);
    } });
    const success = report.results.length === GAMES.length && report.results.every(r => r.verified);
    report.status = success ? 'completed' : report.results.some(r => r.status === 'login_required') ? 'login_required' : 'failed';
    process.exitCode = success ? 0 : report.status === 'login_required' ? 2 : 1;
  } catch (error) {
    if (report) { report.status = stopping ? 'interrupted' : 'failed'; report.error = safeError(error); }
    else if (!stopping) console.error(safeError(error));
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => {});
    if (report) {
      report.finishedAt = new Date().toISOString();
      await writeReport(report);
      console.log(`Run ${report.status}. Report: /data/latest.json`);
    }
  }
}
main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
