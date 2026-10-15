# Fount на Linux: запуск, проверка и откат

Цель: https://fount.angleford.co, VPS <VPS_IP>, SSH <SSH_PORT>. Для этого сервера
используйте раздел Existing Caddy ниже; общая процедура относится к новому серверу.
Приложение не требует локального сервера, Rust, Node или исходников на компьютере
пользователя. Он открывает HTTPS-сайт и скачивает готовый ZIP.

## Перед первым запуском

Подключение: `ssh -p <SSH_PORT> deploy@<VPS_IP>`. Вход по существующему SSH-ключу
проверен. Изменение пароля SSH и ключей не входит в установку Fount.

В SSH-терминале проверьте ОС и ресурсы:

```sh
cat /etc/os-release
uname -m
free -h
df -h /
docker version
docker compose version
docker network ls
sudo ss -lntup
```

Ожидаются Linux amd64, Docker Engine с Compose, свободные порты 80/443, отсутствие
конфликта с сетью 172.30.87.0/29. На текущем сервере проверена Ubuntu 24.04.4 LTS.
Устанавливать Docker следует по инструкции для фактически установленной ОС:
https://docs.docker.com/engine/install/. Не запускать команды для Ubuntu на Debian.

В панели провайдера разрешите входящие TCP 80, TCP/UDP 443 и SSH TCP <SSH_PORT>. Порт
8787 не открывайте. Если ограничиваете SSH своим IP, сначала добавьте свой адрес,
проверьте второе подключение, затем закрывайте общий доступ. Если сервер уже
обслуживает другие сайты, не заменяйте их reverse proxy и firewall без проверки.

На VPS с 2 GB RAM сборка Rust одновременно с работающим Chromium может исчерпать
память. Dockerfile собирает по одному модулю. Для обновления используйте отдельный
Linux builder с той же архитектурой либо остановите app на время сборки. Для
первой сборки при недостатке памяти временно увеличьте RAM в панели провайдера;
не включайте постоянную подкачку пользовательских данных без отдельного решения.

## Архив для переноса

В папке проекта выполните `node scripts/package-deploy.cjs`. Получатся
`output/hosted-preparation/fount-source.tar.gz` и файл `.sha256`. Архив содержит
текущую проверенную рабочую копию и не требует commit или push. Он включает
готовые UI/WASM-файлы; Docker повторно собирает UI из исходников.

Передача из PowerShell после настройки ключа:

```powershell
scp -P <SSH_PORT> output/hosted-preparation/fount-source.tar.gz output/hosted-preparation/fount-source.tar.gz.sha256 deploy@<VPS_IP>:/tmp/
```

На сервере сначала проверьте контрольную сумму, затем распакуйте в новый каталог.
Не распаковывайте поверх действующей установки до создания резервной копии:

```sh
cd /tmp
sha256sum -c fount-source.tar.gz.sha256
sudo mkdir /opt/fount
sudo tar xzf /tmp/fount-source.tar.gz -C /opt/fount
sudo chown -R deploy:deploy /opt/fount
```

Команда mkdir должна создать новую папку. Если /opt/fount уже существует,
остановитесь на проверке текущей установки и используйте процедуру обновления.

## Сборка и секрет

Передайте согласованную версию исходников в /opt/fount. Используйте тот же архив
исходников, который прошёл проверки; не отправляйте output, fonts, .env, секреты,
node_modules или старые бинарные файлы. В этой рабочей копии есть незакоммиченные
изменения: обычный git pull не переносит их на сервер.

```sh
cd /opt/fount/deploy
cp .env.example .env
nano .env
docker compose config --quiet
docker compose build app
docker run --rm fount:2026-09-15-1 --version
```

В .env задайте FOUNT_DOMAIN=fount.angleford.co, уникальный FOUNT_VERSION (например, 2026-09-15-1), FOUNT_PASSWORD_HASH_FILE=/etc/fount/password.hash.

Создайте новый пароль в менеджере паролей: минимум 24 случайных символа. Не
используйте пароль SSH. Команда спросит его без отображения и напечатает хэш:

