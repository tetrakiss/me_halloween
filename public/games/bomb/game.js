
'use strict';
const COLORS=['красный','жёлтый','синий','зелёный','белый'];
const WIRES = ['red', 'yellow', 'blue', 'green', 'white'];
const $ = id => document.getElementById(id);
const STORAGE_KEY = 'megatonna-round';
function initialRound(set = 1) {
  return { set, stage:1, maxClues:3, maxMistakes:3, status: 'ready', remaining: 60000, cut: [], opened: [], mistakes: 0, reward: 0, reason: null, clues: [] };
}
class ServerRoundService {
  constructor() { this.state = initialRound(); this.busy = false; }
  async request(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const started = performance.now();
    try {
      const response = await fetch('/game-api' + path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store', signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.error || 'NETWORK');
        error.code = data.error;
        throw error;
      }
      this.state = { ...data, remaining: data.remainingMs,
        cut: data.cut.map(color => WIRES.indexOf(color)) };
      if (data.status === 'running') this.state.remaining = Math.max(0,
        this.state.remaining - Math.max(0, performance.now() - started) / 2);
      last = performance.now();
      try { sessionStorage.setItem(STORAGE_KEY, data.id); } catch (_) { /* Storage optional on TV. */ }
      return this.state;
    } finally { clearTimeout(timeout); }
  }
  async dispatch(action) {
    if (action.type === 'RESET') {
      this.state = initialRound();
      try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) {}
      return this.state;
    }
    if (action.type === 'START') return this.request('/rounds', { previousId: this.state.id });
    if (action.type === 'REFRESH') return this.request('/rounds/' + this.state.id);
    return this.request('/rounds/' + this.state.id + '/actions', {
      action: action.type.toLowerCase(),
      value: action.type === 'CUT' ? WIRES[action.id] : action.id,
      confirmed: action.type === 'OPEN' ? action.confirmed === true : undefined
    });
  }
}
const service = new ServerRoundService();
let view = 'bomb', pending = null, last = performance.now(), animationLock = false, toastTask;
let networkFailed = false, lastAction = null;
function syncClock() {
  const now = performance.now();
  if (service.state.status === 'running') service.state.remaining = Math.max(0, service.state.remaining - (now - last));
  last = now;
}
function networkError(error) {
  if (error.code === 'ROUND_NOT_FOUND') {
    service.state = initialRound();
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) {}
    showToast('Раунд сброшен после перезапуска сервера. Начните новый.');
    return;
  }
  networkFailed = true;
  $('network').hidden = false;
  $('networkMessage').textContent = 'Не удалось связаться с сервером. Проверьте соединение. Таймер на сервере продолжает идти.';
}
async function send(action, { silent = false } = {}) {
  if (service.busy) return false;
  syncClock();
  const oldStatus = service.state.status;
  service.busy = true;
  if (!silent) lastAction = action;
  render();
  try {
    await service.dispatch(action);
    networkFailed = false;
    $('network').hidden = true;
    if (action.type === 'RESET') { view = 'bomb'; pending = null; }
    if (!['won', 'lost'].includes(oldStatus) && ['won', 'lost'].includes(service.state.status)) finish();
    if (!silent && view === 'files') folders();
    return true;
  } catch (error) {
    networkError(error);
    return false;
  } finally {
    service.busy = false;
    render();
  }
}
function setView(v){if(service.state.status!=='running')return;view=v;if(v==='files')folders();render();}
function fit(){window.fitGameViewport();}window.addEventListener('resize',fit);fit();
const wireColors = ['#c82717','#e7b021','#1768d2','#239246','#e9ddbd'];
// Coordinates are measured against the fixed 1920 × 1080 background plate.
const WIRE_TOP = 467;
const WIRE_LEFT = [605, 767, 928, 1087, 1249];
const CUT_POINT = { x: 61, y: 152 };
function sparkBurst(index) {
  const burst = document.createElement('div');
  burst.className = 'electric-sparks';
  burst.setAttribute('aria-hidden', 'true');
  burst.style.left = (WIRE_LEFT[index] + CUT_POINT.x) + 'px';
  burst.style.top = (WIRE_TOP + CUT_POINT.y) + 'px';
  for (let n = 0; n < 10; n++) {
    const particle = document.createElement('i');
    const angle = n * Math.PI * 2 / 10;
    particle.style.setProperty('--dx', Math.cos(angle) * (65 + n % 3 * 18) + 'px');
    particle.style.setProperty('--dy', Math.sin(angle) * (65 + n % 3 * 18) + 'px');
    particle.style.setProperty('--delay', n % 3 * 30 + 'ms');
    burst.append(particle);
  }
  $('stage').append(burst);
  setTimeout(() => burst.remove(), 850);
}
for (let i = 0; i < 5; i++) {
  const b = document.createElement('button');
  b.className = 'wire';
  b.style.left = WIRE_LEFT[i] + 'px';
  b.setAttribute('aria-label', 'Перерезать ' + COLORS[i] + ' провод');
  b.dataset.odId = 'wire-' + WIRES[i];
  const path = 'M56 16 C50 55 41 85 55 124 C69 163 74 214 56 279';
  const cable = (d) => `<path d="${d}" stroke="#120c08" stroke-width="34" opacity=".7" transform="translate(3 3)"/><path d="${d}" stroke="#281b12" stroke-width="29"/><path d="${d}" stroke="${wireColors[i]}" stroke-width="28"/><path d="${d}" stroke="#ffffff" stroke-width="8" opacity=".38" filter="url(#tube-soft-${i})" transform="translate(-5 0)"/><path d="${d}" stroke="#000000" stroke-width="7" opacity=".32" filter="url(#tube-soft-${i})" transform="translate(7 0)"/>`;
  b.innerHTML = `<svg viewBox="0 0 112 300" aria-hidden="true"><defs><filter id="tube-soft-${i}" x="-100%" y="-10%" width="300%" height="120%"><feGaussianBlur stdDeviation="2.2"/></filter><clipPath id="socket-clip-${i}"><rect x="0" y="16" width="112" height="263"/></clipPath></defs><g clip-path="url(#socket-clip-${i})" fill="none" stroke-linecap="round"><g class="whole">${cable(path)}</g><g class="pieces"><g class="upper">${cable('M56 16 C50 55 41 85 55 124 C57 129 59 134 60 138')}<path stroke="#bc884e" stroke-width="3" d="M60 138 l-5 13 m5-13 l5 14 m-5-14 l9 8"/></g><g class="lower">${cable('M66 168 C73 207 73 228 56 279')}<path stroke="#bc884e" stroke-width="3" d="M66 168 l-9 -12 m9 12 l4 -14 m-4 14 l10 -9"/></g></g></g><g fill="none" stroke-linecap="round"><path d="M35 17 Q56 31 77 17" stroke="#1b1009" stroke-width="6"/><path d="M36 16 Q56 27 76 16" stroke="#b58e59" stroke-width="2.5"/><path d="M35 280 Q56 294 77 280" stroke="#1b1009" stroke-width="6"/><path d="M36 279 Q56 289 76 279" stroke="#d2ae75" stroke-width="2.5"/></g></svg>`;
  b.onclick = async () => {
    if (service.state.status !== 'running' || view !== 'bomb' || animationLock || service.busy || networkFailed) return;
    animationLock = true;
    $('cursor').classList.add('closed');
    const previousMistakes = service.state.mistakes;
    const ok = await send({ type: 'CUT', id: i });
    if (ok && service.state.mistakes > previousMistakes) {
      sparkBurst(i);
      window.bombSound.playSpark();
    }
    if (ok && service.state.status === 'running') showToast('Неверная цепь. Ошибок: ' + service.state.mistakes + ' / ' + service.state.maxMistakes);
    setTimeout(() => { animationLock = false; $('cursor').classList.remove('closed'); }, 300);
  };
  b.onpointerenter = () => { if (service.state.status === 'running' && view === 'bomb' && !b.disabled) $('cursor').style.display = 'block'; };
  b.onpointerleave = () => { $('cursor').style.display = 'none'; };
  $('wires').append(b);
}
$('stage').addEventListener('pointermove',e=>{const r=$('stage').getBoundingClientRect(),scale=r.width/1920;$('cursor').style.left=((e.clientX-r.left)/scale-43)+'px';$('cursor').style.top=((e.clientY-r.top)/scale-35)+'px';});
function showToast(t){$('toast').textContent=t;$('toast').hidden=false;clearTimeout(toastTask);toastTask=setTimeout(()=>{$('toast').hidden=true;},1800);}
function folders(){const s=service.state;$('folders').innerHTML='';for(let i=0;i<5;i++){const b=document.createElement('button');b.className='folder';b.dataset.odId='dossier-folder-'+(i+1);const open=s.opened.includes(i);const blocked=!open&&s.opened.length>=s.maxClues;b.innerHTML='<span class="number">0'+(i+1)+'</span><span class="status">'+(open?'ОТКРЫТО · БЕСПЛАТНО':blocked?'ЛИМИТ ИСЧЕРПАН':'СЕКРЕТНО')+'</span>';b.setAttribute('aria-label','Досье '+(i+1)+(open?', просмотр бесплатно':''));b.disabled=blocked;b.classList.toggle('locked',blocked);b.onclick=()=>requestOpen(i);$('folders').append(b);}$('costs').textContent='Открыто: '+s.opened.length+' / '+s.maxClues+'  ·  '+(s.opened.length===0?'Первая папка бесплатно':'Повторный просмотр бесплатно')+'\n'+['Одна подсказка бесплатно','Первая бесплатно · вторая −20 секунд','Первая бесплатно · вторая −20 · третья −30 секунд'][s.maxClues-1];$('costs').style.whiteSpace='pre-line';}
function requestOpen(id){syncClock();if(service.state.status!=='running'||service.busy||networkFailed)return;const s=service.state;if(!s.opened.includes(id)&&s.opened.length>=s.maxClues)return;pending=id;if(s.opened.includes(id)||s.opened.length===0){openPending();return;}const cost=s.nextClueCost;$('confirmTitle').textContent='ОТКРЫТЬ ДОСЬЕ 0'+(id+1)+'?';$('confirmText').textContent='Цена: '+cost+' секунд. Время будет списано сразу. Отсчёт продолжается.';view='confirm';render();}
async function openPending(){const id=pending;if(id===null||service.state.status!=='running')return;const ok=await send({type:'OPEN',id,confirmed:view==='confirm'});if(!ok)return;pending=null;if(service.state.status!=='running')return;$('fileId').textContent='ДОСЬЕ 0'+(id+1)+' · НАБОР '+service.state.set;$('clueText').textContent=service.state.clues.find(clue=>clue.index===id).text;setView('clue');}
function render(){const s=service.state;const sec=s.status==='lost'?0:Math.ceil(s.remaining/1000);$('timer').textContent=String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');$('errors').textContent=s.mistakes+' / '+s.maxMistakes;$('roundProgress').textContent='РАУНД '+s.stage+' / 3';$('start').hidden=s.status!=='ready';$('bottom').hidden=s.status!=='running'||view!=='bomb';$('files').hidden=!(s.status==='running'&&view==='files');$('clue').hidden=!(s.status==='running'&&view==='clue');$('confirm').hidden=!(s.status==='running'&&view==='confirm');$('paused').hidden=s.status!=='paused';$('won').hidden=s.status!=='won';$('lost').hidden=s.status!=='lost';$('scene').classList.toggle('loss',s.status==='lost');$('scene').classList.toggle('victory',s.status==='won');$('wires').hidden=s.status==='lost';Array.from($('wires').children).forEach((b,i)=>{b.classList.toggle('cut',s.cut.includes(i));b.disabled=service.busy||networkFailed||s.status!=='running'||view!=='bomb'||s.cut.includes(i);});if(s.status!=='running'||view!=='bomb')$('cursor').style.display='none';['begin','accept','pause','resume','retry'].forEach(id=>$(id).disabled=service.busy);document.querySelectorAll('.new').forEach(button=>button.disabled=service.busy);document.querySelectorAll('.folder').forEach(button=>button.disabled=service.busy||button.classList.contains('locked'));}
function finish(){const s=service.state;pending=null;$('toast').hidden=true;clearTimeout(toastTask);view='bomb';if(s.status==='won'){$('reward').textContent='+'+s.reward+' '+(s.reward===1?'КРЫШКА':'КРЫШКИ');$('winStats').textContent=(s.seriesComplete?'ВСЕ ТРИ РАУНДА ПРОЙДЕНЫ! · ':'Раунд '+s.stage+' / 3 · ')+'Ошибок: '+s.mistakes;document.querySelector('#won .new').textContent=s.seriesComplete?'НОВАЯ СЕРИЯ':'СЛЕДУЮЩИЙ РАУНД';}else{$('lossReason').textContent=s.reason==='time'?'Время вышло.':'Лимит ошибок исчерпан: '+s.mistakes+' / '+s.maxMistakes+'.';const flash=document.createElement('div');flash.className='flash';$('stage').append(flash);$('stage').classList.add('shake');setTimeout(()=>{flash.remove();$('stage').classList.remove('shake');},1150);}render();}
$('begin').onclick=()=>{view='bomb';pending=null;send({type:'START'});};$('dossier').onclick=()=>setView('files');$('backBomb').onclick=$('clueBomb').onclick=()=>setView('bomb');$('backFiles').onclick=()=>setView('files');$('accept').onclick=openPending;$('cancel').onclick=()=>{pending=null;setView('files');};$('pause').onclick=()=>send({type:'PAUSE'});$('resume').onclick=()=>send({type:'RESUME'});document.querySelectorAll('.new').forEach(b=>b.onclick=()=>{view='bomb';pending=null;send({type:'START'});});$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement){await document.exitFullscreen();}else{await document.documentElement.requestFullscreen();}}catch{showToast('Полноэкранный режим недоступен в этом окне.');}};document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'ВЫЙТИ ИЗ ПОЛНОГО ЭКРАНА':'НА ВЕСЬ ЭКРАН';fit();});setInterval(()=>{syncClock();render();},100);document.addEventListener('visibilitychange',()=>{syncClock();render();});render();

$('retry').onclick = async () => {
  const action = service.state.id ? { type: 'REFRESH' } : (lastAction || { type: 'RESET' });
  if (await send(action)) {
    networkFailed = false;
    $('network').hidden = true;
    // A failed action may have reached the server. Refresh first; never blindly charge twice.
    pending = null;
    if (service.state.status === 'running') setView('bomb');
  }
};
$('networkReset').onclick = () => { networkFailed = false; $('network').hidden = true; send({ type: 'RESET' }); };
setInterval(() => {
  if (service.state.id && service.state.status === 'running' && !service.busy && !networkFailed) send({ type: 'REFRESH' }, { silent: true });
}, 2000);
async function restoreRound() {
  let id;
  try { id = sessionStorage.getItem(STORAGE_KEY); } catch (_) {}
  if (!id) return;
  service.state.id = id;
  await send({ type: 'REFRESH' });
}
restoreRound();
