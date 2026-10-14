'use strict';
(() => {
  const canvas = document.getElementById('field'), ctx = canvas.getContext('2d');
  const $ = id => document.getElementById(id);
  let roaches = [], particles = [], beams = [], health = 100, elapsed = 0, score = 0, spawn = 0, running = false, last = 0, sound = true, audio;
  const aim = {x:960,y:540};
  const tracks = [1, 2, 3].map(n => '/games/bomb/assets/audio/radio-' + n + '.mp3?v=1.0.20');
  const music = $('radio');
  let trackIndex = 0, musicEnabled = true, musicStarted = false;
  music.volume = .2;
  function playMusic() {
    if (!musicEnabled || !musicStarted) return;
    const playing = music.play();
    if (playing && playing.catch) playing.catch(() => {
      $('notice').textContent = 'Музыка недоступна. Нажмите «Музыка», чтобы повторить.';
    });
  }
  function selectTrack(index) {
    trackIndex = index % tracks.length;
    music.src = tracks[trackIndex];
    $('track').textContent = 'ТРЕК: ' + (trackIndex + 1) + ' / 3 →';
    playMusic();
  }
  music.addEventListener('ended', () => selectTrack(trackIndex + 1));
  $('track').onclick = () => { musicStarted = true; selectTrack(trackIndex + 1); };
  $('music').onclick = () => {
    musicEnabled = !musicEnabled; musicStarted = true;
    $('music').textContent = 'МУЗЫКА: ' + (musicEnabled ? 'ВКЛ' : 'ВЫКЛ');
    $('music').setAttribute('aria-pressed', String(musicEnabled));
    if (musicEnabled) playMusic(); else music.pause();
  };
  selectTrack(0);
  const assets = {};
  const assetNames = ['table', 'packet', 'walk', 'laser'];
  const ready = Promise.all(assetNames.map(name => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { assets[name] = img; resolve(); };
    img.onerror = () => reject(new Error(name));
    img.src = '/games/roach/assets/' + name + '.png?v=1.0.20';
  })));
  let loaded = false;
  $('start').disabled = true;
  ready.then(() => { loaded = true; $('start').disabled = false; $('start').focus(); })
    .catch(() => { $('notice').textContent = 'Не удалось загрузить графику. Обновите страницу.'; });
  function sprite(image, frame, x, y, size) {
    const cellW = image.naturalWidth / 4, cellH = image.naturalHeight / 2;
    ctx.drawImage(image, (frame % 4) * cellW, Math.floor(frame / 4) * cellH,
      cellW, cellH, x - size / 2, y - size / 2, size, size);
  }
  function tone(freq, duration, type = 'sawtooth') {
    if (!sound) return;
    try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume().catch(() => {}); const o = audio.createOscillator(), g = audio.createGain(); o.type = type; o.frequency.setValueAtTime(freq,audio.currentTime); o.frequency.exponentialRampToValueAtTime(70,audio.currentTime+duration); g.gain.setValueAtTime(.055,audio.currentTime); g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration); o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+duration); } catch (_) { /* Silent play remains available. */ }
  }
  function burst(x,y,n,color,speed) { for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,v=60+Math.random()*speed;particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:.4+Math.random()*.5,color});} }
  function addRoach() {
    const a=Math.random()*Math.PI*2, x=960+Math.cos(a)*1150,y=570+Math.sin(a)*630;
    const target=Math.random()*Math.PI*2;
    roaches.push({x,y,tx:1180+Math.cos(target)*75,ty:590+Math.sin(target)*70,speed:95+elapsed*2+Math.random()*28,phase:Math.random()*8,bite:0,angle:0});
  }
  function hud(){ $('reserve').textContent=Math.ceil(health)+'%';$('health').style.width=health+'%';$('health').style.background=health<30?'#e18e55':'#b0d479';const seconds=Math.max(0,Math.ceil(60-elapsed));$('timer').textContent=seconds===60?'01:00':'00:'+String(seconds).padStart(2,'0');$('score').textContent=score; }
  function finish(won){running=false;$('title').hidden=false;$('overlay').classList.add('result');$('title').textContent=won?'ПРОВИАНТ СПАСЁН!':'ВСЁ ПЕЧЕНЬЕ СЪЕДЕНО!';$('message').textContent=(won?'Минута выдержана! Осталось печенья: '+Math.ceil(health)+'%.':'Радтараканы добрались до последней крошки. Попробуем защитить новую пачку?')+' Уничтожено вредителей: '+score+'.';$('start').textContent='ЕЩЁ РАЗ · OK';$('overlay').hidden=false;$('start').focus();tone(won?600:150,.4,'triangle');}
  function start(){if(!loaded)return;musicStarted=true;playMusic();$('title').hidden=true;$('overlay').classList.remove('result');roaches=[];particles=[];beams=[];health=100;elapsed=0;score=0;spawn=.4;running=true;last=performance.now();$('overlay').hidden=true;tone(500,.12,'triangle');hud();}
  function shoot(){if(!running)return;tone(900,.15);beams.push({x:aim.x,y:aim.y,life:.32});let hit=-1,nearest=95;roaches.forEach((r,i)=>{const d=Math.hypot(r.x-aim.x,r.y-aim.y);if(d<nearest){nearest=d;hit=i;}});if(hit>=0){const r=roaches.splice(hit,1)[0];burst(r.x,r.y,25,'#b8f873',340);score++;hud();}}
  function pointer(e){const rect=canvas.getBoundingClientRect();aim.x=(e.clientX-rect.left)*1920/rect.width;aim.y=(e.clientY-rect.top)*1080/rect.height;}
  canvas.addEventListener('pointermove',pointer);canvas.addEventListener('pointerdown',e=>{pointer(e);shoot();});
  document.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&running){e.preventDefault();aim.x=Math.max(30,Math.min(1890,aim.x+({'ArrowLeft':-42,'ArrowRight':42}[e.key]||0)));aim.y=Math.max(175,Math.min(970,aim.y+({'ArrowUp':-42,'ArrowDown':42}[e.key]||0)));}if((e.key==='Enter'||e.key===' ')&&running){e.preventDefault();shoot();}});
  $('start').onclick=start;$('sound').onclick=()=>{sound=!sound;$('sound').textContent='ЗВУК: '+(sound?'ВКЛ':'ВЫКЛ');$('sound').setAttribute('aria-pressed',String(sound));};
  $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(_){$('notice').textContent='Полноэкранный режим недоступен в этом браузере.';}};
  document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'ВЫЙТИ ИЗ ЭКРАНА':'НА ВЕСЬ ЭКРАН';});
  function draw(t){
    ctx.fillStyle = '#718e82';
    ctx.fillRect(0, 0, 1920, 1080);
    if (assets.table) ctx.drawImage(assets.table, 0, 0, 1920, 1080);
    if (assets.packet) {
      // Keep the wrapper fixed while the exposed biscuits disappear into it.
      const img = assets.packet, split = img.naturalWidth * .705;
      const x = 640, y = 420, width = 640, height = 320;
      // Upper-left light casts a soft, warm contact shadow down and right.
      // Canvas uses the sprite alpha, so the shadow follows each biscuit.
      ctx.save();
      ctx.shadowColor = 'rgba(30, 28, 17, 0.64)';
      ctx.shadowBlur = 19;
      ctx.shadowOffsetX = 9;
      ctx.shadowOffsetY = 14;
      ctx.drawImage(img, 0, 0, split, img.naturalHeight, x, y, width * .705, height);
      if (health > 0) ctx.drawImage(img, split, 0, img.naturalWidth - split, img.naturalHeight,
        x + width * .705, y, width * .295 * health / 100, height);
      ctx.restore();
    }
    roaches.forEach(r => {
      if (!assets.walk) return;
      const eating = Math.hypot(r.tx-r.x, r.ty-r.y) < 5;
      const frame = Math.floor(t * (eating ? 5 : 15) + r.phase) % 8;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.angle);
      // Tiny feeding bob; the walk cycle is painted in the sprite atlas.
      if (eating) ctx.translate(Math.sin(t * 26 + r.phase) * 3, 0);
      ctx.shadowColor = '#17292188'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 5;
      sprite(assets.walk, frame, 0, 0, 175);
      ctx.restore();
    });
    particles.forEach(p => {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color; ctx.save(); ctx.translate(p.x,p.y);
      ctx.rotate(p.life*7); ctx.fillRect(-4,-3,8,6); ctx.restore();
    });
    ctx.globalAlpha = 1;
    beams.forEach(b => {
      const age = .32 - b.life;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // A white-hot core, coloured halo and brief pulse create the beam.
      if (age < .10) {
        const fade = 1 - age / .10;
        ctx.globalAlpha = fade;
        ctx.shadowColor = '#83ff34'; ctx.shadowBlur = 30;
        const gradient = ctx.createLinearGradient(1550, 1080, b.x, b.y);
        gradient.addColorStop(0, '#58c52a'); gradient.addColorStop(1, '#caff8b');
        ctx.strokeStyle = gradient; ctx.lineWidth = 13;
        ctx.beginPath(); ctx.moveTo(1550,1080); ctx.lineTo(b.x,b.y); ctx.stroke();
        ctx.shadowBlur = 12; ctx.strokeStyle = '#f8ffe6'; ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      if (assets.laser) sprite(assets.laser, Math.min(7, Math.floor(age / .04)), b.x, b.y, 190);
      ctx.restore();
    });
    if(running){const target=roaches.some(r=>Math.hypot(r.x-aim.x,r.y-aim.y)<95);ctx.strokeStyle=target?'#ffdf88':'#baff84';ctx.lineWidth=4;ctx.beginPath();ctx.arc(aim.x,aim.y,35,0,7);ctx.moveTo(aim.x-53,aim.y);ctx.lineTo(aim.x-20,aim.y);ctx.moveTo(aim.x+20,aim.y);ctx.lineTo(aim.x+53,aim.y);ctx.moveTo(aim.x,aim.y-53);ctx.lineTo(aim.x,aim.y-20);ctx.moveTo(aim.x,aim.y+20);ctx.lineTo(aim.x,aim.y+53);ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.fillRect(aim.x-3,aim.y-3,6,6);}
  }
  function frame(now){const dt=Math.max(0,(now-last)/1000);last=now;if(running){elapsed=Math.min(60,elapsed+dt);const step=Math.min(dt,.05);spawn-=step;if(spawn<=0){if(roaches.length<3+Math.floor(elapsed/7))addRoach();spawn=Math.max(.38,1.8-elapsed*.025);}roaches.forEach(r=>{const dx=r.tx-r.x,dy=r.ty-r.y,d=Math.hypot(dx,dy);if(d>4){r.angle=Math.atan2(dy,dx);const move=Math.min(d,r.speed*step);r.x+=dx/d*move;r.y+=dy/d*move;}else{health=Math.max(0,health-step*2.5);r.bite-=step;if(r.bite<=0){burst(r.x+Math.cos(r.angle)*55,r.y+Math.sin(r.angle)*55,7,'#e6ba73',240);r.bite=.17;}}});particles.forEach(p=>{p.x+=p.vx*step;p.y+=p.vy*step;p.vy+=180*step;p.life-=step;});particles=particles.filter(p=>p.life>0);beams.forEach(b=>b.life-=step);beams=beams.filter(b=>b.life>0);hud();if(health<=0)finish(false);else if(elapsed>=60)finish(true);}draw(now/1000);requestAnimationFrame(frame);}
  $('start').focus();requestAnimationFrame(frame);
})();
