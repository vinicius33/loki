const vm = require('vm');
const debug = require('debug')('loki:chrome:fetchStories');
const fetchUrl = require('./fetch-url');
const getBrowserGlobals = require('./get-browser-globals');
const { ServerError } = require('../../errors');

async function createStorybookSandbox(baseUrl) {
  debug(`Fetching iframe HTML and preview bundle JS from ${baseUrl}`);
  const html = await fetchUrl(`${baseUrl}/iframe.html`);
  const browser = getBrowserGlobals(html);
  const scripts = browser.document.querySelectorAll('script[src]');
  const previewSrc = Array.from(scripts)
    .map(node => node.attributes.src.nodeValue)
    .filter(src => src.match(/preview\.([a-f0-9]+\.)?bundle\.js/) !== -1)[0];

  if (!previewSrc) {
    throw new Error('Unable to locate preview bundle');
  }

  const bundle = await fetchUrl(`${baseUrl}/${previewSrc}`);

  debug('Creating js sandbox');
  const sandbox = vm.createContext(browser);

  debug('Executing storybook preview bundle');
  vm.runInNewContext(bundle, sandbox);

  return sandbox;
}

async function fetchStorybook(baseUrl = 'http://localhost:6006') {
  let sandbox;
  try {
    sandbox = await createStorybookSandbox(baseUrl);
  } catch (err) {
    if (err.message.indexOf('ECONNREFUSED')) {
      throw new ServerError(
        'Failed fetching stories because the server is down',
        `Try starting it with "yarn storybook" or pass the --port or --host arguments if it's not running at ${baseUrl}`
      );
    }
    throw err;
  }

  const getStorybook = sandbox.window.loki && sandbox.window.loki.getStorybook;
  if (!getStorybook) {
    throw new Error(
      "Loki addon not registered. Add `import 'loki/configure-react'` to your config.js file."
    );
  }

  return getStorybook().map(component => ({
    kind: component.kind,
    stories: component.stories.map(story => story.name),
  }));
}

module.exports = fetchStorybook;
