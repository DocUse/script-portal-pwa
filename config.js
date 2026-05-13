// Конфиг PWA-кабинета "Скрипты обучения".
//
// ВАЖНО:
//   1. apiUrl нужно заменить на URL ВТОРОГО deployment'а Apps Script
//      (того, что развёрнут как Web app с Who has access: Anyone).
//      После создания deployment'а вставить сюда полный /exec URL.
//
//   2. oauthClientId — публичный идентификатор OAuth Web client из Google Cloud.
//      Сейчас здесь дефолтный из проекта "Web client 1". Менять только если
//      заводится новый OAuth-клиент.
//
//   3. enableDebugOverlay — включает жёлтый блок с диагностикой viewport
//      в правом верхнем углу. Нужен для проверки, что PWA рендерится в реальном
//      393px viewport iPhone, а не в 980px iframe. Выключить после проверки.
window.SCRIPT_PORTAL_CONFIG = {
  apiUrl: 'PASTE_NEW_APPS_SCRIPT_EXEC_URL_HERE',
  oauthClientId: '435134581493-qkqpf78e7oh4e7th1e1rpd7qe9hpv7f3.apps.googleusercontent.com',
  enableDebugOverlay: true,
};
