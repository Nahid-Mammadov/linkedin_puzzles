const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('feed-to-game navigation installs the solver without a page reload', async () => {
  const source = fs.readFileSync(require.resolve('../src/background.js'), 'utf8');
  let updated;
  const scripts = [], styles = [], captures = [];
  const ctx = vm.createContext({
    chrome: {
      tabs: { onUpdated: { addListener(listener) { updated = listener; } } },
      scripting: {
        async executeScript(options) { scripts.push(options); },
        async insertCSS(options) { styles.push(options); },
      },
    },
    syncPuzzleRoute() {},
    async primeCapture(...args) { captures.push(args); },
  });
  vm.runInContext(source.slice(source.indexOf('chrome.tabs?.onUpdated.addListener')), ctx);
  updated(12, { url: 'https://www.linkedin.com/games/mini-sudoku/', status: 'complete' }, {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].target.tabId, 12);
  assert.deepEqual(Array.from(scripts[0].files), [
    'src/bootstrap.js', 'src/parsers.js', 'src/requests.js', 'src/content.js',
  ]);
  assert.equal(styles[0].files[0], 'src/content.css');
  assert.equal(captures.length, 1);
});