```sh
docker run --rm -it fount:2026-09-15-1 password-hash
sudo install -d -m 700 /etc/fount
sudo nano /etc/fount/password.hash
sudo chown 10001:10001 /etc/fount/password.hash
sudo chmod 600 /etc/fount/password.hash
```

В редактор вставьте только строку, начинающуюся с $argon2id$. Сохранить: Ctrl+O,
Enter, выйти: Ctrl+X. UID 10001 нужен, потому что контейнер работает без root.
Docker Compose монтирует файл как secret только для чтения; uid/mode в Compose
для bind-mounted secrets не заменяют права исходного файла. Пароль в .env не нужен.

## Сетевая изоляция и HTTPS

Сначала создайте контейнеры без запуска и установите правила исходящей сети:

```sh
docker compose create
sudo sh /opt/fount/deploy/egress.sh
```

Скрипт затрагивает только адрес app 172.30.87.2. Он запрещает новые соединения из
сканера во внутренние сети и к самому хосту; ответы Caddy продолжат проходить.
Docker должен использовать iptables backend и DOCKER-USER. IPv6 на этой Docker-сети
не включён. Не включайте его без эквивалентных IPv6-правил. Правила необходимы и
для Chromium: одной проверки URL недостаточно против DNS rebinding и запросов
из фоновых браузерных процессов.

Контейнер app использует on-failure:5: он перезапускается при падении, но не
стартует автоматически при загрузке Docker до установки сетевых правил.
Установите готовый systemd unit, который сначала создаёт сеть, затем применяет
egress-правила и только после этого поднимает app:

```sh
sudo install -m 644 /opt/fount/deploy/fount.service /etc/systemd/system/fount.service
sudo systemctl daemon-reload
sudo systemctl enable fount.service
```

Первый запуск — `sudo systemctl start fount.service`. После reboot проверьте
`sudo systemctl status fount.service` и отрицательные сетевые проверки ниже.
После ручного сброса firewall остановите app и повторно примените egress.sh
перед запуском. Скрипт не должен запускаться параллельно со сбросом Docker rules.
Откат: `sudo systemctl disable --now fount.service`, затем
`sudo sh /opt/fount/deploy/egress.sh remove`. Сертификаты останутся на месте.

В Cloudflare откройте angleford.co → DNS → Records → Add record:

| Поле | Значение |
| --- | --- |
| Type | A |
| Name | fount |
| IPv4 address | <VPS_IP> |
| Proxy status | DNS only для первоначальной выдачи сертификата |
| TTL | Auto |

Запустите сервис и дождитесь сертификата:

```sh
sudo systemctl start fount.service
docker compose ps
docker compose logs --tail=60 app caddy
curl -I https://fount.angleford.co/
curl -i https://fount.angleford.co/api/export/not-a-real-archive
```

