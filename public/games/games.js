
'use strict';
// Add future games here. Each entry becomes one complete same-browser link.
// artwork contains an optional local illustration overlay; no network dependencies.
const GAMES = [
  { id: 'megatonna', title: 'МЕГАТОННА', subtitle: '3 раунда · по 1 минуте', href: '/games/bomb', image: '/games/bomb/assets/vault-background.webp?v=1.0.10', width: 1672, height: 941, alt: 'Потёртая бомба «Мегатонна» с пятью цветными проводами на верстаке убежища', artwork: 'wires' },
  { id: 'pass', title: 'ПРОВЕРКА ДОПУСКА', subtitle: 'Личность · багаж · радиация', href: '/games/pass', image: '/games/pass/assets/icon.webp?v=1.0.13', width: 1672, height: 941, alt: 'Инспектор шлюза: портрет врача и её медицинская сумка' }
];
const PLACEHOLDERS = 2;
const stage = document.getElementById('stage');
const catalog = document.getElementById('catalog');
const fullscreen = document.getElementById('fullscreen');
const notice = document.getElementById('notice');
let noticeTimer;
let page = 0;
function fitStage() {
  window.fitGameViewport();
}
function wireArtwork() {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 1672 941'); svg.setAttribute('class', 'wires'); svg.setAttribute('aria-hidden', 'true');
  const colors = ['#cf2518', '#eab722', '#1766d6', '#219346', '#e7dfca'];
  const centers = [574, 715, 856, 996, 1137];
  svg.innerHTML = '<defs>' + colors.map((color, i) => '<linearGradient gradientUnits="userSpaceOnUse" x1="' + (centers[i]-16) + '" x2="' + (centers[i]+22) + '" y1="0" y2="0" id="wire-' + i + '"><stop stop-color="#16120d"/><stop offset=".22" stop-color="' + color + '"/><stop offset=".48" stop-color="' + color + '"/><stop offset=".6" stop-color="#ffffff" stop-opacity=".6"/><stop offset=".85" stop-color="' + color + '"/><stop offset="1" stop-color="#242016"/></linearGradient>').join('') + '</defs>' + centers.map((x, i) => '<path d="M' + x + ' 412 C' + (x-20) + ' 485 ' + (x+22) + ' 542 ' + (x+10) + ' 584 S' + (x-9) + ' 626 ' + x + ' 648" stroke="url(#wire-' + i + ')" stroke-width="26" stroke-linecap="round" fill="none"/>').join('');
  return svg;
}
function renderGames() {
  catalog.replaceChildren();
  const visibleGames = GAMES.slice(page * 2, page * 2 + 2);
  visibleGames.forEach(game => {
    const link = document.createElement('a');
    link.className = 'game-tile'; link.href = game.href; link.dataset.odId = 'game-tile-' + game.id;
    link.setAttribute('aria-label', game.title + '. ' + game.subtitle + '. Играть');
    const art = document.createElement('div'); art.className = 'art'; art.style.aspectRatio = game.width + ' / ' + game.height;
    const image = document.createElement('img'); image.src = game.image; image.width = game.width; image.height = game.height; image.alt = game.alt; image.draggable = false;
    art.append(image); if (game.artwork === 'wires') art.append(wireArtwork());
    const footer = document.createElement('div'); footer.className = 'tile-footer';
    const copy = document.createElement('div');
    const title = document.createElement('h2'); title.className = 'tile-title'; title.textContent = game.title; title.dataset.odId = 'game-title-' + game.id;
    const subtitle = document.createElement('p'); subtitle.className = 'tile-subtitle'; subtitle.textContent = game.subtitle;
    const play = document.createElement('span'); play.className = 'play'; play.textContent = 'ИГРАТЬ →'; play.setAttribute('aria-hidden', 'true');
    copy.append(title, subtitle); footer.append(copy, play); link.append(art, footer); catalog.append(link);
  });
  // In this TV layout there are four slots: two tall game tiles or one tile plus two closed slots.
  const remaining = Math.max(0, Math.min(PLACEHOLDERS, 4 - visibleGames.length * 2));
  for (let i = 0; i < remaining; i++) {
    const slot = document.createElement('section'); slot.className = 'placeholder'; slot.dataset.odId = 'upcoming-slot-' + (i + 1);
    slot.setAttribute('aria-disabled', 'true'); slot.setAttribute('aria-label', 'Скоро. Недоступно');
    const seal = document.createElement('div'); seal.className = 'seal'; seal.setAttribute('aria-hidden', 'true');
    const heading = document.createElement('h2'); heading.textContent = 'СКОРО';
    const label = document.createElement('p'); label.textContent = 'ОТСЕК ЗАКРЫТ';
    slot.append(seal, heading, label); catalog.append(slot);
  }
  // Reserve equal tall columns once another game is added to the data array.
  catalog.style.gridTemplateColumns = visibleGames.length > 1 ? '820px 820px' : '1080px 560px';
  const pages = Math.ceil(GAMES.length / 2);
  document.getElementById('pager').hidden = pages <= 1;
  document.getElementById('page-number').textContent = (page + 1) + ' / ' + pages;
  document.getElementById('previous').disabled = page === 0;
  document.getElementById('next').disabled = page >= pages - 1;
}
fullscreen.addEventListener('click', async () => {
  notice.hidden = true;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (_) {
    notice.textContent = 'Полноэкранный режим недоступен в этом окне.'; notice.hidden = false;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.hidden = true; }, 5000);
  }
});
document.addEventListener('fullscreenchange', () => {
  const active = Boolean(document.fullscreenElement);
  fullscreen.textContent = active ? 'ВЫЙТИ ИЗ ЭКРАНА' : 'НА ВЕСЬ ЭКРАН';
  fullscreen.setAttribute('aria-pressed', String(active)); fitStage();
});
document.getElementById('previous').onclick = () => { if (page > 0) { page--; renderGames(); } };
document.getElementById('next').onclick = () => { if ((page + 1) * 2 < GAMES.length) { page++; renderGames(); } };
window.addEventListener('resize', fitStage);
renderGames(); fitStage();
