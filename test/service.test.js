const test = require('node:test');
const assert = require('node:assert/strict');
const { solveGame, runAll, LoginRequired } = require('../service/runner');

function fakePage() {
  return { visits: [], closed: false, async goto(url) { this.visits.push(url); }, async close() { this.closed = true; } };
}
function options(extra = {}) {
  return { ready: async () => ({ board: true, completed: false }),
    requireLogin: async () => {}, evidence: async () => ({ completed: false }),
    sleep: async () => {}, timeoutMs: 10, ...extra };
}

test('headless run refuses extension success without a persisted LinkedIn win', async () => {
  const calls = [];
  await assert.rejects(solveGame({}, fakePage(), 'queens', options({
    command: async (_c, _p, game, type) => { calls.push(type); return { game, phase: 'success' }; },
  })), /persisted win/);
  assert.equal(calls.filter(type => type === 'lls-service-solve').length, 1);
});

test('headless run requires initially unsolved board and a fresh completed page', async () => {
  const page = fakePage();
  let reads = 0;
  const result = await solveGame({}, page, 'queens', options({
    ready: async () => ({ board: true, completed: reads++ > 0 }),
    command: async (_c, _p, game) => ({ game, phase: 'working' }),
    evidence: async () => ({ completed: true }),
  }));
  assert.equal(result.status, 'solved');
  assert.equal(result.initiallyUnsolved, true);
  assert.equal(result.verified, true);
  assert.equal(page.visits.length, 2);
});

test('a transient completed view is not accepted when reload returns unsolved', async () => {
  await assert.rejects(solveGame({}, fakePage(), 'zip', options({
    command: async (_c, _p, game) => ({ game }),
    evidence: async () => ({ completed: true }),
  })), /persisted completion/);
});

test('already completed boards are rechecked without another save', async () => {
  const page = fakePage();
  const result = await solveGame({}, page, 'tango', options({
    ready: async () => ({ completed: true }), command: async () => { throw new Error('must not call'); },
  }));
  assert.equal(result.status, 'already_completed');
  assert.equal(page.visits.length, 2);
});

test('lost solve response does not dispatch a second solve', async () => {
  let sends = 0;
  await assert.rejects(solveGame({}, fakePage(), 'zip', options({
    command: async (_c, _p, game, type) => {
      if (type === 'lls-service-solve') { sends++; throw new Error('navigation closed the port'); }
      return { game };
    },
  })), /persisted win/);
  assert.equal(sends, 1);
});

test('one failed game does not prevent the other games running', async () => {
  const pages = [];
  const results = await runAll({ async newPage() { const page = fakePage(); pages.push(page); return page; } }, {
    games: ['queens', 'zip'], solve: async (_c, _p, game) => {
      if (game === 'queens') throw new Error('Save rejected');
      return { game, status: 'solved', verified: true };
    },
  });
  assert.deepEqual(results.map(r => r.status), ['failed', 'solved']);
  assert.ok(pages.every(page => page.closed));
});

test('authentication challenge stops the run for a human login', async () => {
  let opened = 0;
  const results = await runAll({ async newPage() { opened++; return fakePage(); } }, {
    solve: async () => { throw new LoginRequired(); },
  });
  assert.equal(opened, 1);
  assert.equal(results[0].status, 'login_required');
});