Ожидается HTTPS без ошибки сертификата, вход на сайте и 401 для API. Затем включите
Proxied у записи fount. Для этого hostname задайте SSL Full (strict) через
Configuration Rule; не меняйте режим всей зоны angleford.co без проверки других
сайтов. Не используйте Flexible. Правило кэша: bypass для fount.angleford.co/api/*;
не включайте Cache Everything для API. Cloudflare может прерывать долгие запросы
раньше серверного лимита; при 524 уменьшите batch/используйте Page source only.

Caddy доверяет CF-Connecting-IP только от официальных сетей Cloudflare. Диапазоны
проверены 15 сентября 2026; перед запуском сравните с https://www.cloudflare.com/ips-v4
и https://www.cloudflare.com/ips-v6. Прямой клиент не может подделать этот заголовок.
Логи исключают request URI, заголовки, cookies и тела; ротация ограничена 3 × 5 MB.

## Приёмка на сервере

```sh
docker compose exec app curl --fail http://127.0.0.1:8787/healthz
docker stats --no-stream
docker compose exec app sh -c 'test ! -w /app && test -w /tmp'
docker compose exec app curl --connect-timeout 3 --max-time 5 http://169.254.169.254/
docker compose exec app curl --connect-timeout 3 --max-time 5 http://172.30.87.1/
```

Последние два запроса должны завершиться отказом. С внешнего компьютера порт 8787
не должен отвечать. Проверьте в браузере: неверный пароль; вход; реальный скан
публичной страницы через Browser render; выбор и ZIP; загрузку WOFF2; изменение
имени и ZIP; повторный вход после logout; 401 без cookie; 429 при второй тяжёлой
операции. Распакуйте ZIP и проверьте name table, а не только размер ответа.

После серии операций сравните docker stats, содержимое /tmp до и после TTL
(uploads 30 минут, ZIP 15 минут, очистка каждые 15 секунд). После restart каталог
/tmp пустой, авторизация/загрузки/архивы недействительны. Проверка healthz не
подтверждает работоспособность Chromium; нужен реальный render-скан.

## Обновление и откат

Не перезаписывайте тег работающего образа. В /opt/fount/deploy:

```sh
backup_dir=/var/backups/fount/$(date +%Y%m%d-%H%M%S)
sudo install -d -m 700 "$backup_dir"
sudo cp .env compose.yaml Caddyfile /etc/fount/password.hash "$backup_dir/"
docker compose images
sudo docker run --rm -v fount_caddy_data:/data:ro -v "$backup_dir:/backup" alpine:3.22 tar czf /backup/caddy-data.tgz -C /data .
sudo find "$backup_dir" -maxdepth 1 -type f -exec chmod 600 {} +
```

Запишите текущий FOUNT_VERSION. Передайте новые проверенные исходники, задайте
новый тег в .env и соберите его. При 2 GB RAM остановите app на время сборки
(`docker compose stop app`), если нет отдельного builder. Это вызовет перерыв:
сообщите владельцу до выполнения. После сборки:

```sh
docker compose config --quiet
docker compose up -d --no-build --wait
docker compose logs --tail=60 app caddy
```

Проверьте вход и оба ZIP-сценария. При ошибке верните старый FOUNT_VERSION и
совместимые compose.yaml/Caddyfile из backup, затем:

```sh
docker compose up -d --no-build --wait
```

Не удаляйте предыдущие образы до приёмки. `docker compose down -v` удалит
сертификаты; для обычной остановки используйте `docker compose down`.
Секреты и резервные копии не храните в репозитории.

При потере пароля создайте новый hash той же CLI-командой, сохраните старый файл
в закрытой backup-папке и замените /etc/fount/password.hash, сохранив владельца
10001 и mode 600. Затем `docker compose up -d --force-recreate app`. Все сессии
будут отозваны. Это единственный способ восстановления; email не используется.

## Проверки подготовки

```sh
npm ci --ignore-scripts
npm run build:ui
cargo fmt --manifest-path core/Cargo.toml --check
cargo test --manifest-path core/Cargo.toml --offline
cargo build --release --locked --manifest-path core/Cargo.toml
node scripts/check-metadata-editor.cjs http://127.0.0.1:8790
```

Первое получение новых Rust-зависимостей требует сети: cargo fetch --locked.
HTTPS-проверка: задайте FOUNT_QA_URL и FOUNT_QA_PASSWORD только в окружении
тестового процесса, затем запустите `node scripts/check-hosted.cjs`. Она делает
одну неудачную попытку входа, меняет тестовый шрифт и завершает сессию. Для
локального самоподписанного сертификата дополнительно задайте FOUNT_QA_SELF_SIGNED=1;
эта опция принимается скриптом только для localhost. Не сохраняйте пароль в .env
или в истории команд.
Полный протокол авторизации и будущего расширения: ../docs/HOSTED-API.md.
Расширение по умолчанию работает локально; публикация в магазине и серверный
режим не включены в эту поставку.
# Existing Caddy on <VPS_IP> (2026-09-16)

This shared server already serves other sites on ports 80/443. Use
`compose.existing-caddy.yaml` and `fount-existing-caddy.service` (installed as
`/etc/systemd/system/fount.service`). The system Caddy imports
`/opt/fount/deploy/Caddyfile.existing`; it connects directly to 172.30.87.2:8787.
No application port is published. The trusted proxy is the bridge gateway
172.30.87.1. Limits on this shared host are 900 MiB RAM, 1100 MiB including swap,
0.70 CPU, and one heavy operation at a time.

Update with `sudo docker compose -f compose.existing-caddy.yaml build app` from
`/opt/fount/deploy`, then `sudo systemctl restart fount`. Check
`sudo docker compose -f compose.existing-caddy.yaml ps` and
`curl --fail https://fount.angleford.co/healthz`.

Building the generated Chromium bindings needs more memory than running Fount.
On this 2 GiB shared VPS, provide at least 2 GiB additional swap for a source
build, or build the Linux image on a larger machine and transfer it. The
headless_chrome release profile disables optimization only for those bindings;
font conversion remains optimized. Do not increase the running app's memory
limit to accommodate a build.

Rollback: set the previous FOUNT_VERSION in `/opt/fount/deploy/.env` and restart
fount. Keep the previous image until verification finishes. To undo the initial
installation, stop fount, restore `/etc/caddy/Caddyfile.before-fount-20260916`,
validate Caddy, and reload it. Remove only the Fount DNS record and the two
Fount rulesets in Cloudflare; leave other services and zone settings intact.

The initial login password was delivered to the owner; its temporary delivery
file was removed. The server keeps only the working Argon2id hash at
`/etc/fount/password.hash`, owner 10001:10001, mode 600. To replace it, use the
password-hash CLI interactively and restart fount; existing sessions expire.

## Сетевые правила до старта Docker (2026-10-15)

`restart: on-failure:5` не гарантирует, что Docker не поднимет app раньше
`fount.service`: после аварийной перезагрузки dockerd может перезапустить
контейнер сам, ещё без egress-правил. Поэтому правила ставятся отдельным unit
до Docker, а таймер раз в минуту возвращает их, если `netfilter-persistent`,
`ufw` или ручной сброс firewall их удалили. Повторный запуск `egress.sh` теперь
не открывает доступ даже на мгновение: на время пересборки новые соединения app
отклоняются целиком.

```sh
sudo install -m 644 /opt/fount/deploy/fount-egress.service /etc/systemd/system/
sudo install -m 644 /opt/fount/deploy/fount-egress-check.service /etc/systemd/system/
sudo install -m 644 /opt/fount/deploy/fount-egress-check.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable fount-egress.service fount-egress-check.timer
sudo systemctl start fount-egress.service fount-egress-check.timer
sudo sh /opt/fount/deploy/egress.sh ensure && echo rules-present
```

Обновите и сам `fount.service` из `fount-existing-caddy.service`: он теперь
ждёт `fount-egress.service`.

Чтобы ни один другой процесс на этом VPS не мог подключиться к 172.30.87.2:8787
и выдать себя за Caddy (подставить чужой IP и обойти лимит попыток входа),
задайте пользователя системного Caddy. Сначала проверьте, от кого он работает:
`ps -o user= -C caddy`. Если это `caddy`, добавьте
`Environment=FOUNT_PROXY_USER=caddy` в секцию `[Service]` всех трёх unit-файлов
выше и в `fount.service`, затем `daemon-reload` и
`sudo FOUNT_PROXY_USER=caddy sh /opt/fount/deploy/egress.sh`. Если Caddy
работает от root, не включайте эту опцию: сайт перестанет открываться.

Каждой сборке давайте новый `FOUNT_VERSION`; не пересобирайте под тем же тегом,
иначе откатываться будет не на что. Для команд `docker compose` без `-f`
добавьте в `.env` строку `COMPOSE_FILE=compose.existing-caddy.yaml`.
Пересобирайте образ с `--pull` хотя бы раз в месяц: Chromium в нём берётся из
Debian и получает исправления безопасности только при новой сборке.
