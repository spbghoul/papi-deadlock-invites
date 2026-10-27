# Papi's Deadlock Invites

**Live:** https://deadlockpapi.duckdns.org · **License:** [MIT](LICENSE) · independent community project, not affiliated with Valve.

## For users: what this bot does (English)

1. You comment `thank you papi` on [the bot's Steam profile](https://steamcommunity.com/id/deadlockpapi/) and send it a friend request.
2. The bot reads public profile comments, accepts the friend request, and asks Valve's Deadlock game coordinator to send you a playtest invite — the same thing a player does from the in-game friends list.
3. Five minutes after Valve confirms the invite, the bot removes you from its friends list.

**What is stored:** your SteamID64, public profile URL and persona name, the comment ID, and the status/timestamps of your request. Nothing else.
**What is never needed:** your password, Steam Guard codes, or any login — never give those to anyone offering invites.
Invites are free. The bot sends at most one invite per Steam account. The full source code is in this repository.

---

Сайт + Steam-бот: пользователь оставляет комментарий **«thank you papi»** в профиле бота ([steamcommunity.com/id/deadlockpapi](https://steamcommunity.com/id/deadlockpapi/)), добавляет бота в друзья — бот отправляет инвайт в плейтест Deadlock, затем удаляет из друзей.

> Перед запуском прочитайте [docs/FEASIBILITY.md](docs/FEASIBILITY.md) — что работает официально, что неофициально и что невозможно.

## Структура

```
├─ src/
│  ├─ app/                    Next.js (App Router)
│  │  ├─ page.tsx             главная: hero, шаги, статистика, статус, FAQ
│  │  ├─ admin/               админка (page.tsx, login/, actions.ts — server actions)
│  │  └─ api/                 /api/stats, /api/status, /api/health
│  ├─ components/             CopyPhrase, LiveStats, StatusChecker (клиентские)
│  ├─ lib/
│  │  ├─ db/                  Kysely: schema, migrations (SQLite/PostgreSQL), client
│  │  ├─ repo.ts              общие запросы, guarded-переходы статусов
│  │  ├─ adminOps.ts          действия админа (retry/approve/reject/mark_sent, block, pause)
│  │  ├─ statuses.ts          машина состояний + публичные статусы
│  │  ├─ auth.ts              scrypt-хэш пароля, HMAC-сессии
│  │  └─ config.ts            валидация env (zod)
│  ├─ providers/              DeadlockInviteProvider: gc / manual / mock
│  └─ worker/                 Steam-бот: index.ts, workflow.ts, steamGateway.ts, comments.ts
├─ scripts/                   steam-login, hash-password, migrate
├─ tests/                     vitest: workflow, GC-провайдер, парсер, утилиты
├─ Dockerfile, docker-compose.yml, Caddyfile, .env.example
```

## Как это работает

```
comment "thank you papi" ─► [worker опрашивает комментарии раз в 60 с]
   └─► waiting_friendship ─(пользователь кидает заявку, бот принимает)─► invite_pending
          └─► inviting ─► provider.sendInvite()
                ├─ sent (явный Success от GC) ─► invite_sent ─(задержка)─► удаление из друзей ─► completed
                ├─ manual_required ─► awaiting_manual ─(админ: Mark sent)─► invite_sent
                ├─ retry / defer ─► invite_pending (backoff)
                ├─ rejected ─► failed
                └─ uncertain (таймаут/краш) ─► needs_review (НИКОГДА не повторяется автоматически)
```

Защита от дублей: `UNIQUE(steam_id)` и `UNIQUE(comment_id)` в БД, каждая смена статуса — `UPDATE … WHERE status = <ожидаемый>`; запросы, зависшие в `inviting` после рестарта, уходят в `needs_review`.

## Установка на Windows 11 (разработка)

1. Установите Node.js 22 LTS:
   ```bash
   winget install OpenJS.NodeJS.LTS
   ```
   Перезапустите терминал. (Если `npm install` попросит собрать `better-sqlite3`, установите «Visual Studio Build Tools» с C++ — обычно не требуется, есть готовые бинарники.)
2. Зависимости и конфиг:
   ```bash
   npm install
   ```
   ```bash
   copy .env.example .env
   ```
3. Пароль админки (выведет `ADMIN_PASSWORD_HASH` и `SESSION_SECRET` — вставьте в `.env`):
   ```bash
   npm run admin:hash-password
   ```
   Для локального HTTP добавьте в `.env`: `COOKIE_SECURE=false`.
4. Заполните `BOT_PROFILE_URL`. Для первого прогона без Steam-аккаунта логики можно поставить `INVITE_PROVIDER=mock` (только dev).
5. Вход бота в Steam (один раз, вводите пароль и код Steam Guard сами; сохраняется только refresh-токен в `data/`):
   ```bash
   npm run steam:login
   ```
   Выведенный SteamID64 впишите в `BOT_STEAM_ID`.
6. Запуск — в двух терминалах:
   ```bash
   npm run dev
   ```
   ```bash
   npm run worker:dev
   ```
   Сайт: http://localhost:3000, админка: http://localhost:3000/admin, здоровье воркера: http://localhost:3001/health

### Требования к аккаунту бота

* Отдельный аккаунт (не основной).
* Для `INVITE_PROVIDER=gc`: у бота **должен быть доступ к Deadlock**, и аккаунт не должен быть limited (≥ $5 покупок).
* Профиль и комментарии — публичные, иначе люди не смогут комментировать.

## Тесты

```bash
npm test
```
```bash
npm run typecheck
```

Покрыто: полный путь комментарий→дружба→инвайт→удаление; дубли и параллельная обработка; восстановление после краша (`inviting`→`needs_review` без повторной отправки); таймаут провайдера; backoff и лимит попыток; `NotFriendsLongEnough` без расхода попыток; пауза; часовой лимит; manual-режим; блок-лист; истечение ожидания; парсер HTML комментариев; protobuf-кодирование и маппинг всех кодов ответа GC; хэш пароля и подпись сессий.

Ручная проверка end-to-end с `INVITE_PROVIDER=mock`: запустите сайт и воркер, оставьте комментарий с тестового аккаунта, киньте заявку в друзья — в админке увидите `[MOCK]`-инвайт и удаление из друзей.

## Деплой на Ubuntu VPS (Docker Compose)

```bash
curl -fsSL https://get.docker.com | sudo sh
```
```bash
git clone <ваш-репозиторий> /opt/ddi
```
```bash
cd /opt/ddi && cp .env.example .env && nano .env
```
В `.env`: `NODE_ENV=production`, `DOMAIN=ваш.домен`, `BOT_PROFILE_URL`, `BOT_STEAM_ID`, `INVITE_PROVIDER`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET` (сгенерируйте локально через `npm run admin:hash-password`).

Сборка и одноразовый вход в Steam (токен сохранится в volume `/data`):
```bash
sudo docker compose build
```
```bash
sudo docker compose run --rm -it worker node_modules/.bin/tsx scripts/steam-login.ts
```
Запуск вместе с HTTPS (Caddy сам получит сертификат Let's Encrypt; A-запись домена должна указывать на VPS, порты 80/443 открыты):
```bash
sudo docker compose --profile tls up -d
```
Логи и статус:
```bash
sudo docker compose logs -f worker
```
```bash
sudo docker compose ps
```
Бэкап SQLite:
```bash
sudo docker compose exec web sh -c "cp /data/app.db /data/backup-$(date +%F).db"
```

### Переход на PostgreSQL

Поставьте `DATABASE_URL=postgres://user:pass@host:5432/ddi` — миграции написаны через Kysely schema builder и запускаются на обоих диалектах автоматически при старте (или `npm run migrate`).

## Админка

`/admin` — статус бота и GC, пауза/возобновление, задержка удаления из друзей, метрики (24 ч / 1 ч / среднее время до инвайта), таблица заявок с фильтрами и поиском, действия:
* **Mark sent / Was sent** — админ подтверждает, что инвайт реально отправлен (manual-режим или разбор `needs_review`);
* **Not sent · retry / Retry** — повторить; **Approve** / **Reject**;
* блок-лист SteamID; журнал событий и ошибок.

Учётные данные Steam, токены и куки никогда не попадают в браузер: веб-часть читает только БД.

## Что нельзя сделать (ограничения Steam/Valve)

* **Нет официального API для инвайтов Deadlock.** Провайдер `gc` использует внутреннее сообщение Game Coordinator; Valve может изменить его без предупреждения.
* **Нельзя проверить доставку/принятие инвайта.** «Отправлено» = GC ответил Success. `verifyInviteStatus()` честно возвращает `unknown`.
* **Нет официального API комментариев профиля.** Используется внутренний endpoint сообщества; при изменении разметки нужно обновить `parseCommentsHtml`.
* **Limited-аккаунт не может отправлять заявки в друзья** — поэтому пользователь сам добавляет бота (шаг 3 на сайте).
* **Неизвестны** точный срок дружбы для `NotFriendsLongEnough`, размер лимита инвайтов и значение `location`.
* Push-уведомлений о новых комментариях нет — только опрос (по умолчанию раз в 60 с).
