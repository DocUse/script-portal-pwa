# Script Portal PWA

PWA-обёртка тренировочного кабинета "Скрипты обучения" над Apps Script JSON API.

## Зачем

Старый кабинет открывался через `script.google.com/macros/.../exec` и работал
внутри iframe с принудительной шириной 980px. На iPhone это превращалось в
визуально "сжатую" десктопную страницу. Этот PWA-проект решает корень проблемы:

- фронтенд хостится на собственном домене (`app.portal-naimtech.ru`);
- рендерится в реальном `393×852` viewport iPhone, без iframe и downscale;
- ставится на главный экран (`Add to Home Screen`) и запускается как полноценное
  standalone-приложение, без адресной строки Safari;
- доступ контролируется тем же способом, что и раньше — Google Sign-In + сверка
  email со "Справочник рекрутеров".

Архитектура:

```
[PWA на app.portal-naimtech.ru]
       Google Identity Services → ID token (JWT)
       JSONP-fetch с токеном
              ↓
[Второй deployment Apps Script "Anyone"]
       21_script_portal_api_v2.gs верифицирует токен
       сверяет email со "Справочник рекрутеров"
       читает данные из Google Sheet
       отдаёт JSONP-ответ
```

Старый deployment Apps Script остаётся как есть — он продолжает обслуживать
личный кабинет рекрутера (`portal-naimtech.ru`). Ничего там не ломаем.

## Состав папки

- `index.html` — оболочка PWA (viewport, manifest, GIS-скрипт)
- `config.js` — **обязательно отредактировать перед деплоем** (см. ниже)
- `styles.css` — портированные стили из `script_portal_styles_v2.html`
- `app.js` — клиентская логика: Sign-In + JSONP + рендеринг
- `manifest.webmanifest` — PWA-манифест
- `icons/icon.svg` — плейсхолдер-иконка (заменить на брендовую при возможности)
- `package.json` — простой `build`-скрипт для TimeWeb App Platform

## Развёртывание: 4 шага

### Шаг 1. Apps Script — создать второй deployment с Anyone-доступом

В коде `Apps Script` уже есть всё нужное:

- `21_script_portal_api_v2.gs` — обработчик API
- ветка `?api=script-portal-data` в `doGet(e)` (файл `15_recruiter_portal_v2.gs`)

Что делает API: принимает `id_token` (Google JWT), верифицирует его через
`https://oauth2.googleapis.com/tokeninfo`, проверяет `aud` (наш OAuth client ID),
сверяет email со "Справочник рекрутеров", и отдаёт данные сценария JSONP'ом.

**Шаги в Apps Script:**

1. Открыть проект Apps Script (тот же, что обслуживает существующий
   личный кабинет). Убедиться, что `21_script_portal_api_v2.gs` загружен.
2. `Deploy → New deployment` (плюсик слева сверху).
3. Type: **Web app**.
4. Description: `Script Portal JSON API (Anyone)`.
5. Execute as: **Me** (владелец таблицы).
6. Who has access: **Anyone** (без `with Google account`).
   — Это ключевая настройка. Она означает, что Apps Script не будет форсить
   Google-логин на URL-уровне. Контроль доступа полностью на стороне нашего
   кода в `21_script_portal_api_v2.gs`.
7. `Deploy`. Скопировать выданный URL вида:
   `https://script.google.com/macros/s/AKfycb.../exec`
8. Сохранить этот URL — он понадобится в Шаге 2.

**Проверка endpoint'а из браузера:**

```
https://script.google.com/macros/s/AKfycb.../exec?api=script-portal-data&callback=test
```

Без токена должен вернуться:

```js
test({"ok":false,"error":{"code":"no_token","message":"Не передан Google id_token."}});
```

Если так — endpoint жив. Если редирект на Google login — выбран не тот доступ
("Anyone with Google account" вместо "Anyone").

### Шаг 2. Заполнить config.js

Открыть `config.js` и заменить:

```js
apiUrl: 'PASTE_NEW_APPS_SCRIPT_EXEC_URL_HERE',
```

на URL из Шага 1, например:

```js
apiUrl: 'https://script.google.com/macros/s/AKfycb.../exec',
```

`oauthClientId` уже заполнен — это публичный ID нашего "Web client 1" из
Google Cloud. Менять не нужно.

`enableDebugOverlay: true` — оставить включённым на первый деплой, чтобы по
скриншоту убедиться, что viewport iPhone действительно 393, а не 980. После
проверки выключить и сделать второй деплой.

### Шаг 3. Google Cloud — добавить домен в Authorized JavaScript origins

Без этого Google Sign-In откажется работать на нашем домене с ошибкой
`idpiframe_initialization_failed` или `redirect_uri_mismatch`.

