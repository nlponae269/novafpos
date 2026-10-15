// Бесплатная база данных: SQLite (sql.js / WebAssembly), которая живёт в браузере
// и сохраняется в IndexedDB. Никаких серверов и регистраций не нужно.
const Database = (() => {
  const IDB_NAME = "novafpos";
  const IDB_STORE = "sqlite";
  const IDB_KEY = "main.db";
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

  function seed() {
    db.run(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO users (name, email) VALUES ('guest', 'guest@novafpos.local'), ('admin', 'admin@novafpos.local');
      INSERT INTO notes (title, body) VALUES ('Привет', 'Это пример записи в базе данных.');
    `);
  }

  async function init() {
    if (typeof initSqlJs !== "function") throw new Error("sql.js не загрузился");
    const SQL = await initSqlJs({
      locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`,
    });
    const saved = await idbGet();
    if (saved) {
      db = new SQL.Database(new Uint8Array(saved));
    } else {
      db = new SQL.Database();
      seed();
      await save();
    }
    Database.SQL = SQL;
  }

  function exec(sql) {
    if (!db) throw new Error("база данных ещё не готова");
    const results = db.exec(sql);
    const changes = db.getRowsModified();
    // Сохраняем только если запрос мог что-то изменить.
    if (!/^\s*(select|pragma|explain|with)\b/i.test(sql)) save();
    return { results, changes };
  }

  function save() {
    return db ? idbPut(db.export()) : Promise.resolve(false);
  }

  async function reset() {
    db.close();
    db = new Database.SQL.Database();
    seed();
    await save();
  }

  function exportBytes() { return db.export(); }

  async function importBytes(bytes) {
    const next = new Database.SQL.Database(bytes);
    next.exec("SELECT name FROM sqlite_master LIMIT 1"); // проверка формата
    db.close();
    db = next;
    await save();
  }

  return { init, exec, save, reset, exportBytes, importBytes, ready: () => !!db };
})();
