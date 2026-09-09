'use strict';
const assert = require('node:assert/strict');
const { solveGame } = require('./runner');

// Offline end-to-end wiring check. Nothing is sent to LinkedIn.
async function smoke(context) {
  let saved = false, saves = 0;
  const urn = 'urn:li:fsd_game:(test,1,999)';
  await context.addCookies([
    { name: 'li_at', value: 'offline-test', domain: '.linkedin.com', path: '/', secure: true, httpOnly: true },
    { name: 'JSESSIONID', value: '"ajax:123"', domain: '.linkedin.com', path: '/', secure: true },
  ]);
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.url().includes('/voyager/api/graphql') && request.method() === 'POST') {
      const body = request.postDataJSON();
      assert.ok(JSON.stringify(body).includes('Fruits'));
      assert.ok(JSON.stringify(body).includes(urn));
      saves++;
      saved = true;
      return route.fulfill({ json: { data: { data: { updateIdentityDashGames: { resourceKey: urn } } } } });
    }
    if (request.isNavigationRequest()) {
      return route.fulfill({ contentType: 'text/html', body: `<html><body><main><h1>Pinpoint</h1>
        ${saved ? '<a href="/games/pinpoint/results/">See results</a>' : '<input aria-label="Guess the category...">'}
        <code style="display:none">${JSON.stringify({ entityUrn: urn, pinpointGamePuzzle: { solution: 'Fruits' } })}</code>
        </main></body></html>` });
    }
    await route.abort();
  });
  const page = await context.newPage();
  try {
    const result = await solveGame(context, page, 'pinpoint', { timeoutMs: 15000 });
    assert.equal(result.status, 'solved');
    assert.equal(result.verified, true);
    assert.equal(saves, 1);
    const second = await solveGame(context, page, 'pinpoint');
    assert.equal(second.status, 'already_completed');
    assert.equal(saves, 1);
    console.log('Headless extension smoke passed: request save, fresh-page verification, and completed-board skip.');
  } finally { await page.close(); }
}
module.exports = { smoke };
