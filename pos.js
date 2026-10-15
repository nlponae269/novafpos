(() => {
  const $ = id => document.getElementById(id);
  const screenEl = $("screen");
  const deviceEl = $("device");
  const ledEl = $("led");
  const nfcEl = $("nfc");

  const TERMINAL_ID = "T-0001";
  const MERCHANT = "Магазин «Нова»";
  const PIN_LIMIT = 300000; // 3 000 ₽ в копейках — выше нужен PIN
  const CORRECT_PIN = "1234";
  const MAX_DIGITS = 9;

  const TEST_CARDS = [
    { id: "ok", mask: "•••• 4242", label: "Успешная оплата", cls: "c1" },
    { id: "nofunds", mask: "•••• 0002", label: "Недостаточно средств", cls: "c2", decline: "Недостаточно средств" },
    { id: "pin", mask: "•••• 3220", label: "Всегда запрашивает PIN", cls: "c3", pin: true },
  ];

  const METHOD_NAMES = { card: "Карта", cash: "Наличные", qr: "QR-код" };

  let state = { step: "loading" };
  let busy = false;
  let soundOn = true;
  let lastReceipt = null;

  // ---------- утилиты ----------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const money = k => (k / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";

  const digitsToKop = s => parseInt(s || "0", 10);

  const randDigits = n => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

  const nowStr = () => new Date().toLocaleString("ru-RU");

  function currentShift() {
    return Database.query("SELECT * FROM shifts WHERE closed IS NULL ORDER BY id DESC LIMIT 1")[0];
  }

  // ---------- звук ----------
  let audio;
  function beep(freq = 1800, ms = 60, delay = 0) {
    if (!soundOn) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime + delay / 1000;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      osc.type = "square";
      gain.gain.setValueAtTime(0.04, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + ms / 1000);
    } catch { /* звук недоступен */ }
  }
  const beepOk = () => { beep(1500, 120); beep(2000, 180, 140); };
  const beepBad = () => { beep(400, 250); beep(300, 300, 270); };

  // ---------- экраны ----------
  const ICON_CONTACTLESS = `<svg class="contactless" viewBox="0 0 24 24"><path d="M8.5 7.5a6 6 0 0 1 0 9"/><path d="M12 5a9.5 9.5 0 0 1 0 14"/><path d="M15.5 2.5a13 13 0 0 1 0 19"/></svg>`;

  function header(title) {
    const shift = Database.ready() ? currentShift() : null;
    return `<div class="scr-head"><span>${esc(title)}</span><span>${shift ? "Смена №" + shift.id : TERMINAL_ID}</span></div>`;
  }

  function qrSvg(seed) {
    const n = 25;
    let x = seed;
    const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
    const finderOn = (r, c) => {
      for (const [fr, fc] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
        const i = r - fr, j = c - fc;
        if (i >= 0 && j >= 0 && i <= 6 && j <= 6) {
          return i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4);
        }
      }
      return null;
    };
    let rects = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const f = finderOn(r, c);
        const on = f !== null ? f : rnd() > 0.5;
        if (on) rects += `<rect x="${c}" y="${r}" width="1" height="1"/>`;
      }
    }
    return `<svg class="qr" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" fill="#0f1a26">${rects}</svg>`;
  }

  const screens = {
    loading: () => `${header("Запуск")}<div class="scr-body"><div class="spinner"></div><div class="scr-label">Подключение к базе данных…</div></div>`,

    error: s => `${header("Ошибка")}<div class="scr-body"><div class="result-icon bad">!</div>
      <div class="scr-title">Терминал недоступен</div><div class="scr-label">${esc(s.message)}</div></div>`,

    amount: s => `${header("Продажа")}<div class="scr-body">
        <div class="scr-label">Сумма к оплате</div>
        <div class="scr-amount">${money(digitsToKop(s.input))}</div>
      </div>
      <div class="scr-foot">Введите сумму и нажмите <b>OK</b> · <b>≡</b> — меню</div>`,

    method: s => `${header("Способ оплаты")}<div class="scr-body">
        <div class="scr-amount sm">${money(s.amount)}</div>
        <div class="scr-options">
          <button class="scr-btn" data-action="method" data-value="card"><span class="num">1</span>Банковская карта</button>
          <button class="scr-btn" data-action="method" data-value="cash"><span class="num">2</span>Наличные</button>
          <button class="scr-btn" data-action="method" data-value="qr"><span class="num">3</span>QR-код (СБП)</button>
        </div>
      </div>
      <div class="scr-foot"><b>C</b> — изменить сумму</div>`,

    card: s => `${header(s.refund ? "Возврат" : "Оплата картой")}<div class="scr-body">
        <div class="scr-amount sm">${money(s.amount)}</div>
        ${ICON_CONTACTLESS}
        <div class="scr-title">Приложите карту</div>
        <div class="scr-label">Выберите тестовую карту на панели</div>
      </div>
      <div class="scr-foot"><b>C</b> — отмена</div>`,

    pin: s => `${header("Оплата картой")}<div class="scr-body">
        <div class="scr-amount sm">${money(s.amount)}</div>
        <div class="scr-label">Карта ${esc(s.card.mask)}</div>
        <div class="scr-title">Введите PIN</div>
        <div class="pin-dots">${[0, 1, 2, 3].map(i => `<span class="${i < s.pin.length ? "on" : ""}"></span>`).join("")}</div>
      </div>
      <div class="scr-foot"><b>OK</b> — подтвердить · <b>C</b> — отмена</div>`,

    cash: s => {
      const given = digitsToKop(s.input);
      const change = given - s.amount;
      return `${header("Наличные")}<div class="scr-body">
        <div class="scr-list">
          <div><span>К оплате</span><span>${money(s.amount)}</span></div>
          <div><span>Получено</span><span>${money(given)}</span></div>
          <div><span>Сдача</span><span class="${change < 0 ? "res-bad" : ""}">${change < 0 ? "—" : money(change)}</span></div>
        </div>
        ${s.input ? "" : `<button class="scr-btn primary" data-action="exact">Без сдачи</button>`}
      </div>
      <div class="scr-foot">Введите полученную сумму · <b>OK</b> · <b>C</b> — назад</div>`;
    },

    qr: s => `${header("Оплата по QR")}<div class="scr-body">
        <div class="scr-amount sm">${money(s.amount)}</div>
        ${qrSvg(s.qrSeed)}
        <div class="scr-label">Отсканируйте код в приложении банка</div>
        <button class="scr-btn primary" data-action="qr-paid">Клиент оплатил (симуляция)</button>
      </div>
      <div class="scr-foot"><b>C</b> — отмена</div>`,

    processing: s => `${header(s.refund ? "Возврат" : "Оплата")}<div class="scr-body">
        <div class="spinner"></div>
        <div class="scr-title">${esc(s.text || "Связь с банком…")}</div>
        <div class="scr-label">Не извлекайте карту</div>
      </div>`,

    result: s => `${header(s.tx.type === "refund" ? "Возврат" : "Результат")}<div class="scr-body">
        <div class="result-icon ${s.tx.status === "approved" ? "ok" : "bad"}">${s.tx.status === "approved" ? "✓" : "✕"}</div>
        <div class="scr-title ${s.tx.status === "approved" ? "res-ok" : "res-bad"}">${s.tx.status === "approved" ? "ОДОБРЕНО" : "ОТКАЗ"}</div>
        <div class="scr-amount sm">${money(s.tx.amount)}</div>
        ${s.tx.message ? `<div class="scr-label">${esc(s.tx.message)}</div>` : ""}
        ${s.tx.method === "cash" && s.tx.status === "approved" && s.tx.type === "sale"
          ? `<div class="scr-title">Сдача: ${money(s.tx.cash_given - s.tx.amount)}</div>` : ""}
      </div>
      <div class="scr-foot"><b>OK</b> — новая продажа</div>`,

    menu: () => `${header("Меню")}<div class="scr-body">
        <div class="scr-options">
          <button class="scr-btn" data-action="menu" data-value="1"><span class="num">1</span>Возврат</button>
          <button class="scr-btn" data-action="menu" data-value="2"><span class="num">2</span>X-отчёт (итоги смены)</button>
          <button class="scr-btn" data-action="menu" data-value="3"><span class="num">3</span>Z-отчёт (закрыть смену)</button>
        </div>
      </div>
      <div class="scr-foot"><b>C</b> — назад</div>`,

    refund: s => `${header("Возврат")}<div class="scr-body">
        <div class="scr-label">Номер операции продажи</div>
        <div class="scr-amount">${s.input ? "№ " + esc(s.input) : "№ _"}</div>
        ${s.error ? `<div class="scr-label res-bad">${esc(s.error)}</div>` : ""}
      </div>
      <div class="scr-foot">Введите номер и нажмите <b>OK</b> · <b>C</b> — назад</div>`,

    refundConfirm: s => `${header("Возврат")}<div class="scr-body">
        <div class="scr-label">Операция № ${s.orig.id} · ${esc(METHOD_NAMES[s.orig.method])}${s.orig.card ? " " + esc(s.orig.card) : ""}</div>
        <div class="scr-amount sm">${money(s.orig.amount)}</div>
        <div class="scr-title">Выполнить возврат?</div>
      </div>
      <div class="scr-foot"><b>OK</b> — подтвердить · <b>C</b> — отмена</div>`,

    report: s => `${header(s.z ? "Z-отчёт" : "X-отчёт")}<div class="scr-body">
        <div class="scr-title">${s.z ? `Смена №${s.shiftId} закрыта` : `Смена №${s.shiftId}`}</div>
        <div class="scr-list">
          <div><span>Продаж</span><span>${s.sum.sales_count} / ${money(s.sum.sales)}</span></div>
          <div><span>Возвратов</span><span>${s.sum.refunds_count} / ${money(s.sum.refunds)}</span></div>
          <div><span>Отказов</span><span>${s.sum.declined}</span></div>
          <div><span>Итого</span><span>${money(s.sum.sales - s.sum.refunds)}</span></div>
        </div>
      </div>
      <div class="scr-foot"><b>OK</b> — продолжить</div>`,
  };

  function render() {
    screenEl.innerHTML = screens[state.step](state);
    nfcEl.classList.toggle("active", state.step === "card");
    ledEl.className = "led " + ({ processing: "busy", error: "err", loading: "busy" }[state.step] || "on");
  }

  function go(step, extra = {}) {
    state = { step, ...extra };
    render();
  }

  const newSale = () => go("amount", { input: "" });

  function shake() {
    deviceEl.classList.remove("shake");
    void deviceEl.offsetWidth;
    deviceEl.classList.add("shake");
    beepBad();
  }

  // ---------- операции ----------
  function record(tx) {
    const shift = currentShift();
    const id = Database.run(
      `INSERT INTO transactions (shift_id, type, method, amount, status, message, card, auth_code, rrn, cash_given, ref_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [shift.id, tx.type, tx.method, tx.amount, tx.status, tx.message ?? null, tx.card ?? null,
        tx.auth_code ?? null, tx.rrn ?? null, tx.cash_given ?? null, tx.ref_id ?? null],
    );
    if (tx.type === "refund" && tx.status === "approved") {
      Database.run("UPDATE transactions SET refunded = 1 WHERE id = ?", [tx.ref_id]);
    }
    return Database.query("SELECT * FROM transactions WHERE id = ?", [id])[0];
  }

  function finish(tx) {
    const saved = record(tx);
    tx.status === "approved" ? beepOk() : beepBad();
    printReceipt(saved);
    refreshPanel();
    go("result", { tx: saved });
  }

  function process(text, ms, tx) {
    busy = true;
    go("processing", { text, refund: tx.type === "refund" });
    setTimeout(() => {
      busy = false;
      finish(typeof tx === "function" ? tx() : tx);
    }, ms);
  }

  function authorizeCard(s) {
    const base = { type: "sale", method: "card", amount: s.amount, card: s.card.mask };
    process("Связь с банком…", 1600, () => {
      if (s.pin !== undefined && s.pin !== CORRECT_PIN) {
        return { ...base, status: "declined", message: "Неверный PIN-код" };
      }
      if (s.card.decline) {
        return { ...base, status: "declined", message: s.card.decline };
      }
      return { ...base, status: "approved", auth_code: randDigits(6), rrn: randDigits(12) };
    });
  }

  function tapCard(card, el) {
    if (busy) return;
    if (state.step !== "card") {
      shake();
      return;
    }
    el?.classList.remove("tapping");
    void el?.offsetWidth;
    el?.classList.add("tapping");
    nfcEl.classList.add("flash");
    setTimeout(() => nfcEl.classList.remove("flash"), 400);
    beep(2400, 90);

    if (state.refund) {
      const orig = state.orig;
      return process("Возврат средств…", 1400, {
        type: "refund", method: "card", amount: orig.amount, status: "approved",
        card: card.mask, auth_code: randDigits(6), rrn: randDigits(12), ref_id: orig.id,
      });
    }
    if (card.pin || state.amount > PIN_LIMIT) {
      go("pin", { amount: state.amount, card, pin: "" });
    } else {
      authorizeCard({ amount: state.amount, card });
    }
  }

  function shiftSummary(shiftId) {
    return Database.query(`
      SELECT
        COUNT(CASE WHEN type = 'sale' AND status = 'approved' THEN 1 END) AS sales_count,
        COALESCE(SUM(CASE WHEN type = 'sale' AND status = 'approved' THEN amount END), 0) AS sales,
        COUNT(CASE WHEN type = 'refund' AND status = 'approved' THEN 1 END) AS refunds_count,
        COALESCE(SUM(CASE WHEN type = 'refund' AND status = 'approved' THEN amount END), 0) AS refunds,
        COUNT(CASE WHEN status = 'declined' THEN 1 END) AS declined,
        COALESCE(SUM(CASE WHEN status = 'approved' AND method = 'card' THEN (CASE type WHEN 'sale' THEN amount ELSE -amount END) END), 0) AS card,
        COALESCE(SUM(CASE WHEN status = 'approved' AND method = 'cash' THEN (CASE type WHEN 'sale' THEN amount ELSE -amount END) END), 0) AS cash,
        COALESCE(SUM(CASE WHEN status = 'approved' AND method = 'qr'   THEN (CASE type WHEN 'sale' THEN amount ELSE -amount END) END), 0) AS qr
      FROM transactions WHERE shift_id = ?`, [shiftId])[0];
  }

  function startRefund(id) {
    const orig = Database.query("SELECT * FROM transactions WHERE id = ?", [id])[0];
    let error = null;
    if (!orig) error = "Операция не найдена";
    else if (orig.type !== "sale") error = "Это не операция продажи";
    else if (orig.status !== "approved") error = "Операция не была одобрена";
    else if (orig.refunded) error = "Возврат уже выполнен";
    if (error) {
      beepBad();
      return go("refund", { input: String(id), error });
    }
    go("refundConfirm", { orig });
  }

  function confirmRefund(orig) {
    if (orig.method === "card") {
      return go("card", { amount: orig.amount, refund: true, orig });
    }
    process("Возврат средств…", 1000, {
      type: "refund", method: orig.method, amount: orig.amount, status: "approved",
      rrn: orig.method === "qr" ? randDigits(12) : null, ref_id: orig.id,
    });
  }

  // ---------- клавиши ----------
  function onKey(key) {
    if (busy || state.step === "loading" || state.step === "error") return;
    beep();
    const s = state;
    const isDigit = /^\d+$/.test(key);

    switch (s.step) {
      case "amount":
        if (isDigit) {
          const next = (s.input + key).replace(/^0+/, "");
          if (next.length <= MAX_DIGITS) s.input = next;
        } else if (key === "BS") s.input = s.input.slice(0, -1);
        else if (key === "C") s.input = "";
        else if (key === "OK") {
          const amount = digitsToKop(s.input);
          return amount > 0 ? go("method", { amount }) : shake();
        } else if (key === "MENU") return go("menu");
        return render();

      case "method":
        if (key === "1") return go("card", { amount: s.amount });
        if (key === "2") return go("cash", { amount: s.amount, input: "" });
        if (key === "3") return go("qr", { amount: s.amount, qrSeed: Date.now() % 100000 });
        if (key === "C" || key === "BS") return go("amount", { input: String(s.amount) });
        return;

      case "card":
        if (key === "C") return s.refund ? go("menu") : go("method", { amount: s.amount });
        return;

      case "pin":
        if (isDigit) { if (s.pin.length < 4) s.pin = (s.pin + key).slice(0, 4); }
        else if (key === "BS") s.pin = s.pin.slice(0, -1);
        else if (key === "C") return go("method", { amount: s.amount });
        else if (key === "OK") return s.pin.length === 4 ? authorizeCard(s) : shake();
        return render();

      case "cash":
        if (isDigit) {
          const next = (s.input + key).replace(/^0+/, "");
          if (next.length <= MAX_DIGITS) s.input = next;
        } else if (key === "BS") s.input = s.input.slice(0, -1);
        else if (key === "C") return go("method", { amount: s.amount });
        else if (key === "OK") {
          const given = s.input ? digitsToKop(s.input) : s.amount;
          if (given < s.amount) return shake();
          return finish({ type: "sale", method: "cash", amount: s.amount, status: "approved", cash_given: given });
        }
        return render();

      case "qr":
        if (key === "C") return go("method", { amount: s.amount });
        if (key === "OK") return payQr();
        return;

      case "result":
      case "report":
        if (key === "OK" || key === "C") return newSale();
        return;

      case "menu":
        if (key === "1") return go("refund", { input: "" });
        if (key === "2" || key === "3") return report(key === "3");
        if (key === "C" || key === "MENU") return newSale();
        return;

      case "refund":
        if (isDigit) { if (s.input.length < 9) s.input = (s.input + key).replace(/^0+/, ""); s.error = null; }
        else if (key === "BS") { s.input = s.input.slice(0, -1); s.error = null; }
        else if (key === "C") return go("menu");
        else if (key === "OK") return s.input ? startRefund(Number(s.input)) : shake();
        return render();

      case "refundConfirm":
        if (key === "OK") return confirmRefund(s.orig);
        if (key === "C") return go("menu");
        return;
    }
  }

  function payQr() {
    process("Ожидание подтверждения…", 1500, {
      type: "sale", method: "qr", amount: state.amount, status: "approved", rrn: randDigits(12),
    });
  }

  function report(close) {
    const shift = currentShift();
    const sum = shiftSummary(shift.id);
    if (close) {
      Database.run("UPDATE shifts SET closed = datetime('now', 'localtime') WHERE id = ?", [shift.id]);
      Database.run("INSERT INTO shifts DEFAULT VALUES");
      refreshPanel();
    }
    beep(1500, 120);
    go("report", { z: close, shiftId: shift.id, sum });
  }

  // ---------- чек ----------
  function printReceipt(tx) {
    const W = 36;
    const line = "-".repeat(W);
    const center = t => " ".repeat(Math.max(0, Math.floor((W - t.length) / 2))) + t;
    const row = (l, r) => l + " ".repeat(Math.max(1, W - l.length - r.length)) + r;

    const out = [
      center(MERCHANT),
      center("Терминал " + TERMINAL_ID),
      line,
      center(tx.type === "refund" ? "ВОЗВРАТ" : "ОПЛАТА"),
      row("Операция №", String(tx.id)),
      row("Дата", tx.created.replace(/(\d+)-(\d+)-(\d+)/, "$3.$2.$1")),
      row("Смена №", String(tx.shift_id)),
      line,
      row("Способ", METHOD_NAMES[tx.method]),
    ];
    if (tx.card) out.push(row("Карта", tx.card));
    if (tx.ref_id) out.push(row("К операции №", String(tx.ref_id)));
    if (tx.auth_code) out.push(row("Код авторизации", tx.auth_code));
    if (tx.rrn) out.push(row("RRN", tx.rrn));
    out.push(line, row("ИТОГО", money(tx.amount)));
    if (tx.method === "cash" && tx.type === "sale" && tx.cash_given != null) {
      out.push(row("Получено", money(tx.cash_given)), row("Сдача", money(tx.cash_given - tx.amount)));
    }
    out.push(line, center(tx.status === "approved" ? "*** ОДОБРЕНО ***" : "*** ОТКАЗ ***"));
    if (tx.message) out.push(center(tx.message));
    out.push("", center("Демо-чек симулятора."), center("Не является фискальным документом."));

    lastReceipt = tx;
    const el = $("receipt");
    el.textContent = out.join("\n");
    $("receipt-card").hidden = false;
    el.classList.remove("printing");
    void el.offsetWidth;
    el.classList.add("printing");
  }

  // ---------- панель ----------
  function refreshPanel() {
    const shift = currentShift();
    const sum = shiftSummary(shift.id);
    $("shift-no").textContent = "№" + shift.id;
    $("shift-opened").textContent = "открыта " + shift.opened.replace(/(\d+)-(\d+)-(\d+)/, "$3.$2.$1");
    const avg = sum.sales_count ? Math.round(sum.sales / sum.sales_count) : 0;
    const stat = (v, l) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    $("stats").innerHTML = [
      stat(money(sum.sales - sum.refunds), "Выручка"),
      stat(sum.sales_count, "Продаж"),
      stat(money(avg), "Средний чек"),
      stat(money(sum.card), "Картой"),
      stat(money(sum.cash), "Наличными"),
      stat(money(sum.qr), "По QR"),
      stat(sum.refunds_count, "Возвратов"),
      stat(sum.declined, "Отказов"),
    ].join("");

    const rows = Database.query("SELECT * FROM transactions ORDER BY id DESC LIMIT 50");
    if (!rows.length) {
      $("journal").innerHTML = `<div class="empty">Операций пока нет. Введите сумму на терминале и нажмите OK.</div>`;
      return;
    }
    $("journal").innerHTML = `<table>
      <thead><tr><th>№</th><th>Время</th><th>Тип</th><th>Способ</th><th class="amt">Сумма</th><th>Статус</th><th></th></tr></thead>
      <tbody>${rows.map(t => {
        const badge = t.status !== "approved" ? `<span class="badge bad" title="${esc(t.message)}">Отказ</span>`
          : t.refunded ? `<span class="badge ref">Возвращено</span>`
          : `<span class="badge ok">Одобрено</span>`;
        const canRefund = t.type === "sale" && t.status === "approved" && !t.refunded;
        return `<tr>
          <td>${t.id}</td>
          <td>${esc(t.created.slice(5, 16).replace(/(\d+)-(\d+)/, "$2.$1"))}</td>
          <td>${t.type === "refund" ? "Возврат" : "Продажа"}</td>
          <td>${esc(METHOD_NAMES[t.method])}${t.card ? " " + esc(t.card.slice(-4)) : ""}</td>
          <td class="amt">${t.type === "refund" ? "−" : ""}${money(t.amount)}</td>
          <td>${badge}</td>
          <td>
            <button class="link-btn" data-receipt="${t.id}">Чек</button>
            ${canRefund ? ` · <button class="link-btn" data-refund="${t.id}">Возврат</button>` : ""}
          </td>
        </tr>`;
      }).join("")}</tbody></table>`;
  }

  function renderTestCards() {
    $("test-cards").innerHTML = TEST_CARDS.map(c => `
      <button class="test-card ${c.cls}" type="button" data-card="${c.id}" aria-label="Приложить карту ${esc(c.mask)}: ${esc(c.label)}">
        <span class="chip"></span>
        <span><span class="num">${esc(c.mask)}</span><br><span class="desc">${esc(c.label)}</span></span>
      </button>`).join("");
  }

  // ---------- события ----------
  // Кнопки терминала не забирают фокус, чтобы Enter не «нажимал» их повторно.
  for (const el of [deviceEl, $("test-cards")]) {
    el.addEventListener("mousedown", e => { if (e.target.closest("button")) e.preventDefault(); });
  }

  $("keypad").addEventListener("click", e => {
    const btn = e.target.closest("button[data-key]");
    if (btn) onKey(btn.dataset.key);
  });

  screenEl.addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn || busy) return;
    beep();
    const { action, value } = btn.dataset;
    if (action === "method") onKey({ card: "1", cash: "2", qr: "3" }[value]);
    else if (action === "menu") onKey(value);
    else if (action === "exact") onKey("OK");
    else if (action === "qr-paid") payQr();
  });

  $("test-cards").addEventListener("click", e => {
    const btn = e.target.closest("[data-card]");
    if (btn) tapCard(TEST_CARDS.find(c => c.id === btn.dataset.card), btn);
  });

  nfcEl.addEventListener("click", () => tapCard(TEST_CARDS[0]));

  $("journal").addEventListener("click", e => {
    const r = e.target.closest("[data-refund]");
    const p = e.target.closest("[data-receipt]");
    if (r && !busy) startRefund(Number(r.dataset.refund));
    if (p) {
      printReceipt(Database.query("SELECT * FROM transactions WHERE id = ?", [Number(p.dataset.receipt)])[0]);
      $("receipt-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  $("print").addEventListener("click", () => lastReceipt && window.print());

  $("sound").addEventListener("click", e => {
    soundOn = !soundOn;
    e.currentTarget.textContent = "Звук: " + (soundOn ? "вкл" : "выкл");
    e.currentTarget.setAttribute("aria-pressed", String(soundOn));
  });

  $("db-export").addEventListener("click", () => {
    if (!Database.ready()) return;
    const blob = new Blob([Database.exportBytes()], { type: "application/x-sqlite3" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "novapos.db";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // Подтверждение прямо в интерфейсе: первое нажатие спрашивает, второе — очищает.
  let resetTimer = null;
  $("db-reset").addEventListener("click", async e => {
    const btn = e.currentTarget;
    if (!Database.ready() || busy) return;
    if (!resetTimer) {
      btn.textContent = "Точно очистить?";
      btn.classList.add("confirm");
      resetTimer = setTimeout(() => {
        resetTimer = null;
        btn.textContent = "Очистить";
        btn.classList.remove("confirm");
      }, 4000);
      return;
    }
    clearTimeout(resetTimer);
    resetTimer = null;
    btn.textContent = "Очистить";
    btn.classList.remove("confirm");
    await Database.reset();
    $("receipt-card").hidden = true;
    refreshPanel();
    newSale();
  });

  const KEYMAP = { Enter: "OK", NumpadEnter: "OK", Backspace: "BS", Escape: "C", Delete: "C", m: "MENU", "ь": "MENU" };
  document.addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest("input, textarea")) return;
    const key = /^\d$/.test(e.key) ? e.key : KEYMAP[e.key];
    if (!key) return;
    const btn0 = e.target.closest("button");
    if (btn0 && !deviceEl.contains(btn0) && (e.key === "Enter" || e.key === " ")) return;
    e.preventDefault();
    const btn = document.querySelector(`#keypad [data-key="${key}"]`);
    btn?.classList.add("pressed");
    setTimeout(() => btn?.classList.remove("pressed"), 100);
    onKey(key);
  });

  // ---------- запуск ----------
  renderTestCards();
  render();
  Database.init()
    .then(() => { refreshPanel(); newSale(); })
    .catch(e => {
      go("error", { message: "Не удалось открыть базу данных: " + e.message });
      $("journal").innerHTML = `<div class="empty">База данных недоступна. Проверьте подключение к интернету и обновите страницу.</div>`;
    });
})();
