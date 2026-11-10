# Light Visual Auth — Netlify Functions + Blobs

Бесплатная версия сервера аккаунтов Light Visual. Работает как функция Netlify, данные хранит в Netlify Blobs. Отдельная база и регистрация в других сервисах не нужны — только аккаунт Netlify.

**Живой сервер:** https://light-visual-auth.netlify.app

API и формат ответов совпадают с `NimbusAuthServer`, поэтому сайт и лаунчер работают без изменений.

## Деплой

1. Загрузи этот репозиторий на GitHub.
2. Открой [app.netlify.com/start](https://app.netlify.com/start) и войди через GitHub.
3. Выбери репозиторий `nimbus-auth-netlify`.
4. Build command оставь пустым, publish directory возьмётся из `netlify.toml` (`public`).
5. Нажми **Deploy**.
6. Получишь адрес вида `https://nimbus-auth-netlify.netlify.app`.

Переменные окружения не нужны: Netlify сам выдаёт функции доступ к Blobs.

Проверка:

```
https://nimbus-auth-netlify.netlify.app/api/health
```

```json
{"ok":true,"service":"nimbus-auth","version":1,"storage":"netlify-blobs"}
```

## API

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/health` | проверка работы |
| POST | `/api/register` | `{username, password, repeat}` → токен и пользователь |
| POST | `/api/login` | `{username, password}` → токен и пользователь |
| GET | `/api/me` | заголовок `Authorization: Bearer <токен>` → пользователь |
| POST | `/api/logout` | завершает сессию |

Пароли хранятся как scrypt-хэш. UUID совпадает с оффлайн-UUID Minecraft. Сессия живёт 30 дней. После 8 неверных попыток вход блокируется на 15 минут, регистрация с одного IP ограничена 10 в час.

## Как хранятся данные

В store `nimbus-auth`:

- `account/<ник>` — `displayName`, `salt`, `hash`, `createdAt`, `lastLogin`, счётчик ошибок;
- `session/<токен>` — ник и срок действия.

Запись ника атомарная (`onlyIfNew`), поэтому два человека не смогут занять один ник. Сессии и обновления аккаунта используют `onlyIfMatch` и повторы при конфликте. Store работает в режиме `strong`, чтобы регистрация сразу была видна при входе.

## Ограничения Free

Netlify Free: 300 кредитов в месяц. Один вызов функции — примерно 0.1–0.2 секунды при 1 ГБ памяти, то есть около 5 кредитов на 10 000 входов. Этого хватает с большим запасом. Деплой расходует 15 кредитов.

## Локальные тесты

```
npm install
npm test
```

Проверяются регистрация, вход, выход, сессии, UUID, дубликаты ников, лимиты и ошибки — на in-memory хранилище, без Netlify.

## Резервная копия

Netlify UI → **Data & Storage → Blobs → nimbus-auth**. Можно скачать отдельные записи. Для полного бэкапа аккаунтов достаточно выгрузить ключи `account/*` и `session/*`.
