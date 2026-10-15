// Виртуальная файловая система, хранится в localStorage.
const FS = (() => {
  const KEY = "novafpos.fs";
  const HOME = "/home/guest";

  const defaultTree = () => ({
    type: "dir", children: {
      home: { type: "dir", children: {
        guest: { type: "dir", children: {
          "readme.txt": { type: "file", content: "Добро пожаловать в NovaFPOS Terminal!\nВведите 'help', чтобы увидеть список команд.\n" },
          projects: { type: "dir", children: {} },
        } },
      } },
      etc: { type: "dir", children: {
        hostname: { type: "file", content: "novafpos\n" },
      } },
      tmp: { type: "dir", children: {} },
    },
  });

  let root;
  try { root = JSON.parse(localStorage.getItem(KEY)) || defaultTree(); }
  catch { root = defaultTree(); }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(root)); } catch { /* хранилище недоступно */ }
  }

  function resolve(cwd, path) {
    if (!path || path === "~") path = HOME;
    else if (path.startsWith("~/")) path = HOME + path.slice(1);
    const parts = (path.startsWith("/") ? path : `${cwd}/${path}`).split("/");
    const out = [];
    for (const p of parts) {
      if (!p || p === ".") continue;
      if (p === "..") out.pop(); else out.push(p);
    }
    return "/" + out.join("/");
  }

  function get(abs) {
    let node = root;
    for (const p of abs.split("/").filter(Boolean)) {
      if (node.type !== "dir" || !node.children[p]) return null;
      node = node.children[p];
    }
    return node;
  }

  function parentOf(abs) {
    const i = abs.lastIndexOf("/");
    return { dir: get(abs.slice(0, i) || "/"), name: abs.slice(i + 1) };
  }

  function mkdir(abs, recursive = false) {
    if (recursive) {
      let node = root;
      for (const p of abs.split("/").filter(Boolean)) {
        if (!node.children[p]) node.children[p] = { type: "dir", children: {} };
        node = node.children[p];
        if (node.type !== "dir") throw new Error(`${p}: не каталог`);
      }
      return persist();
    }
    const { dir, name } = parentOf(abs);
    if (!dir || dir.type !== "dir") throw new Error("нет такого каталога");
    if (dir.children[name]) throw new Error("файл уже существует");
    dir.children[name] = { type: "dir", children: {} };
    persist();
  }

  function write(abs, content, append = false) {
    const { dir, name } = parentOf(abs);
    if (!dir || dir.type !== "dir" || !name) throw new Error("нет такого каталога");
    const node = dir.children[name];
    if (node && node.type === "dir") throw new Error("это каталог");
    dir.children[name] = { type: "file", content: append && node ? node.content + content : content };
    persist();
  }

  function remove(abs, recursive = false) {
    if (abs === "/") throw new Error("нельзя удалить корень");
    const { dir, name } = parentOf(abs);
    const node = dir && dir.children[name];
    if (!node) throw new Error("нет такого файла или каталога");
    if (node.type === "dir" && !recursive) throw new Error("это каталог (используйте -r)");
    delete dir.children[name];
    persist();
  }

  function move(from, to) {
    const src = parentOf(from);
    const node = src.dir && src.dir.children[src.name];
    if (!node) throw new Error("нет такого файла или каталога");
    if (to === from || to.startsWith(from + "/")) throw new Error("нельзя переместить каталог в самого себя");
    const target = get(to);
    const dst = target && target.type === "dir" ? { dir: target, name: src.name } : parentOf(to);
    if (!dst.dir || dst.dir.type !== "dir") throw new Error("нет такого каталога");
    delete src.dir.children[src.name];
    dst.dir.children[dst.name] = node;
    persist();
  }

  function reset() { root = defaultTree(); persist(); }

  return { HOME, resolve, get, mkdir, write, remove, move, reset };
})();