1. Открыть [Google Cloud Console — Credentials](https://console.cloud.google.com/apis/credentials).
2. Выбрать проект, в котором живёт наш OAuth-клиент (Client ID
   `435134581493-qkqpf78e7oh4e7th1e1rpd7qe9hpv7f3.apps.googleusercontent.com`).
3. Открыть OAuth client `Web client 1` → Edit.
4. В секцию **Authorized JavaScript origins** добавить:
   - `https://app.portal-naimtech.ru` (production)
5. Если будете тестировать локально — добавить:
   - `http://localhost:8080`
   - или другой порт, на котором запускаете локальный статик-сервер.
6. **Authorized redirect URIs** — оставить как есть (для GIS One Tap не нужно).
7. Save. Применяется до нескольких часов, обычно — в течение минуты.

### Шаг 4. TimeWeb — поддомен + второе frontend-приложение

#### 4.1. Завести поддомен `app.portal-naimtech.ru`

В панели TimeWeb:

1. Меню слева: **Домены и SSL** → выбрать `portal-naimtech.ru`.
2. Раздел **Поддомены** → `Добавить поддомен`.
3. Имя: `app`. Полное имя: `app.portal-naimtech.ru`.
4. Сохранить. DNS-запись (CNAME) пропишется автоматически, если домен
   обслуживается DNS TimeWeb. Проверить можно через `dig app.portal-naimtech.ru`
   или [dnschecker.org](https://dnschecker.org).

#### 4.2. Залить PWA на отдельный GitHub-репозиторий

(TimeWeb App Platform деплоит из git-репозитория.)

1. Создать новый GitHub-репозиторий, например `script-portal-pwa`.
2. Скопировать содержимое этой папки (`script-portal-pwa/`) в корень репозитория.
3. Запушить в `main`.

Альтернатива: если не хочется отдельный репо — использовать поддиректорию в
существующем `discipline-v2-domain-wrapper` репо и в TimeWeb указать
`Build directory`-ом подпапку.

#### 4.3. Создать второе Frontend-приложение в TimeWeb

1. TimeWeb → **Cloud Apps** (или **Apps Platform**, в зависимости от версии
   панели) → **Создать приложение** → **Frontend**.
2. Подключить GitHub-репозиторий из 4.2.
3. Branch: `main`.
4. Build command:

   ```bash
   npm run build
   ```

5. Output directory:

   ```
   dist
   ```

6. Создать. Дождаться первого деплоя.
7. Открыть приложение по техническому домену TimeWeb (что-то вида
   `xxxx.cloud.timeweb.cloud`). Если открывается белая страница и в Network
   видно загрузку HTML/CSS/JS — деплой ок.

#### 4.4. Привязать поддомен `app.portal-naimtech.ru` к новому приложению

1. В настройках нового приложения → **Домены и SSL**.
2. Добавить домен: `app.portal-naimtech.ru`.
3. Дождаться выпуска SSL Let's Encrypt (5–15 минут обычно).
4. Открыть `https://app.portal-naimtech.ru` — должно открыться то же, что и по
   техническому домену.

### Шаг 5. Проверка на iPhone

1. На iPhone Safari открыть `https://app.portal-naimtech.ru`.
2. **Должна появиться экран входа** с кнопкой "Войти с Google".
3. **В правом верхнем углу — жёлтый блок DEBUG VIEWPORT** (если
   `enableDebugOverlay: true` в `config.js`). В нём должно быть:

   ```
   inner:  393 x ~700
   outer:  393 x 852
   screen: 393 x 852
   visual: 393 x ~700
   in iframe: no            ← ключевое
   standalone: no           ← пока в Safari
   ```

   Если `inner: 393` и `in iframe: no` — **корневая проблема устранена**.
   Если опять `inner: 980` — значит что-то не так в Шаге 4 (TimeWeb всё ещё
   проксирует через iframe или подмешивает виртуальный viewport).

4. Сделать скриншот, прислать.
5. Войти через Google. Контент должен загрузиться.
6. **Add to Home Screen** (Share → Добавить на экран Домой).
7. Открыть с домашнего экрана. В debug-оверлее теперь:
   `standalone: yes` — значит запустилось как приложение без Safari-UI.

### Шаг 6. После проверки

- Поправить `config.js`: `enableDebugOverlay: false`.
- (Опционально) заменить `icons/icon.svg` на нормальный набор иконок.
- В Apps Script заменить кнопку "Скрипты обучения" в личном кабинете рекрутера
  на ссылку `https://app.portal-naimtech.ru/`. (Соответствующее место в коде —
  `disciplineV2GetScriptPortalPageUrl_` в файле `20_script_portal_view_v2.gs`,
  можно либо оставить старый URL для fallback'а, либо заменить.)

## Локальный запуск для разработки

```bash
# из этой папки
python3 -m http.server 8080
```

Открыть `http://localhost:8080`. Не забыть, что для GIS на localhost нужно
добавить `http://localhost:8080` в Authorized JavaScript origins (см. Шаг 3).

## Известные нюансы

- **GIS One Tap в standalone PWA на iOS Safari** иногда не показывает
  всплывающую подсказку. Кнопка "Войти" работает всегда — это основной путь.
- **Срок жизни ID-токена ~1 час.** После истечения PWA автоматически предложит
  войти заново — токен не обновляется silent-flow'ом для GIS One Tap.
- **Кэш данных нет.** При плохой связи фронтенд ничего не покажет, кроме ошибки
  "сервер не ответил". Service Worker с офлайн-режимом — отдельная задача.
