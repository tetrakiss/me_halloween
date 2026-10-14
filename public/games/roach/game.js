'use strict';
(() => {
  const canvas = document.getElementById('field'), ctx = canvas.getContext('2d');
  const $ = id => document.getElementById(id);
  let roaches = [], particles = [], beams = [], health = 100, elapsed = 0, score = 0, spawn = 0, running = false, last = 0, sound = true, audio;
  const aim = {x:960,y:540};
  function tone(freq, duration, type = 'sawtooth') {
    if (!sound) return;
    try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume().catch(() => {}); const o = audio.createOscillator(), g = audio.createGain(); o.type = type; o.frequency.setValueAtTime(freq,audio.currentTime); o.frequency.exponentialRampToValueAtTime(70,audio.currentTime+duration); g.gain.setValueAtTime(.055,audio.currentTime); g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration); o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+duration); } catch (_) { /* Silent play remains available. */ }
  }
  function burst(x,y,n,color,speed) { for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,v=60+Math.random()*speed;particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:.4+Math.random()*.5,color});} }
  function addRoach() {
    const a=Math.random()*Math.PI*2, x=960+Math.cos(a)*1150,y=570+Math.sin(a)*630;
    const target=Math.random()*Math.PI*2;
    roaches.push({x,y,tx:960+Math.cos(target)*160,ty:590+Math.sin(target)*110,speed:95+elapsed*2+Math.random()*28,phase:Math.random()*10,bite:0});
  }
  function hud(){ $('reserve').textContent=Math.ceil(health)+'%';$('health').style.width=health+'%';$('health').style.background=health<30?'#e18e55':'#b0d479';const seconds=Math.max(0,Math.ceil(60-elapsed));$('timer').textContent=seconds===60?'01:00':'00:'+String(seconds).padStart(2,'0');$('score').textContent=score; }
  function finish(won){running=false;$('title').textContent=won?'ПРОВИАНТ СПАСЁН!':'ВСЁ ПЕЧЕНЬЕ СЪЕДЕНО!';$('message').textContent=(won?'Минута выдержана! Осталось печенья: '+Math.ceil(health)+'%.':'Радтараканы добрались до последней крошки. Попробуем защитить новую пачку?')+' Уничтожено вредителей: '+score+'.';$('start').textContent='ЕЩЁ РАЗ · OK';$('overlay').hidden=false;$('start').focus();tone(won?600:150,.4,'triangle');}
  function start(){roaches=[];particles=[];beams=[];health=100;elapsed=0;score=0;spawn=.4;running=true;last=performance.now();$('overlay').hidden=true;tone(500,.12,'triangle');hud();}
  function shoot(){if(!running)return;tone(900,.15);beams.push({x:aim.x,y:aim.y,life:.16});let hit=-1,nearest=95;roaches.forEach((r,i)=>{const d=Math.hypot(r.x-aim.x,r.y-aim.y);if(d<nearest){nearest=d;hit=i;}});if(hit>=0){const r=roaches.splice(hit,1)[0];burst(r.x,r.y,25,'#b8f873',340);score++;hud();}}
  function pointer(e){const rect=canvas.getBoundingClientRect();aim.x=(e.clientX-rect.left)*1920/rect.width;aim.y=(e.clientY-rect.top)*1080/rect.height;}
  canvas.addEventListener('pointermove',pointer);canvas.addEventListener('pointerdown',e=>{pointer(e);shoot();});
  document.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&running){e.preventDefault();aim.x=Math.max(30,Math.min(1890,aim.x+({'ArrowLeft':-42,'ArrowRight':42}[e.key]||0)));aim.y=Math.max(175,Math.min(970,aim.y+({'ArrowUp':-42,'ArrowDown':42}[e.key]||0)));}if((e.key==='Enter'||e.key===' ')&&running){e.preventDefault();shoot();}});
  $('start').onclick=start;$('sound').onclick=()=>{sound=!sound;$('sound').textContent='ЗВУК: '+(sound?'ВКЛ':'ВЫКЛ');$('sound').setAttribute('aria-pressed',String(sound));};
  $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(_){$('notice').textContent='Полноэкранный режим недоступен в этом браузере.';}};
  document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'ВЫЙТИ ИЗ ЭКРАНА':'НА ВЕСЬ ЭКРАН';});
  function cookie(x,y,r){ctx.fillStyle='#c59650';ctx.strokeStyle='#6c4729';ctx.lineWidth=7;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();for(let i=0;i<9;i++){const a=i*2.4;ctx.fillStyle=i%2?'#6b4529':'#e5b96c';ctx.beginPath();ctx.arc(x+Math.cos(a)*r*.65,y+Math.sin(a)*r*.65,7,0,7);ctx.fill();}}
  function draw(t){
    ctx.fillStyle='#343b34';ctx.fillRect(0,0,1920,1080);
    const light=ctx.createRadialGradient(960,560,50,960,560,1100);light.addColorStop(0,'#7b7b59');light.addColorStop(1,'#1c2421');ctx.fillStyle=light;ctx.fillRect(0,0,1920,1080);
    ctx.strokeStyle='#131b1880';ctx.lineWidth=5;for(let y=210;y<1000;y+=190){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1920,y);ctx.stroke();}for(let x=65;x<1920;x+=300){for(let y=220;y<1000;y+=190){ctx.fillStyle='#101914';ctx.beginPath();ctx.arc(x,y,7,0,7);ctx.fill();}}
    ctx.save();ctx.translate(960,590);ctx.rotate(-.12);ctx.fillStyle='#111a1590';ctx.fillRect(-215,-90,450,275);
    if(health>0){cookie(-68,-72,75);cookie(37,-100,80);cookie(118,-46,70);ctx.fillStyle='#343b34';for(let i=0;i<Math.floor((100-health)/9);i++){ctx.beginPath();ctx.arc(-130+i*28,-125+(i%3)*22,22,0,7);ctx.fill();}}
    ctx.fillStyle='#b5a373';ctx.strokeStyle='#564f39';ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(-210,-35);ctx.lineTo(180,-35);ctx.lineTo(212,153);ctx.lineTo(-190,153);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle='#314d50';ctx.fillRect(-180,1,360,111);ctx.fillStyle='#e1d6a2';ctx.textAlign='center';ctx.font='bold 41px Courier New';ctx.fillText('ПЕЧЕНЬЕ',0,49);ctx.font='20px Courier New';ctx.fillText('ДОВОЕННЫЙ ЗАПАС',0,85);ctx.restore();
    roaches.forEach(r=>{const eating=Math.hypot(r.tx-r.x,r.ty-r.y)<5,a=Math.atan2(r.ty-r.y,r.tx-r.x);ctx.save();ctx.translate(r.x,r.y);ctx.rotate(a);const wiggle=Math.sin(t*22+r.phase)*(eating?5:10);ctx.strokeStyle='#2b2017';ctx.lineWidth=7;for(let side of [-1,1])for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(-25+i*23,side*20);ctx.lineTo(-35+i*24+wiggle,side*48);ctx.lineTo(-50+i*25+wiggle,side*58);ctx.stroke();}ctx.fillStyle='#4c321d';ctx.strokeStyle='#b78a43';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(-5,0,52,30,0,0,7);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(-50,0);ctx.lineTo(30,0);ctx.stroke();ctx.fillStyle='#725329';ctx.beginPath();ctx.ellipse(40,eating?Math.sin(t*35)*3:0,22,23,0,0,7);ctx.fill();ctx.fillStyle='#c4e875';for(const sy of [-1,1]){ctx.beginPath();ctx.arc(48,sy*13,6,0,7);ctx.fill();ctx.strokeStyle='#aa9c5c';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(54,sy*12);ctx.quadraticCurveTo(82,sy*26,91,sy*(37+wiggle));ctx.stroke();}ctx.restore();});
    particles.forEach(p=>{ctx.globalAlpha=Math.min(1,p.life*2);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,8,8);});ctx.globalAlpha=1;
    beams.forEach(b=>{ctx.strokeStyle='#baff77';ctx.lineWidth=b.life*65;ctx.shadowColor='#8aff43';ctx.shadowBlur=25;ctx.beginPath();ctx.moveTo(1550,1080);ctx.lineTo(b.x,b.y);ctx.stroke();});ctx.shadowBlur=0;
    if(running){const target=roaches.some(r=>Math.hypot(r.x-aim.x,r.y-aim.y)<95);ctx.strokeStyle=target?'#ffdf88':'#baff84';ctx.lineWidth=4;ctx.beginPath();ctx.arc(aim.x,aim.y,35,0,7);ctx.moveTo(aim.x-53,aim.y);ctx.lineTo(aim.x-20,aim.y);ctx.moveTo(aim.x+20,aim.y);ctx.lineTo(aim.x+53,aim.y);ctx.moveTo(aim.x,aim.y-53);ctx.lineTo(aim.x,aim.y-20);ctx.moveTo(aim.x,aim.y+20);ctx.lineTo(aim.x,aim.y+53);ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.fillRect(aim.x-3,aim.y-3,6,6);}
  }
  function frame(now){const dt=Math.max(0,(now-last)/1000);last=now;if(running){elapsed=Math.min(60,elapsed+dt);const step=Math.min(dt,.05);spawn-=step;if(spawn<=0){if(roaches.length<3+Math.floor(elapsed/7))addRoach();spawn=Math.max(.38,1.8-elapsed*.025);}roaches.forEach(r=>{const dx=r.tx-r.x,dy=r.ty-r.y,d=Math.hypot(dx,dy);if(d>4){const move=Math.min(d,r.speed*step);r.x+=dx/d*move;r.y+=dy/d*move;}else{health=Math.max(0,health-step*2.5);r.bite-=step;if(r.bite<=0){burst(r.x,r.y,7,'#e6ba73',240);r.bite=.17;}}});particles.forEach(p=>{p.x+=p.vx*step;p.y+=p.vy*step;p.vy+=180*step;p.life-=step;});particles=particles.filter(p=>p.life>0);beams.forEach(b=>b.life-=step);beams=beams.filter(b=>b.life>0);hud();if(health<=0)finish(false);else if(elapsed>=60)finish(true);}draw(now/1000);requestAnimationFrame(frame);}
  $('start').focus();requestAnimationFrame(frame);
})();
