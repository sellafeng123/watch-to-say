const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createFakeDom } = require("./fake-dom.js");

function loadClassicPage(page, sendMessage = async () => ({ success: true, banks: [] })) {
  const directory = path.resolve(__dirname, "../..");
  const html = fs.readFileSync(path.join(directory, page), "utf8");
  const { document } = createFakeDom();
  document.addEventListener = () => {};
  document.body.classList = { add() {}, remove() {} };
  for (const match of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = document.createElement(match[1]);
    node.id = match[3];
    document.body.append(node);
  }
  for (const match of html.matchAll(/data-language="([^"]+)"/g)) {
    const node = document.createElement("button");
    node.setAttribute("data-language", match[1]);
    document.body.append(node);
  }
  const listeners = { addListener() {} };
  const context = vm.createContext({ document, console, URL, setTimeout, clearTimeout,
    confirm: () => true,
    chrome: {
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {}, clear: async () => {} } },
      runtime: { onMessage: listeners, sendMessage },
      windows: { getCurrent: async () => ({ id: 1 }) },
      tabs: { onUpdated: listeners, onActivated: listeners },
    },
  });
  context.window = context;
  for (const [, script] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    vm.runInContext(fs.readFileSync(path.join(directory, script), "utf8"), context, { filename: script });
  }
  return { document, run: (code) => vm.runInContext(code, context) };
}

module.exports = { loadClassicPage };
