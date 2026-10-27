# Бесплатный автономный хостинг: Oracle Cloud + DuckDNS

Итог: сайт `https://deadlockpapi.duckdns.org` и бот работают 24/7 на бесплатном сервере Oracle, ПК не нужен.

Вы делаете шаги 1–3 (аккаунты), всё остальное — скрипт `deploy/deploy.ps1`.

## 1. Сервер Oracle Cloud (≈10 мин)

1. https://cloud.oracle.com → **Sign up**. Нужна банковская карта только для проверки личности, списаний за Always Free нет.
   **Home region** выбирается один раз навсегда — берите ближайший (например Germany Central (Frankfurt)).
2. Меню → **Compute → Instances → Create instance**:
   * **Image**: Canonical Ubuntu 24.04.
   * **Shape**: Change shape → Ampere → `VM.Standard.A1.Flex`, 2 OCPU / 12 GB (если не даёт — 1 OCPU / 6 GB).
   * **Networking**: Create new virtual cloud network, **Assign a public IPv4 address** — включено.
   * **Add SSH keys** → *Paste public keys* → вставьте содержимое файла `deploy/papi_server.pub`.
   * **Create**. Ошибка «Out of capacity» — смените Availability domain или повторите позже.
3. Откройте порты 80/443: на странице инстанса → ссылка на **Subnet** → **Security** (Security Lists) → **Default Security List** → **Add Ingress Rules**:
   * Source CIDR `0.0.0.0/0`, IP Protocol TCP, Destination port `80,443`.
4. Скопируйте **Public IP address** инстанса.

> Oracle может остановить «простаивающий» Always Free сервер (низкая нагрузка 7 дней). Надёжная защита — в Billing перейти на **Pay As You Go**: бесплатные лимиты сохраняются, а правило про простой перестаёт действовать. Следите, чтобы не создавать платных ресурсов.

## 2. Домен DuckDNS (≈2 мин)

1. https://www.duckdns.org → войдите через GitHub или Google.
2. В поле **sub domain** впишите `deadlockpapi` → **add domain**.
3. В строке домена в поле **current ip** вставьте Public IP из шага 1 → **update ip**.

## 3. Деплой (одна команда)

Из папки проекта:

```bash
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Server ubuntu@<PUBLIC_IP> -Domain deadlockpapi.duckdns.org
```

Скрипт упакует проект, загрузит на сервер, поставит Docker, откроет порты в фаерволе Ubuntu, соберёт и запустит `web`, `worker` и Caddy (HTTPS-сертификат Let's Encrypt получится автоматически). `-ExecutionPolicy Bypass` действует только на этот запуск и не меняет настройки Windows.

## 4. Вход бота в Steam (один раз)

```bash
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Server ubuntu@<PUBLIC_IP> -Domain deadlockpapi.duckdns.org -SteamLogin
```

Введите логин, пароль бота и код Steam Guard. На сервере сохранится только refresh-токен, пароль нигде не хранится. После этого бот работает сам и переподключается после сбоев и перезагрузок (`restart: unless-stopped`).

## Обновление сайта

Повторите команду из шага 3 — данные (`/data`: база, токен Steam) сохраняются в Docker volume.

## Полезное

```bash
ssh -i %USERPROFILE%\.ssh\papi_server ubuntu@<PUBLIC_IP> "cd /opt/papi && sudo docker compose logs --tail 100 worker"
```
