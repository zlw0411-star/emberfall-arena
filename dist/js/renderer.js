import {rngFromSeed} from './world.js';
import {drawMeleeVisuals,drawMeleeImpact} from './melee-vfx.js';
import {drawSkillEffect,drawBladeWard} from './skill-vfx.js';
import {drawBossTelegraph,drawBossBody,drawBossGuard} from './boss-renderer.js';
import {weaponTypeOf} from './modes.js';
import {terrainBiome,bakeBiome,drawBiomeObstacle,drawBiomeSpike,drawBiomeAmbient} from './terrain.js';

// 武器姿态表：键名由 MODES[mode].weaponType 指定。
// 以前是 `pose?.weaponType==='sword'` / `a.weaponType==='sword'` 两处硬编码。
const SWORD = weaponTypeOf('melee');
const POSE_DRAWERS = {
  [SWORD]: (c, actor, t, timeOffset, flash) => {
    const swordAngle = drawMeleeVisuals(c, actor, t + timeOffset, { timeOffset });
    drawHero(c, actor.x, actor.y, actor.color, t, actor.moving, 1, flash,
      { weaponType: SWORD, aimAngle: swordAngle, attackRange: actor.attackRange });
  },
};

const palette={ground:'#293c30',grass:'#354a32',stone:'#616b50',dark:'#172a22',gold:'#e6bd79'};
function rect(c,color,x,y,w,h){c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),w,h);}
function ellipse(c,color,x,y,rx,ry){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill();}
export function drawHero(c,x,y,color,time=0,moving=false,scale=1,flash=false,pose=null){
 c.save();c.translate(Math.round(x),Math.round(y));c.scale(scale,scale);const b=moving?Math.round(Math.sin(time*11)*1.5):0;
 ellipse(c,'#0c1b1890',0,7,12,5);c.translate(0,b);
 rect(c,'#172721',-8,-12,16,17);rect(c,'#27392c',-11,-8,5,15);rect(c,'#27392c',7,-8,5,15);
 rect(c,flash?'#fff7cb':color,-8,-15,16,7);rect(c,flash?'#fff7cb':color,-10,-11,5,10);rect(c,flash?'#fff7cb':color,6,-11,4,10);
 rect(c,'#d6be8e',-5,-8,10,7);rect(c,'#252b25',-4,-7,2,2);rect(c,'#252b25',3,-7,2,2);
 rect(c,'#37422b',-6,-1,12,10);rect(c,color,-8,0,4,10);rect(c,color,5,0,4,10);rect(c,'#aa9564',-5,4,10,2);
 const leg=moving?Math.round(Math.sin(time*11)*2):0;rect(c,'#192c24',-6,8,5,5+leg);rect(c,'#192c24',2,8,5,5-leg);
 if(pose?.weaponType===SWORD)drawSword(c,0,0,pose.aimAngle||0,pose.attackRange||68,flash);
 else {rect(c,'#dacaa0',11,-5,3,14);rect(c,'#7c6748',10,8,5,3);rect(c,'#bbc6a1',11,-9,3,7);}
 c.restore();
}
function drawSword(c,x,y,angle,range,flash){
 c.save();c.translate(Math.round(x),Math.round(y));c.rotate(angle);
 const tip=Math.max(32,range-10);
 rect(c,'#172b26',11,-3,14,7);rect(c,'#8e704c',13,-1,9,3);
 for(let grip=14;grip<21;grip+=3)rect(c,'#d6b375',grip,-1,1,3);
 rect(c,'#384b3d',21,-6,5,13);rect(c,'#dfbb78',22,-5,3,11);rect(c,'#fff0b5',22,-5,2,2);
 c.fillStyle='#20372f';c.beginPath();c.moveTo(25,-4);c.lineTo(tip-8,-4);c.lineTo(tip+2,-1);c.lineTo(tip-3,4);c.lineTo(25,5);c.closePath();c.fill();
 c.fillStyle=flash?'#ffffff':'#d8e4d2';c.beginPath();c.moveTo(26,-3);c.lineTo(tip-8,-3);c.lineTo(tip,0);c.lineTo(tip-4,3);c.lineTo(26,4);c.closePath();c.fill();
 rect(c,'#fdf4cf',27,-3,Math.max(4,tip-35),1);rect(c,'#8ba894',27,2,Math.max(4,tip-33),1);c.restore();
}
export class Renderer{
 constructor(canvas,minimap){this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.minimap=minimap;this.mctx=minimap.getContext('2d',{alpha:false});this.camera={x:1024,y:1024};this.zoom=1.55;this.terrain=null;this.seed=null;this.decor=[];this.lastMap=0;}
 resize(){const w=Math.round(this.canvas.clientWidth),h=Math.round(this.canvas.clientHeight);if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}this.ctx.imageSmoothingEnabled=false;this.zoom=w<650?1.25:1.55;this.resizeMinimap();}
 resizeMinimap(){
  const w=Math.round(this.minimap.clientWidth),h=Math.round(this.minimap.clientHeight);
  if(!(w>0&&h>0))return;
  if(this.minimap.width!==w||this.minimap.height!==h){
   this.minimap.width=w;this.minimap.height=h;
   this.lastMap=-Infinity;
  }
  this.mctx.imageSmoothingEnabled=false;
 }
 bake(map){
  this.seed=map.seed;this.biome=terrainBiome(map);this.lastMap=-Infinity;const rng=rngFromSeed('art'+map.seed);const t=document.createElement('canvas');t.width=map.width;t.height=map.height;const c=t.getContext('2d');c.imageSmoothingEnabled=false;if(bakeBiome(c,map,rng)){this.terrain=t;this.decor=[];return;}rect(c,palette.ground,0,0,t.width,t.height);
  const shades=['#2b3f31','#2c3f32','#293b30','#304332','#293d31','#2a3e32'];
  for(let y=0;y<map.height;y+=32)for(let x=0;x<map.width;x+=32){rect(c,shades[Math.floor(rng()*shades.length)],x,y,32,32);if(rng()<.7){rect(c,'#344833',x+Math.floor(rng()*26),y+Math.floor(rng()*28),3,2);}}
  // A worn cross of flagstones gives the abandoned courtyard its recognizable silhouette.
  for(let y=0;y<map.height;y+=24)for(let x=0;x<map.width;x+=24){const radial=Math.hypot(x-1024,y-1024),path=Math.abs(x-1024)<76||Math.abs(y-1024)<76||radial<225;if(path&&rng()>.16){const k=Math.floor(rng()*3);rect(c,['#45503b','#49533e','#4d5740'][k],x+1,y+1,21,20);rect(c,'#374731',x+2,y+20,20,2);if(rng()<.4)rect(c,'#5c6348',x+3,y+3,9,2);if(rng()<.3)rect(c,'#30412e',x+14,y+9,3,11);}}
  // Fine grass, moss, flowers and rubble are drawn once, not per frame.
  for(let i=0;i<6800;i++){const x=Math.floor(rng()*map.width/2)*2,y=Math.floor(rng()*map.height/2)*2;const col=['#40543a','#4a5a3c','#3b5134','#536043','#273c2e'][Math.floor(rng()*5)];rect(c,col,x,y,2,4+rng()*4);if(rng()<.3)rect(c,col,x-2,y+3,2,3);if(rng()<.025)rect(c,'#b2b186',x,y-1,2,2);}
  for(const tr of map.traps){if(tr.type==='mud'){ellipse(c,'#22392c',tr.x,tr.y,tr.r+5,tr.r*.7+3);ellipse(c,'#1d3229',tr.x,tr.y,tr.r,tr.r*.7);for(let i=0;i<8;i++)rect(c,'#3a4b32',tr.x+(rng()-.5)*tr.r*1.5,tr.y+(rng()-.5)*tr.r,5,2);}else{rect(c,'#23332a',tr.x-tr.r,tr.y-tr.r,tr.r*2,tr.r*2);for(let x=-tr.r+3;x<tr.r;x+=9)for(let y=-tr.r+3;y<tr.r;y+=9){rect(c,'#17271f',tr.x+x,tr.y+y,5,4);rect(c,'#5a624a',tr.x+x,tr.y+y,4,1);}}}
  // Courtyard inscription.
  c.strokeStyle='#77805a55';c.lineWidth=2;c.beginPath();c.arc(1024,1024,130,0,Math.PI*2);c.stroke();c.beginPath();c.arc(1024,1024,140,0,Math.PI*2);c.stroke();
  for(let i=0;i<8;i++){const a=i*Math.PI/4,x=1024+Math.cos(a)*135,y=1024+Math.sin(a)*135;rect(c,'#8b8f6444',x-3,y-3,6,6);}
  this.terrain=t;this.decor=[];
  for(let i=0;i<85;i++){const x=rng()*map.width,y=rng()*map.height;if(Math.abs(x-1024)>170&&Math.abs(y-1024)>170)this.decor.push({x,y,size:16+rng()*18});}
 }
 draw(game,{started=false,spectateId=null,alpha=1}={}){
  this.resize();if(game.ruleset==='boss')this.zoom=this.canvas.width<650?1:1.25;if(!this.terrain||this.seed!==game.map.seed||this.biome!==terrainBiome(game.map))this.bake(game.map);const c=this.ctx,w=this.canvas.width,h=this.canvas.height,z=this.zoom;
  const lerp=e=>e.prevX===undefined?e:{...e,x:e.prevX+(e.x-e.prevX)*alpha,y:e.prevY+(e.y-e.prevY)*alpha};
  const target=started?lerp(game.actors.find(a=>a.id===spectateId&&a.alive)||game.actors.find(a=>a.isPlayer&&a.alive)||game.actors.find(a=>a.alive)||{x:1024,y:1024}):{x:1024,y:1024};
  if(target){const halfw=w/2/z,halfh=h/2/z;this.camera.x=Math.max(halfw,Math.min(game.map.width-halfw,target.x));this.camera.y=Math.max(halfh,Math.min(game.map.height-halfh,target.y));}
  c.clearRect(0,0,w,h);c.save();c.scale(z,z);c.translate(w/2/z-this.camera.x,h/2/z-this.camera.y);const left=this.camera.x-w/2/z,top=this.camera.y-h/2/z;const visible=(x,y,r=80)=>x>left-r&&x<left+w/z+r&&y>top-r&&y<top+h/z+r;
  c.drawImage(this.terrain,0,0);drawBossGuard(c,game.boss);drawBossTelegraph(c,game.boss,game.time);
  for(const t of game.map.traps){if(t.type!=='spike'||!visible(t.x,t.y))continue;if(drawBiomeSpike(c,t,game.time,this.biome))continue;const phase=(game.time+t.offset)%4;if(phase<2.1)continue;const up=phase>=2.8;c.globalAlpha=up?.8:.3+Math.sin(game.time*18)*.15;rect(c,up?'#bf785a':'#c8a968',t.x-t.r,t.y-t.r,t.r*2,t.r*2);c.globalAlpha=1;for(let x=-t.r+4;x<t.r;x+=10)for(let y=-t.r+4;y<t.r;y+=10){const px=t.x+x,py=t.y+y;rect(c,up?'#bcb48b':'#8a8f6a',px,py,3,up?9:3);if(up)rect(c,'#e0d2a5',px+1,py-2,1,7);}}
  for(const g of game.gems){if(!visible(g.x,g.y,20))continue;const phase=Number.isFinite(Number(g.id))?Number(g.id):g.x*.37+g.y*.19;const yy=g.y+Math.sin(game.time*3+phase)*2;ellipse(c,'#b6dd9c0b',g.x,g.y,12,8);c.save();c.translate(Math.round(g.x),Math.round(yy));c.rotate(Math.PI/4);rect(c,g.kind==='heal'?'#e6a39b':'#aad7a0',-3,-3,6,6);rect(c,g.kind==='heal'?'#f5d1ba':'#e1edbc',-2,-3,2,2);c.restore();rect(c,'#78b67933',g.x-1,yy+7,2,2);}
  const objects=[...(game.boss?[{kind:'boss',o:game.boss,y:game.boss.y}]:[]),...game.map.obstacles.map(o=>({kind:'obstacle',o,y:o.y+o.h})),...game.monsters.filter(m=>m.alive).map(e=>{const o=lerp(e);return{kind:'monster',o,y:o.y};}),...game.actors.map(e=>{const o=lerp(e);return{kind:'actor',o,y:o.y};})].sort((a,b)=>a.y-b.y);
  for(const {kind,o}of objects){if(!visible(o.x,o.y,kind==='obstacle'?Math.max(130,o.w+20,o.h+20):130))continue;if(kind==='obstacle')this.obstacle(c,o);else if(kind==='monster')this.monster(c,o,game.time);else if(kind==='boss')drawBossBody(c,o,game.time,this.biome);else this.actor(c,o,game.time,game.phase,(alpha-1)/60);}
  for(const bullet of game.bullets){const b=lerp(bullet);if(!visible(b.x,b.y,20))continue;const color=b.color||'#efcd8e';ellipse(c,color+'22',b.x,b.y,b.kind==='fireball'?16:6,b.kind==='fireball'?16:6);rect(c,color,b.x-2,b.y-2,b.kind==='fireball'?7:4,b.kind==='fireball'?7:4);rect(c,'#fff0bc',b.x-1,b.y-1,2,2);}
  for(const e of game.effects){if(e.kind!=='chainLightning'&&!visible(e.x,e.y,Math.max(150,e.radius||0)))continue;const p=Math.min(1,e.ttl/(e.maxTtl||.7));c.globalAlpha=Math.min(1,p*2);if(drawSkillEffect(c,e)){}else if(e.kind==='meleeImpact'){drawMeleeImpact(c,e);}else if(e.kind==='text'){if(/^\-0$/.test(e.text||''))continue;c.font='bold 9px "Space Grotesk","Noto Sans SC",sans-serif';c.textAlign='center';c.fillStyle='#17251b';c.fillText(e.text,e.x+1,e.y-12*(1-p)+1);c.fillStyle=e.color||'#e1d59f';c.fillText(e.text,e.x,e.y-12*(1-p));}else{c.strokeStyle=e.color||'#e4c283';c.lineWidth=e.kind==='ring'?3:2;c.beginPath();c.arc(e.x,e.y,(e.radius||20)*(1-p*.65),0,Math.PI*2);c.stroke();for(let i=0;i<6;i++){const a=i*Math.PI/3,r=(e.radius||20)*(1-p);rect(c,e.color||'#e4c283',e.x+Math.cos(a)*r,e.y+Math.sin(a)*r,3,3);}}c.globalAlpha=1;}
  // Warm embers drift over the cold ruins.
  if(!drawBiomeAmbient(c,this.biome,game.time,left,top,w/z,h/z))for(let i=0;i<24;i++){const x=left+((i*149+game.time*3)%(w/z)),y=top+((i*91-game.time*7+10000)%(h/z));c.globalAlpha=.15+.25*Math.sin(i+game.time);rect(c,'#ddc485',x,y,1+(i%2),1+(i%2));}c.globalAlpha=1;
  if(game.zone){const q=game.zone;c.save();c.fillStyle='#ba61402e';c.beginPath();c.rect(left-2,top-2,w/z+4,h/z+4);c.arc(q.x,q.y,Math.max(.1,q.radius),0,Math.PI*2,true);c.fill('evenodd');c.strokeStyle='#ecb477';c.lineWidth=2;c.setLineDash([9,6]);c.beginPath();c.arc(q.x,q.y,Math.max(.1,q.radius),0,Math.PI*2);c.stroke();c.setLineDash([]);rect(c,'#e6bd79',q.x-2,q.y-8,4,16);rect(c,'#e6bd79',q.x-8,q.y-2,16,4);c.restore();}
  c.restore();
  const mapView=[this.camera.x,this.camera.y,w,h,z].join(',');
  const frozen=!started||game.paused||game.result;
  if(game.time-this.lastMap>.1||this.lastMapGame!==game||this.lastMapStarted!==started
    ||(frozen&&this.lastMapView!==mapView)){
   this.drawMap(game);this.lastMap=game.time;this.lastMapGame=game;
   this.lastMapStarted=started;this.lastMapView=mapView;
  }
 }
 obstacle(c,o){
  if(drawBiomeObstacle(c,o,this.biome))return;
  const x=o.x,y=o.y,w=o.w,h=o.h;ellipse(c,'#0c1d1655',x+w/2+3,y+h+2,w*.6,9);
  if(o.kind==='rock'){rect(c,'#354a39',x+2,y-4,w-4,h+4);rect(c,'#53614a',x,y,w,h-3);rect(c,'#6b7354',x+4,y-3,w-8,5);rect(c,'#3d513d',x+w*.55,y+4,Math.ceil(w*.45),h-7);rect(c,'#7b8059',x+5,y+3,7,3);return;}
  rect(c,'#273c2e',x+3,y,w,h+8);rect(c,'#414d39',x,y-15,w,h+12);rect(c,'#6b7251',x,y-18,w,h);rect(c,'#82845b',x+2,y-18,w-4,3);
  for(let yy=y-16;yy<y+h-17;yy+=12){rect(c,'#4b593e',x,yy+10,w,2);for(let xx=x+(Math.floor(yy/12)%2?12:0);xx<x+w;xx+=24)rect(c,'#4b593e',xx,yy,2,10);}
  rect(c,'#384932',x,y+h-17,w,4);rect(c,'#4b613d',x+3,y-14,Math.min(12,w-6),5);rect(c,'#5a7042',x+2,y+h-17,Math.min(17,w-4),3);
  if(w>35){rect(c,'#84905b',x+w-10,y-15,4,8);rect(c,'#607548',x+w-12,y-9,6,5);}
 }
 monster(c,m,t){
  const x=Math.round(m.x),y=Math.round(m.y),b=Math.round(Math.sin(t*5+m.id)*2);ellipse(c,'#0c2118aa',x,y+7,10,4);
  if(m.type==='bat'){const f=Math.round(Math.sin(t*14)*3);rect(c,m.hitFlash>0?'#fff0cb':'#8d8aaf',x-5,y-5,10,10);rect(c,'#62657f',x-16,y-6+f,10,5);rect(c,'#62657f',x+6,y-6+f,10,5);rect(c,'#d3b39c',x-3,y-3,2,2);rect(c,'#d3b39c',x+2,y-3,2,2);}else if(m.type==='brute'){rect(c,'#435644',x-11,y-15,22,24);rect(c,m.hitFlash>0?'#f5dec4':'#7b8860',x-9,y-18,18,16);rect(c,'#b9ad81',x-6,y-11,3,3);rect(c,'#b9ad81',x+4,y-11,3,3);rect(c,'#465541',x-14,y-7,5,15);rect(c,'#465541',x+10,y-7,5,15);}else{rect(c,m.hitFlash>0?'#e7edbc':'#77946b',x-9,y-4+b,18,11-b);rect(c,m.hitFlash>0?'#e7edbc':'#92b083',x-6,y-7+b,12,8);rect(c,'#b6c79a',x-5,y-5+b,4,2);rect(c,'#263c2d',x-4,y+1,2,2);rect(c,'#263c2d',x+3,y+1,2,2);}
  if(m.hp<m.maxHp){rect(c,'#1b3024',x-11,y-23,22,3);rect(c,'#ab9a70',x-11,y-23,Math.ceil(22*m.hp/m.maxHp),2);}
 }
 actor(c,a,t,phase,timeOffset=0){
  if(!a.alive){rect(c,'#54684b',a.x-6,a.y-2,12,4);rect(c,'#677652',a.x-2,a.y-8,4,16);return;}
  if(a.isPlayer){ellipse(c,'#e7c67a22',a.x,a.y+6,18,7);c.strokeStyle='#d3bd7a77';c.lineWidth=1;c.beginPath();c.ellipse(a.x,a.y+7,16,6,0,0,Math.PI*2);c.stroke();}
  if(a.invulnerableUntil>t){c.save();c.strokeStyle='#bdeade';c.lineWidth=2;c.setLineDash([3,3]);c.beginPath();c.arc(a.x,a.y,22,0,Math.PI*2);c.stroke();c.restore();}
  drawBladeWard(c,a,t,{front:false});
  const poseDrawer=POSE_DRAWERS[a.weaponType];
  if(poseDrawer)poseDrawer(c,a,t,timeOffset,a.hitFlash>0);
  else drawHero(c,a.x,a.y,a.color,t,a.moving,1,a.hitFlash>0);
  drawBladeWard(c,a,t,{front:true});
  const y=a.y-28;c.font='7px "Space Grotesk","Noto Sans SC",sans-serif';c.textAlign='center';c.fillStyle='#111e16';c.fillText(`${a.name}  Lv.${a.level}`,a.x+1,y-6);c.fillStyle=a.isPlayer?'#f0d99e':'#c7d1b2';c.fillText(`${a.name}  Lv.${a.level}`,a.x,y-7);rect(c,'#1a281c',a.x-15,y-3,30,3);rect(c,a.isPlayer?'#c9bf7a':phase==='grace'?'#91af7a':'#ca9374',a.x-15,y-3,30*a.hp/a.maxHp,2);
  if(a.isPlayer){c.fillStyle='#e7c67a';c.beginPath();c.moveTo(a.x-3,y-18);c.lineTo(a.x+3,y-18);c.lineTo(a.x,y-14);c.fill();}
 }
 drawMap(game){const c=this.mctx,w=this.minimap.width,h=this.minimap.height,scale=Math.min(w/game.map.width,h/game.map.height),ox=(w-game.map.width*scale)/2,oy=(h-game.map.height*scale)/2;rect(c,'#15231a',0,0,w,h);c.save();c.translate(ox,oy);c.scale(scale,scale);c.drawImage(this.terrain,0,0);drawBossTelegraph(c,game.boss,game.time);if(game.boss){rect(c,'#eeac74',game.boss.x-25,game.boss.y-25,50,50);}for(const o of game.map.obstacles)this.obstacle(c,o);for(const g of game.gems)rect(c,'#a6d09a',g.x-6,g.y-6,12,12);for(const a of game.actors)if(a.alive){ellipse(c,a.isPlayer?'#f6ce79':'#d6977a',a.x,a.y,a.isPlayer?30:21,a.isPlayer?30:21);}if(game.zone){c.strokeStyle='#ead194';c.lineWidth=13;c.beginPath();c.arc(game.zone.x,game.zone.y,game.zone.radius,0,Math.PI*2);c.stroke();rect(c,'#f5d892',game.zone.x-15,game.zone.y-15,30,30);}c.strokeStyle='#b8c6a666';c.lineWidth=9;c.strokeRect(this.camera.x-this.canvas.width/2/this.zoom,this.camera.y-this.canvas.height/2/this.zoom,this.canvas.width/this.zoom,this.canvas.height/this.zoom);c.restore();}
 toWorld(x,y){return{x:this.camera.x+(x-this.canvas.width/2)/this.zoom,y:this.camera.y+(y-this.canvas.height/2)/this.zoom};}
}
