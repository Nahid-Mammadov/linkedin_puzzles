'use strict';
const { extensionCommand } = require('./browser');
const GAMES = ['mini-sudoku', 'queens', 'tango', 'zip', 'patches', 'wend', 'crossclimb', 'pinpoint'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class LoginRequired extends Error {
  constructor() { super('Sign in using the server login window, then rerun.'); this.code = 'LOGIN_REQUIRED'; }
}

async function requireLogin(context, page) {
  const urls = page.frames().map(frame => frame.url());
  if (urls.some(url => /linkedin\.com\/(?:login|checkpoint|uas\/login|authwall|challenge)(?:[/?#]|$)/.test(url))
    || !(await context.cookies('https://www.linkedin.com')).some(c => c.name === 'li_at' && c.value)) {
    throw new LoginRequired();
  }
}

// Independent of the extension's status: inspect only LinkedIn's game view.
async function evidence(page, game) {
  const rootPath = new URL(page.url()).pathname;
  if (!new RegExp(`^/games/(?:view/)?${game}(?:/|$)`).test(rootPath)) return { completed: false, board: false };
  const output = { completed: false, board: false };
  for (const frame of page.frames()) {
    if (!/^https:\/\/www\.linkedin\.com\/(?:games\/|preload\/)/.test(frame.url())) continue;
    try {
      if (frame !== page.mainFrame()) {
        const element = await frame.frameElement();
        try { if (!await element.isVisible()) continue; } finally { await element.dispose(); }
      }
      const framePath = new URL(frame.url()).pathname;
      if (!framePath.startsWith('/preload/') && !new RegExp(`^/games/(?:view/)?${game}(?:/|$)`).test(framePath)) continue;
      const found = await frame.evaluate(game => {
        const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
        const controls = [...document.querySelectorAll('button,a')]
          .filter(el => !el.closest('#linkedin-logic-solver') && visible(el));
        const completed = controls.some(el => el.textContent.trim() === 'See results');
        const boards = { queens: '#queens-game-board', tango: '#tango-cell-0', zip: '[data-cell-idx]',
          patches: '[data-cell-idx]', wend: '[data-game-content-root]',
          pinpoint: 'input[aria-label="Guess the category..."]' };
        const board = boards[game] ? [...document.querySelectorAll(boards[game])].some(visible)
          : controls.some(el => /^(Clear|Hint|Use a hint|Guess|Submit|Check)$/.test((el.getAttribute('aria-label') || el.textContent).trim()))
            || !!document.querySelector('[data-testid*="sudoku"],.sudoku-grid,.crossclimb-board');
        return { completed, board };
      }, game);
      output.completed ||= found.completed;
      output.board ||= found.board;
    } catch { /* Frame replacement is normal during LinkedIn navigation. */ }
  }
  return output;
}

// These open the game; never click cells, answers, hints, or tutorial moves.
async function openBoard(page) {
  for (const frame of page.frames()) {
    if (!/^https:\/\/www\.linkedin\.com\/(?:games\/|preload\/)/.test(frame.url())) continue;
    for (const name of [/^Play(?: now| game)?$/i, /^Start(?: game| playing)?$/i, /^Resume(?: game)?$/i, /^Skip tutorial$/i]) {
      const button = frame.getByRole('button', { name }).first();
      if (await button.isVisible().catch(() => false)) { await button.click({ timeout: 3000 }); return true; }
    }
  }
  return false;
}

async function ready(context, page, game, { timeoutMs = 30000 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await requireLogin(context, page);
    const result = await evidence(page, game);
    if (result.completed || result.board) return result;
    await openBoard(page);
    await sleep(500);
  }
  throw new Error('Game board did not load. Open it in the server login window to check onboarding.');
}

async function verifiedReload(context, page, game, deps) {
  await page.goto(`https://www.linkedin.com/games/${game}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const state = await deps.ready(context, page, game);
  if (!state.completed) throw new Error('LinkedIn did not show persisted completion after a fresh navigation.');
  return true;
}

async function solveGame(context, page, game, overrides = {}) {
  const deps = { ready, evidence, requireLogin, command: extensionCommand, sleep, ...overrides };
  const started = Date.now();
  await page.goto(`https://www.linkedin.com/games/${game}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const before = await deps.ready(context, page, game);
  if (before.completed) {
    await verifiedReload(context, page, game, deps);
    return { game, status: 'already_completed', verified: true, durationMs: Date.now() - started };
  }
  let sent = false;
  const deadline = Date.now() + (overrides.timeoutMs ?? 90000);
  let lastStatus;
  while (Date.now() < deadline) {
    await deps.requireLogin(context, page);
    if (!sent) {
      // Poll until the extension has mounted before sending a single solve command.
      let state;
      try { state = await deps.command(context, page, game, 'lls-service-state'); } catch {}
      if (state?.game === game) {
        // Mark before dispatch: a lost response must never submit a second solve.
        sent = true;
        await deps.command(context, page, game, 'lls-service-solve').catch(() => {});
      }
    }
    if (sent) {
      try { lastStatus = await deps.command(context, page, game, 'lls-service-state'); } catch {}
      const native = await deps.evidence(page, game);
      if (native.completed) {
        await verifiedReload(context, page, game, deps);
        return { game, status: 'solved', verified: true, initiallyUnsolved: true, durationMs: Date.now() - started };
      }
      if (lastStatus?.phase === 'error') throw new Error(lastStatus.message || 'Extension solve failed.');
    }
    await deps.sleep(500);
  }
  throw new Error(sent ? 'Timed out waiting for a persisted win.' : 'The extension did not become ready.');
}

async function runAll(context, { games = GAMES, onResult = async () => {}, solve = solveGame } = {}) {
  const results = [];
  for (const game of games) {
    const page = await context.newPage();
    let result;
    try { result = await solve(context, page, game); }
    catch (error) {
      result = { game, status: error.code === 'LOGIN_REQUIRED' ? 'login_required' : 'failed', verified: false,
        error: error.code === 'LOGIN_REQUIRED' ? error.message : safeError(error) };
    } finally { await page.close().catch(() => {}); }
    results.push(result);
    await onResult(results);
    if (result.status === 'login_required') break;
  }
  return results;
}

function safeError(error) {
  // Playwright errors can embed URLs, DOM text and call logs. Store a bounded first line only.
  return String(error.message || error).split('\n')[0]
    .replace(/https?:\/\/\S+/g, '[URL]').replace(/urn:li:\S+/g, '[identifier]').slice(0, 300);
}
module.exports = { GAMES, LoginRequired, evidence, ready, solveGame, runAll, safeError };
