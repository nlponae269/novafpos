(() => {
  const outputEl = document.getElementById("output");
  const inputEl = document.getElementById("input");
  const promptEl = document.getElementById("prompt");
  const termEl = document.getElementById("terminal");
  const titleEl = document.querySelector(".title");

  const USER = "guest";
  const HOST = "novafpos";
  const HIST_KEY = "novafpos.history";
  const startedAt = Date.now();

  let cwd = FS.HOME;
  let sqlMode = false;
  let sqlBuffer = "";
  let history = [];
  try { history = JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch { history = []; }
  let histIndex = history.length;

  // ---------- вывод ----------
  function span(text, cls) {
    const s = document.createElement("span");
    s.textContent = text;
    if (cls) s.className = cls;
    return s;
  }

  // print("текст") или print([["текст", "c-green"], "ещё текст"])
  function print(parts = "", cls) {
    const line = document.createElement("div");
    if (Array.isArray(parts)) {
      for (const p of parts) line.append(Array.isArray(p) ? span(p[0], p[1]) : span(p));
    } else {
      line.append(span(String(parts), cls));
    }
    if (!line.textContent) line.innerHTML = "&nbsp;";
    outputEl.append(line);
  }

  const error = msg => print(msg, "c-red");

  function printTable(columns, rows) {
    const table = document.createElement("table");
    table.className = "table";
    const head = table.insertRow();
    for (const c of columns) {
      const th = document.createElement("th");
      th.textContent = c;
      head.append(th);
    }
    for (const r of rows) {
      const tr = table.insertRow();
      for (const v of r) tr.insertCell().textContent = v === null ? "NULL" : String(v);
    }
    const wrap = document.createElement("div");
    wrap.append(table);
    outputEl.append(wrap);
  }

  function displayPath(p) {
    return p === FS.HOME ? "~" : p.startsWith(FS.HOME + "/") ? "~" + p.slice(FS.HOME.length) : p;
  }

  function renderPrompt() {
    promptEl.textContent = "";
    if (sqlMode) {
      promptEl.append(span(sqlBuffer ? "   ...>" : "sqlite>", "c-purple"));
    } else {
      promptEl.append(span(`${USER}@${HOST}`, "c-green bold"), span(":"),
        span(displayPath(cwd), "c-blue bold"), span("$"));
    }
    titleEl.textContent = `${USER}@${HOST}: ${displayPath(cwd)}`;
  }

  function echoInput(text) {
    const line = document.createElement("div");
    line.append(...Array.from(promptEl.childNodes).map(n => n.cloneNode(true)), span(" " + text));
    outputEl.append(line);
  }

  const scrollDown = () => { termEl.scrollTop = termEl.scrollHeight; };

  // ---------- разбор строки ----------
  function tokenize(line) {
    const tokens = [];
    let cur = "", quote = null, has = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if (ch === quote) quote = null; else cur += ch;
      } else if (ch === '"' || ch === "'") {
        quote = ch; has = true;
      } else if (/\s/.test(ch)) {
        if (cur || has) tokens.push(cur);
        cur = ""; has = false;
      } else if (ch === ">") {
        if (cur || has) tokens.push(cur);
        if (line[i + 1] === ">") { tokens.push(">>"); i++; } else tokens.push(">");
        cur = ""; has = false;
      } else {
        cur += ch;
      }
    }
    if (cur || has) tokens.push(cur);
    return tokens;
  }

  // ---------- SQL ----------
  function runSql(sql) {
    try {
      const { results, changes } = Database.exec(sql);
      if (!results.length) {
        print(`OK${changes ? `, изменено строк: ${changes}` : ""}`, "c-green");
      }
      for (const r of results) {
        printTable(r.columns, r.values);
        print(`(${r.values.length} ${plural(r.values.length, "строка", "строки", "строк")})`, "c-muted");
      }
    } catch (e) {
      error(`Ошибка SQL: ${e.message}`);
    }
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function sqlDot(cmd) {
    const [name, arg] = cmd.trim().split(/\s+/);
    switch (name) {
      case ".exit": case ".quit":
        sqlMode = false; sqlBuffer = ""; return;
      case ".tables":
        return runSql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
      case ".schema":
        return runSql(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL${arg ? ` AND tbl_name='${arg.replace(/'/g, "''")}'` : ""}`);
      case ".help":
        return [
          ".tables          список таблиц",
          ".schema [ТАБЛ]   схема таблиц",
          ".exit            выйти из режима SQL",
          "Любой SQL, заканчивающийся на ';', выполняется.",
        ].forEach(l => print(l));
      default:
        error(`Неизвестная команда: ${name}. Введите .help`);
    }
  }

  function handleSqlLine(line) {
    if (!sqlBuffer && line.trim().startsWith(".")) return sqlDot(line);
    sqlBuffer += (sqlBuffer ? "\n" : "") + line;
    if (sqlBuffer.trim().endsWith(";")) {
      const sql = sqlBuffer;
      sqlBuffer = "";
      runSql(sql);
    }
  }

  function ensureDb() {
    if (Database.ready()) return true;
    error("База данных ещё загружается или недоступна (нужен интернет для загрузки SQLite).");
    return false;
  }

  // ---------- команды ----------
  const commands = {
    help: {
      desc: "список команд",
      run() {
        print("Доступные команды:", "c-yellow");
        for (const [name, c] of Object.entries(commands)) {
          print([[name.padEnd(10), "c-green"], c.desc]);
        }
        print();
        print("Перенаправление вывода: echo текст > файл, echo текст >> файл", "c-muted");
        print("Клавиши: ↑/↓ — история, Tab — автодополнение, Ctrl+L — очистить, Ctrl+C — отмена", "c-muted");
      },
    },
    clear: { desc: "очистить экран", run() { outputEl.textContent = ""; } },
    pwd: { desc: "текущий каталог", run: () => cwd },
    whoami: { desc: "имя пользователя", run: () => USER },
    hostname: { desc: "имя хоста", run: () => HOST },
    date: { desc: "текущие дата и время", run: () => new Date().toString() },
    uname: { desc: "информация о системе", run: args => args.includes("-a") ? `NovaFPOS ${HOST} 1.0.0 web-${navigator.platform || "browser"} JS` : "NovaFPOS" },
    uptime: {
      desc: "время работы сеанса",
      run() {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        return `up ${Math.floor(s / 3600)}ч ${Math.floor(s / 60) % 60}м ${s % 60}с`;
      },
    },
    echo: { desc: "вывести текст", run: args => args.join(" ") },
    ls: {
      desc: "содержимое каталога [-a]",
      run(args) {
        const all = args.includes("-a") || args.includes("-la") || args.includes("-al");
        const target = args.find(a => !a.startsWith("-"));
        const abs = FS.resolve(cwd, target || ".");
        const node = FS.get(abs);
        if (!node) return error(`ls: ${target}: нет такого файла или каталога`);
        if (node.type === "file") return print(target);
        const names = Object.keys(node.children).sort().filter(n => all || !n.startsWith("."));
        if (!names.length) return;
        print(names.flatMap(n => [
          node.children[n].type === "dir" ? [n + "/", "c-blue bold"] : [n],
          "  ",
        ]));
      },
    },
    cd: {
      desc: "сменить каталог",
      run(args) {
        const abs = FS.resolve(cwd, args[0]);
        const node = FS.get(abs);
        if (!node) return error(`cd: ${args[0]}: нет такого каталога`);
        if (node.type !== "dir") return error(`cd: ${args[0]}: не каталог`);
        cwd = abs;
      },
    },
    cat: {
      desc: "показать файл",
      run(args) {
        if (!args.length) return error("cat: укажите файл");
        let out = "";
        for (const a of args) {
          const node = FS.get(FS.resolve(cwd, a));
          if (!node) { error(`cat: ${a}: нет такого файла`); continue; }
          if (node.type === "dir") { error(`cat: ${a}: это каталог`); continue; }
          out += node.content;
        }
        return out.replace(/\n$/, "") || undefined;
      },
    },
    touch: {
      desc: "создать пустой файл",
      run(args) {
        for (const a of args) {
          const abs = FS.resolve(cwd, a);
          if (!FS.get(abs)) FS.write(abs, "");
        }
      },
    },
    mkdir: {
      desc: "создать каталог [-p]",
      run(args) {
        const p = args.includes("-p");
        for (const a of args.filter(x => x !== "-p")) FS.mkdir(FS.resolve(cwd, a), p);
      },
    },
    rm: {
      desc: "удалить файл [-r]",
      run(args) {
        const r = args.some(a => /^-[rRf]+$/.test(a));
        for (const a of args.filter(x => !x.startsWith("-"))) FS.remove(FS.resolve(cwd, a), r);
      },
    },
    mv: {
      desc: "переместить/переименовать",
      run(args) {
        if (args.length !== 2) return error("mv: использование: mv ИСТОЧНИК НАЗНАЧЕНИЕ");
        FS.move(FS.resolve(cwd, args[0]), FS.resolve(cwd, args[1]));
      },
    },
    tree: {
      desc: "дерево каталогов",
      run(args) {
        const abs = FS.resolve(cwd, args[0] || ".");
        const node = FS.get(abs);
        if (!node || node.type !== "dir") return error("tree: нет такого каталога");
        print(displayPath(abs), "c-blue bold");
        (function walk(n, prefix) {
          const names = Object.keys(n.children).sort();
          names.forEach((name, i) => {
            const last = i === names.length - 1;
            const child = n.children[name];
            print([prefix + (last ? "└── " : "├── "), child.type === "dir" ? [name, "c-blue bold"] : name]);
            if (child.type === "dir") walk(child, prefix + (last ? "    " : "│   "));
          });
        })(node, "");
      },
    },
    history: {
      desc: "история команд [-c]",
      run(args) {
        if (args[0] === "-c") { history = []; saveHistory(); return; }
        history.forEach((h, i) => print(`${String(i + 1).padStart(4)}  ${h}`));
      },
    },
    calc: {
      desc: "калькулятор: calc 2*(3+4)",
      run(args) {
        const expr = args.join(" ");
        if (!/^[\d\s+\-*/%().^]+$/.test(expr)) return error("calc: допустимы только числа и + - * / % ^ ( )");
        try {
          const r = Function(`"use strict"; return (${expr.replace(/\^/g, "**")});`)();
          return String(r);
        } catch { return error("calc: неверное выражение"); }
      },
    },
    neofetch: {
      desc: "информация о системе",
      run() {
        const logo = [
          "   _  __              ",
          "  / |/ /__ _  _____ _ ",
          " /    / _ \\ |/ / _ `/ ",
          "/_/|_/\\___/___/\\_,_/  ",
        ];
        const info = [
          [`${USER}@${HOST}`, "c-green bold"],
          ["OS: NovaFPOS Web 1.0", ""],
          ["Shell: nsh 1.0", ""],
          [`DB: SQLite (sql.js) ${Database.ready() ? "● online" : "○ offline"}`, ""],
          [`Browser: ${navigator.userAgent.split(" ").pop()}`, ""],
        ];
        for (let i = 0; i < Math.max(logo.length, info.length); i++) {
          print([[(logo[i] || "").padEnd(24), "c-purple"], info[i] || ""]);
        }
      },
    },
    sql: {
      desc: "выполнить SQL: sql SELECT * FROM users",
      raw: true,
      run(rawArgs) {
        if (!ensureDb()) return;
        if (!rawArgs.trim()) return error("sql: укажите запрос, или введите sqlite для интерактивного режима");
        runSql(rawArgs);
      },
    },
    sqlite: {
      desc: "интерактивная консоль SQLite",
      run() {
        if (!ensureDb()) return;
        sqlMode = true;
        print("SQLite (sql.js). Введите .help для справки, .exit для выхода.", "c-muted");
        print("Запросы заканчиваются на ';'", "c-muted");
      },
    },
    db: {
      desc: "база: db tables | export | import | reset",
      async run(args) {
        if (!ensureDb()) return;
        switch (args[0]) {
          case "tables":
            return runSql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
          case "export": {
            const blob = new Blob([Database.exportBytes()], { type: "application/x-sqlite3" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "novafpos.db";
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            return print("Файл novafpos.db скачан.", "c-green");
          }
          case "import": {
            const file = await pickFile(".db,.sqlite,.sqlite3");
            if (!file) return print("Импорт отменён.", "c-muted");
            try {
              await Database.importBytes(new Uint8Array(await file.arrayBuffer()));
              return print(`Загружена база ${file.name}.`, "c-green");
            } catch (e) { return error(`Не удалось открыть файл: ${e.message}`); }
          }
          case "reset":
            await Database.reset();
            return print("База данных сброшена к начальному состоянию.", "c-green");
          default:
            print("Использование:", "c-yellow");
            print("  db tables   список таблиц");
            print("  db export   скачать базу как файл .db");
            print("  db import   загрузить файл .db");
            print("  db reset    сбросить базу");
        }
      },
    },
    reset: {
      desc: "сбросить файловую систему",
      run() { FS.reset(); cwd = FS.HOME; print("Файловая система восстановлена.", "c-green"); },
    },
  };

  function pickFile(accept) {
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.onchange = () => resolve(input.files[0] || null);
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  function saveHistory() {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(history.slice(-500))); } catch { /* недоступно */ }
  }

  async function execute(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    const name = trimmed.split(/\s+/)[0];
    const cmd = commands[name];
    if (!cmd) return error(`${name}: команда не найдена. Введите 'help'.`);

    if (cmd.raw) return cmd.run(trimmed.slice(name.length).trim());

    const tokens = tokenize(trimmed).slice(1);
    let redirect = null;
    const ri = tokens.findIndex(t => t === ">" || t === ">>");
    if (ri !== -1) {
      if (!tokens[ri + 1]) return error("синтаксическая ошибка: ожидается имя файла");
      redirect = { append: tokens[ri] === ">>", path: FS.resolve(cwd, tokens[ri + 1]) };
      tokens.splice(ri);
    }

    try {
      const result = await cmd.run(tokens);
      if (typeof result === "string") {
        if (redirect) FS.write(redirect.path, result + "\n", redirect.append);
        else print(result);
      }
    } catch (e) {
      error(`${name}: ${e.message}`);
    }
  }

  // ---------- автодополнение ----------
  function complete() {
    const value = inputEl.value;
    const parts = value.split(" ");
    const last = parts[parts.length - 1];
    let options;
    if (parts.length === 1 && !sqlMode) {
      options = Object.keys(commands).filter(c => c.startsWith(last));
    } else {
      const slash = last.lastIndexOf("/");
      const dirPart = slash === -1 ? "" : last.slice(0, slash + 1);
      const base = last.slice(slash + 1);
      const dir = FS.get(FS.resolve(cwd, dirPart || "."));
      if (!dir || dir.type !== "dir") return;
      options = Object.keys(dir.children).filter(n => n.startsWith(base))
        .map(n => dirPart + n + (dir.children[n].type === "dir" ? "/" : ""));
    }
    if (options.length === 1) {
      parts[parts.length - 1] = options[0];
      inputEl.value = parts.join(" ") + (options[0].endsWith("/") ? "" : " ");
    } else if (options.length > 1) {
      echoInput(value);
      print(options.join("  "));
      scrollDown();
    }
  }

  // ---------- ввод ----------
  inputEl.addEventListener("keydown", async e => {
    if (e.key === "Enter") {
      const line = inputEl.value;
      inputEl.value = "";
      echoInput(line);
      if (line.trim() && history[history.length - 1] !== line) {
        history.push(line);
        saveHistory();
      }
      histIndex = history.length;
      inputEl.disabled = true;
      try {
        if (sqlMode) handleSqlLine(line);
        else await execute(line);
      } finally {
        inputEl.disabled = false;
        renderPrompt();
        scrollDown();
        inputEl.focus();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (histIndex > 0) inputEl.value = history[--histIndex];
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      histIndex = Math.min(history.length, histIndex + 1);
      inputEl.value = history[histIndex] || "";
    } else if (e.key === "Tab") {
      e.preventDefault();
      complete();
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      outputEl.textContent = "";
    } else if (e.key === "c" && e.ctrlKey && !window.getSelection().toString()) {
      e.preventDefault();
      echoInput(inputEl.value + "^C");
      inputEl.value = "";
      sqlBuffer = "";
      renderPrompt();
      scrollDown();
    }
  });

  termEl.addEventListener("click", () => {
    if (!window.getSelection().toString()) inputEl.focus();
  });

  // ---------- старт ----------
  renderPrompt();
  print("NovaFPOS Terminal v1.0", "c-green bold");
  print("Введите 'help' для списка команд, 'sqlite' — для работы с базой данных.", "c-muted");
  print();

  Database.init()
    .then(() => print("● База данных SQLite подключена (хранится в вашем браузере).", "c-green"))
    .catch(e => error(`○ База данных недоступна: ${e.message}`))
    .finally(scrollDown);
})();
