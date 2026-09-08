const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { parseSudokuPuzzle } = require('../src/parsers.js');
test('Sudoku retains transient first-load data after LinkedIn removes the code element', () => {
  const puzzle = { solution: [1,2,2,1], presetCellIdxes: [0,3], gridRowSize: 2, gridColSize: 2 };
  const text = JSON.stringify({ miniSudokuGamePuzzle: puzzle });
  class Element {
    matches() { return true; }
    querySelectorAll() { return []; }
  }
  const element = Object.assign(new Element(), { textContent: text });
  let live = [element];
  const ctx = vm.createContext({ location: { pathname: '/games/mini-sudoku/' }, window: {},
    document: { querySelectorAll: () => live, addEventListener() {} },
    chrome: { runtime: { onMessage: { addListener() {} } } },
    Text: class {}, Element, MutationObserver: class { observe() {} disconnect() {} },
    setTimeout() {}, clearTimeout() {}, addEventListener() {},
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/bootstrap.js'), 'utf8'), ctx);
  live = [];
  assert.deepEqual(parseSudokuPuzzle(Array.from(ctx.LinkedInPuzzleBootstrap.captureVisible())), puzzle);
});
