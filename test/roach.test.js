'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function game() {
  const nodes = new Map(); let frame, now = 0;
  const context = new Proxy({}, {get: (_, key) => key === 'createRadialGradient' ? () => ({addColorStop(){}}) : () => {}});
  const get = id => {if(!nodes.has(id))nodes.set(id,{style:{},hidden:false,textContent:'',events:{},focus(){},setAttribute(){},addEventListener(name,cb){this.events[name]=cb;},getContext(){return context;},getBoundingClientRect(){return {left:0,top:0,width:1920,height:1080};}});return nodes.get(id);};
  vm.runInNewContext(fs.readFileSync('public/games/roach/game.js','utf8'),{document:{getElementById:get,addEventListener(){}},window:{},performance:{now:()=>now},requestAnimationFrame:cb=>{frame=cb;},Math:Object.assign(Object.create(Math),{random:()=>.5})});
  return {get,advance(seconds,shoot=false){for(let i=0;i<seconds*20;i++){now+=50;frame(now);if(shoot)get('field').events.pointerdown({clientX:800,clientY:590});}}};
}
test('roach feeding exhausts the cookie supply and replay resets the round',()=>{
  const g=game();g.get('start').onclick();g.advance(60);
  assert.equal(g.get('title').textContent,'ВСЁ ПЕЧЕНЬЕ СЪЕДЕНО!');assert.equal(g.get('reserve').textContent,'0%');assert.equal(g.get('overlay').hidden,false);
  g.get('start').onclick();assert.equal(g.get('reserve').textContent,'100%');assert.equal(g.get('timer').textContent,'01:00');assert.equal(g.get('score').textContent,0);assert.equal(g.get('overlay').hidden,true);
});
test('laser hits remove approaching roaches and one minute ends with saved cookies',()=>{
  const g=game();g.get('start').onclick();g.advance(61,true);
  assert.equal(g.get('title').textContent,'ПРОВИАНТ СПАСЁН!');assert.equal(g.get('timer').textContent,'00:00');assert.ok(g.get('score').textContent>0);assert.equal(g.get('overlay').hidden,false);
});
