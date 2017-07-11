const fs = require('fs-extra');
const debug = require('debug')('loki:chrome');
const fetchStorybook = require('./fetch-storybook');
const presets = require('./presets.json');

function createChromeTarget(start, stop, createNewDebuggerInstance, baseUrl) {
  function getDeviceMetrics(options) {
    return {
      width: options.width,
      height: options.height,
      deviceScaleFactor: options.deviceScaleFactor || 1,
      mobile: options.mobile || false,
      fitWindow: options.fitWindow || false,
    };
  }

  async function launchNewTab(options) {
    const client = await createNewDebuggerInstance();
    const deviceMetrics = getDeviceMetrics(options);

    const { Runtime, Page, Emulation, DOM, Network } = client;

    await Runtime.enable();
    await Network.enable();
    if (options.userAgent) {
      await Network.setUserAgentOverride({
        userAgent: options.userAgent,
      });
    }
    if (options.clearBrowserCookies) {
      await Network.clearBrowserCookies();
    }
    await DOM.enable();
    await Page.enable();
    await Emulation.setDeviceMetricsOverride(deviceMetrics);

    client.loadUrl = async url => {
      debug(`Navigating to ${url}`);
      await Page.navigate({ url });
      debug('Awaiting load event');
      await Page.loadEventFired();
    };

    const querySelector = async selector => {
      const { root: { nodeId: documentNodeId } } = await DOM.getDocument();
      const selectors = selector.split(',');
      for (let i = 0; i < selectors.length; i++) {
        const result = await DOM.querySelector({
          selector: selectors[i].trim(),
          nodeId: documentNodeId,
        });
        if (result.nodeId) {
          return result;
        }
      }
      throw new Error(`No node found matching selector "${selector}"`);
    };

    client.captureScreenshot = async (selector = 'body') => {
      const scale = deviceMetrics.deviceScaleFactor;

      debug(`Setting viewport to "${selector}"`);
      const { nodeId } = await querySelector(selector);
      const { model } = await DOM.getBoxModel({ nodeId });
      const x = Math.max(0, model.border[0]);
      const y = Math.max(0, model.border[1]);
      const size = {
        width: model.width * scale,
        height: model.height * scale,
      };

      await Emulation.setVisibleSize(size);
      await Emulation.forceViewport({ x, y, scale });

      debug('Capturing screenshot');
      const screenshot = await Page.captureScreenshot({ format: 'png' });
      const buffer = new Buffer(screenshot.data, 'base64');

      return buffer;
    };

    return client;
  }

  const getStoryUrl = (kind, story) =>
    `${baseUrl}/iframe.html?selectedKind=${encodeURIComponent(
      kind
    )}&selectedStory=${encodeURIComponent(story)}`;

  async function getStorybook() {
    return fetchStorybook(baseUrl);
  }

  async function captureScreenshotForStory(
    kind,
    story,
    outputPath,
    options,
    configuration
  ) {
    let tabOptions = configuration;
    if (configuration.preset) {
      if (!presets[configuration.preset]) {
        throw new Error(`Invalid preset ${configuration.preset}`);
      }
      tabOptions = Object.assign(
        {},
        configuration,
        presets[configuration.preset]
      );
    }
    const tab = await launchNewTab(tabOptions);
    await tab.loadUrl(getStoryUrl(kind, story));
    const screenshot = await tab.captureScreenshot(options.chromeSelector);
    await fs.outputFile(outputPath, screenshot);
    await tab.close();
    return screenshot;
  }

  return { start, stop, getStorybook, launchNewTab, captureScreenshotForStory };
}

module.exports = createChromeTarget;
