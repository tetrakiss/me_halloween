(function () {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const value = (name) => search.get(name) || hash.get(name) || '';
  const maxInitData = value('WebAppData');
  const telegramInitData = value('tgWebAppData');

  let platform = 'web';
  if (maxInitData || value('WebAppPlatform') || value('WebAppVersion')) platform = 'max';
  else if (telegramInitData || value('tgWebAppPlatform') || value('tgWebAppVersion')) platform = 'telegram';

  window.MINI_APP_CONTEXT = {
    platform,
    initData: platform === 'max' ? maxInitData : platform === 'telegram' ? telegramInitData : '',
  };

  if (platform === 'web') return;

  const script = document.createElement('script');
  script.async = true;
  script.src = platform === 'max'
    ? 'https://st.max.ru/js/max-web-app.js'
    : 'https://telegram.org/js/telegram-web-app.js';
  script.onload = () => {
    if (platform === 'telegram' && window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    }
  };
  document.head.appendChild(script);
})();
