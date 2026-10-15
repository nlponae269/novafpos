# NovaFPOS Terminal

Симулятор терминала в браузере со встроенной бесплатной базой данных SQLite.

## Возможности

- Файловая система: `ls`, `cd`, `pwd`, `cat`, `touch`, `mkdir -p`, `rm -r`, `mv`, `tree`
- Перенаправление вывода: `echo текст > файл`, `echo текст >> файл`
- История команд (↑/↓), автодополнение (Tab), `Ctrl+L`, `Ctrl+C`
- Утилиты: `help`, `clear`, `date`, `whoami`, `uname -a`, `uptime`, `calc`, `neofetch`, `history`
- **База данных SQLite** (через [sql.js](https://github.com/sql-js/sql.js)):
  - `sql SELECT * FROM users` — выполнить один запрос
  - `sqlite` — интерактивная консоль (`.tables`, `.schema`, `.exit`)
  - `db export` / `db import` / `db reset` — скачать, загрузить или сбросить базу

## База данных

База полностью бесплатная и не требует регистрации или сервера: SQLite работает
в браузере через WebAssembly, а данные сохраняются в IndexedDB. Каждый посетитель
получает свою собственную базу. Чтобы перенести данные, используйте `db export`
и `db import`.

## Запуск локально

```bash
python3 -m http.server 8000
# открыть http://localhost:8000
```

## Публикация на GitHub Pages

Settings → Pages → Source: **Deploy from a branch** → выбрать ветку и папку `/ (root)` → Save.
Через минуту сайт будет доступен по адресу `https://<пользователь>.github.io/novafpos/`.
