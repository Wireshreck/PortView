'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, 'port-names.json');

/**
 * Store for the names you give your own ports.
 *
 * Shape: { "<port>": { label, url?, section? } }
 *
 * The file lives next to the app and is rewritten whenever a name changes, so
 * it is personal data and is kept out of version control.
 */
function createStore(file = DEFAULT_FILE) {
  let cache = null;

  function read() {
    if (cache) return cache;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      cache = {};
    }
    return cache;
  }

  function write(data) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
    cache = data;
    return data;
  }

  return {
    /** Every custom name, keyed by port number. */
    all() {
      return { ...read() };
    },

    get(port) {
      const entry = read()[String(port)];
      return entry || null;
    },

    /**
     * Set (or clear) the name for a port. Passing nothing removes it.
     */
    set(port, { label, url, section } = {}) {
      const data = { ...read() };
      const key = String(port);

      if (!label && !url && !section) {
        delete data[key];
      } else {
        const existing = data[key] || {};
        data[key] = {
          ...existing,
          ...(label !== undefined ? { label: String(label).slice(0, 120) } : {}),
          ...(url !== undefined ? { url: String(url).slice(0, 500) } : {}),
          ...(section !== undefined ? { section: String(section).slice(0, 40) } : {}),
        };
      }

      write(data);
      return data[key] || null;
    },

    remove(port) {
      const data = { ...read() };
      delete data[String(port)];
      write(data);
    },

    file,
  };
}

const store = createStore();

module.exports = {
  ...store,
  createStore,
  DEFAULT_FILE,
};
