const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../src/background.js'), 'utf8');
const fn = source.slice(source.indexOf('async function requestNativeGameSave()'), source.indexOf('\nfunction recordSessionRequest'));
function fixture({ broken = false } = {}) {
  const save = { $type: 'proto.sdui.actions.core.ServerRequest', value: { requestId: 'updateGameState' } };
  const lifecycle = { actions: [{ $type: 'proto.sdui.actions.core.SetState' },
    { value: { whenTrue: { actions: [save] } } }] };
  let executions = 0, compilations = [];
  const compile = actions => { compilations.push(actions); return async () => { executions++; }; };
  const first = { memoizedState: [compile, []], next: { memoizedState: [
    { func() { throw new Error('Whole lifecycle must never run'); } },
    broken ? [] : [lifecycle, compile],
  ] } };
  const board = { __reactFiber$test: { memoizedProps: { onDisappear: lifecycle }, memoizedState: first } };
  const context = vm.createContext({ location: { pathname: '/games/zip/' },
    document: { querySelector: selector => selector === '[data-cell-idx]' ? board : null } });
  vm.runInContext(fn, context);
  return { context, save, compilations, executions: () => executions };
}
test('native trigger executes only the exact page-supplied save request', async () => {
  const f = fixture();
  assert.equal(await f.context.requestNativeGameSave(), true);
  assert.equal(f.executions(), 1);
  assert.equal(f.compilations.length, 1);
  assert.equal(f.compilations[0].actions.length, 1);
  assert.equal(f.compilations[0].actions[0], f.save);
});
test('changed hook relationships fail closed without running arbitrary callbacks', async () => {
  const f = fixture({ broken: true });
  assert.equal(await f.context.requestNativeGameSave(), false);
  assert.equal(f.executions(), 0);
  assert.equal(f.compilations.length, 0);
});
