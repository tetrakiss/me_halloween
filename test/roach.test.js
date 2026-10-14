'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
async function game() {
  const nodes = new Map(); let frame, now = 0;
  const context = new Proxy({}, {get: (_, key) => (key === 'createRadialGradient' || key === 'createLinearGradient') ? () => ({addColorStop(){}}) : () => {}});
  const get = id => {if(!nodes.has(id))nodes.set(id,{style:{},hidden:false,textContent:'',events:{},classList:{add(){},remove(){}},play(){return Promise.resolve();},pause(){},focus(){},setAttribute(){},addEventListener(name,cb){this.events[name]=cb;},getContext(){return context;},getBoundingClientRect(){return {left:0,top:0,width:1920,height:1080};}});return nodes.get(id);};
  vm.runInNewContext(fs.readFileSync('public/games/roach/game.js','utf8'),{document:{getElementById:get,addEventListener(){}},Image:class {constructor(){this.naturalWidth=1774;this.naturalHeight=887;}set src(value){this.onload();}},window:{},performance:{now:()=>now},requestAnimationFrame:cb=>{frame=cb;},Math:Object.assign(Object.create(Math),{random:()=>.5})});
  await new Promise(resolve => setImmediate(resolve));
  return {get,advance(seconds,shoot=false){for(let i=0;i<seconds*20;i++){now+=50;frame(now);if(shoot)get('field').events.pointerdown({clientX:1180,clientY:590});}}};
}
test('roach feeding exhausts the cookie supply and replay resets the round',async()=>{
  const g=await game();g.get('start').onclick();g.advance(60);
  assert.equal(g.get('title').textContent,'ВСЁ ПЕЧЕНЬЕ СЪЕДЕНО!');assert.equal(g.get('reserve').textContent,'0%');assert.equal(g.get('overlay').hidden,false);
  g.get('start').onclick();assert.equal(g.get('reserve').textContent,'100%');assert.equal(g.get('timer').textContent,'01:00');assert.equal(g.get('score').textContent,0);assert.equal(g.get('overlay').hidden,true);
});
test('laser hits remove approaching roaches and one minute ends with saved cookies',async()=>{
  const g=await game();g.get('start').onclick();g.advance(61,true);
  assert.equal(g.get('title').textContent,'ПРОВИАНТ СПАСЁН!');assert.equal(g.get('timer').textContent,'00:00');assert.ok(g.get('score').textContent>0);assert.equal(g.get('overlay').hidden,false);
});

test('music cycles through three tracks and both audio toggles work independently',async()=>{
  const g=await game();
  assert.match(g.get('radio').src,/radio-1/);
  g.get('track').onclick();assert.match(g.get('radio').src,/radio-2/);
  g.get('radio').events.ended();assert.match(g.get('radio').src,/radio-3/);
  g.get('radio').events.ended();assert.match(g.get('radio').src,/radio-1/);
  g.get('music').onclick();assert.equal(g.get('music').textContent,'МУЗЫКА: ВЫКЛ');
  g.get('sound').onclick();assert.equal(g.get('sound').textContent,'ЗВУК: ВЫКЛ');
  assert.equal(g.get('music').textContent,'МУЗЫКА: ВЫКЛ');
});
