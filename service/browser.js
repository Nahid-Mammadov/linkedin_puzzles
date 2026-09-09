'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');

async function launch(dataDir, { headless = true } = {}) {
  const { chromium } = require('playwright');
  const extension = path.resolve(__dirname, '..');
  await fs.mkdir(path.join(dataDir, 'profile'), { recursive: true, mode: 0o700 });
  return chromium.launchPersistentContext(path.join(dataDir, 'profile'), {
    channel: 'chromium', headless,
    viewport: { width: 1360, height: 800 }, locale: 'en-US', timezoneId: 'America/Los_Angeles',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    timeout: 60000,
  });
}

async function workerFor(context) {
  const worker = context.serviceWorkers().find(w => w.url().endsWith('/src/background.js'));
  if (worker) return worker;
  return context.waitForEvent('serviceworker', {
    predicate: w => w.url().endsWith('/src/background.js'), timeout: 15000,
  });
}

async function extensionCommand(context, page, game, type) {
  const worker = await workerFor(context);
  return worker.evaluate(async ({ url, game, type }) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(tab => tab.url === url);
    if (!tab) throw new Error('Game tab is unavailable.');
    // Deliver to any matching game frame; preload games use the outer controller.
    return chrome.tabs.sendMessage(tab.id, { type, game });
  }, { url: page.url(), game, type });
}

module.exports = { launch, workerFor, extensionCommand };
