// Бесплатная база данных: SQLite (sql.js / WebAssembly), которая работает в браузере
// и сохраняется в IndexedDB. Сервер и регистрация не нужны.
const Database = (() => {
  const SQLJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/";
  const IDB_NAME = "novafpos";
  const IDB_STORE = "sqlite";
  const IDB_KEY = "pos.db";
  let SQL = null;
  let db = null;

  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet() {
    try {
      const conn = await idb();
      return await new Promise((resolve, reject) => {
        const req = conn.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch { return null; }
  }

  async function idbPut(bytes) {
    try {
      const conn = await idb();
      await new Promise((resolve, reject) => {
        const tx = conn.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } catch { return false; }
  }

  function migrate() {
    db.run(`
      CREATE TABLE IF NOT EXISTS shifts (
        id     INTEGER PRIMARY KEY,
        opened TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        closed TEXT
      );
      CREATE TABLE IF NOT EXISTS transactions (
        id         INTEGER PRIMARY KEY,
        shift_id   INTEGER NOT NULL REFERENCES shifts(id),
        created    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        type       TEXT NOT NULL CHECK (type IN ('sale', 'refund')),
        method     TEXT NOT NULL CHECK (method IN ('card', 'cash', 'qr')),
        amount     INTEGER NOT NULL,          -- в копейках
        status     TEXT NOT NULL CHECK (status IN ('approved', 'declined')),
        message    TEXT,
        card       TEXT,
        auth_code  TEXT,
        rrn        TEXT,
        cash_given INTEGER,
        ref_id     INTEGER REFERENCES transactions(id),
        refunded   INTEGER NOT NULL DEFAULT 0
      );
    `);
    if (!query("SELECT id FROM shifts WHERE closed IS NULL").length) {
      db.run("INSERT INTO shifts DEFAULT VALUES");
    }
  }

  async function init() {
    if (typeof initSqlJs !== "function") throw new Error("не удалось загрузить SQLite");
    SQL = await initSqlJs({ locateFile: f => SQLJS_URL + f });
    const saved = await idbGet();
    db = saved ? new SQL.Database(new Uint8Array(saved)) : new SQL.Database();
    migrate();
    await save();
  }

  function query(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function run(sql, params = []) {
    db.run(sql, params);
    const id = db.exec("SELECT last_insert_rowid()")[0].values[0][0];
    save();
    return id;
  }

  function save() {
    return db ? idbPut(db.export()) : Promise.resolve(false);
  }

  async function reset() {
    db.close();
    db = new SQL.Database();
    migrate();
    await save();
  }

  const exportBytes = () => db.export();

  return { init, query, run, save, reset, exportBytes, ready: () => !!db };
})();
