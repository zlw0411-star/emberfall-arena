import {generateMap,rngFromSeed,randomFree,moveEntity,blocked} from './world.js';
import {createActor,updateCombat,castSkill,damage} from './combat.js';
import {think} from './ai.js';

export const CONFIG={simulationHz:60,grace:90,maxLevel:10,warning:10,shrinkDuration:180,monsterCap:52,monsterInterval:3.2,gemInterval:7};
const names=['你','苔痕','鸦羽','夜行者','烛影','赤砂','雾凇','游隼'];
const colors=['#f2be65','#7bc796','#aa9de6','#6bb8dc','#e39ca4','#df9764','#9ccec6','#c7c28a'];
export function createGame(seed=Date.now()){
  const map=generateMap(seed),rng=rngFromSeed(seed);
  const game={seed,map,rng,time:0,phase:'grace',actors:[],monsters:[],gems:[],bullets:[],effects:[],events:[],zone:null,result:null,paused:false,nextId:100,spawnTimer:0,gemTimer:0,spawnCount:0,gemSpawnCount:0};
  game.actors=map.spawnPoints.map((p,i)=>createActor('a'+i,names[i],p.x,p.y,i===0,colors[i]));
  for(let i=0;i<72;i++)spawnGem(game);
  for(let i=0;i<24;i++)spawnMonster(game);
  game.events.push({text:'试炼开启 · 90 秒发育保护',time:0,color:'#f2be65'});
  return game;
}
export function spawnGem(game){
  if(game.phase==='finale'||game.result)return null;
  const p=randomFree(game.map,game.rng,24);const gem={id:game.nextId++,...p,value:4,kind:'xp'};game.gems.push(gem);game.gemSpawnCount++;return gem;
}
export function spawnMonster(game){
  if(game.phase==='finale'||game.result||game.monsters.filter(m=>m.alive).length>=CONFIG.monsterCap)return null;
  let p=randomFree(game.map,game.rng,30);
  for(let i=0;i<20&&game.actors.some(a=>a.alive&&Math.hypot(a.x-p.x,a.y-p.y)<180);i++)p=randomFree(game.map,game.rng,30);
  const tier=game.time>170&&game.rng()<.24?'brute':game.rng()<.28?'bat':'slime';
  const health=tier==='brute'?80:tier==='bat'?26:40;
  const m={id:game.nextId++,...p,radius:tier==='brute'?15:10,type:tier,hp:health,maxHp:health,speed:tier==='bat'?69:tier==='brute'?35:44,damage:tier==='brute'?12:6,attackTimer:0,alive:true,xp:tier==='brute'?20:12};game.monsters.push(m);game.spawnCount++;return m;
}
export function startFinale(game){
  if(game.phase==='finale'||game.result)return;
  let p={x:game.map.width/2,y:game.map.height/2};
  const valid=(game.map.freePoints||[]).filter(p=>p.x>250&&p.y>250&&p.x<game.map.width-250&&p.y<game.map.height-250&&!blocked(game.map,p.x,p.y,100));
  if(valid.length)p=valid[Math.floor(game.rng()*valid.length)];
  else for(let i=0;i<500;i++){const q=randomFree(game.map,game.rng,110);if(!blocked(game.map,q.x,q.y,100)){p=q;break;}}
  const r=Math.max(...[{x:0,y:0},{x:game.map.width,y:0},{x:0,y:game.map.height},{x:game.map.width,y:game.map.height}].map(q=>Math.hypot(q.x-p.x,q.y-p.y)));
  game.phase='finale';game.zone={...p,radius:r,initialRadius:r,startedAt:game.time};
  game.events.push({text:'有人满级！余烬风暴即将降临',time:game.time,color:'#e78877'});
}
export function stepGame(game,dt,input={}){
  if(game.paused||game.result)return;
  for(const e of [...game.actors,...game.monsters,...game.bullets]){e.prevX=e.x;e.prevY=e.y;}
  game.time+=dt;
  if(game.phase!=='finale'&&game.actors.some(a=>a.alive&&a.level>=CONFIG.maxLevel))startFinale(game);
  if(game.phase==='grace'&&game.time>=CONFIG.grace){game.phase='hunt';game.events.push({text:'保护结束 · 狩猎开始',time:game.time,color:'#e78877'});}
  for(const a of game.actors){
    if(!a.alive)continue;
    const command=(!a.isPlayer||input.autoPlayer)?think(game,a,dt):input;
    let mx=command.mx||0,my=command.my||0;const len=Math.hypot(mx,my);if(len>1){mx/=len;my/=len;}
    let slow=1;for(const t of game.map.traps)if(t.type==='mud'&&Math.hypot(a.x-t.x,a.y-t.y)<t.r+a.radius)slow=.55;
    if(a.slowUntil>game.time)slow*=.65;
    const speed=a.speed*slow*(a.combatSpeedMult||1);
    moveEntity(game.map,a,mx*speed*dt,my*speed*dt);a.moving=len>.05;if(len>.05){a.faceX=mx;a.faceY=my;}
    const slot=command.castSlot??-1;if(slot>=0)castSkill(game,a,slot,command.aimX??a.x+(a.faceX||1)*200,command.aimY??a.y+(a.faceY||0)*200);
  }
  updateCombat(game,dt);
  game.monsters=game.monsters.filter(m=>m.alive);
  if(game.phase!=='finale'&&game.actors.some(a=>a.alive&&a.level>=CONFIG.maxLevel))startFinale(game);
  if(game.phase!=='finale'){
    game.spawnTimer+=dt;game.gemTimer+=dt;
    if(game.spawnTimer>=CONFIG.monsterInterval){game.spawnTimer%=CONFIG.monsterInterval;for(let i=0;i<3;i++)spawnMonster(game);}
    if(game.gemTimer>=CONFIG.gemInterval){game.gemTimer%=CONFIG.gemInterval;if(game.gems.length<110)for(let i=0;i<5;i++)spawnGem(game);}
  }else{
    const elapsed=game.time-game.zone.startedAt;
    game.zone.radius=game.zone.initialRadius*Math.max(0,1-Math.max(0,elapsed-CONFIG.warning)/CONFIG.shrinkDuration);
    if(elapsed>CONFIG.warning){const rate=.055+.105*Math.min(1,(elapsed-CONFIG.warning)/CONFIG.shrinkDuration);for(const a of game.actors)if(a.alive&&Math.hypot(a.x-game.zone.x,a.y-game.zone.y)>game.zone.radius)damage(game,a,a.maxHp*rate*dt,null);}
  }
  const living=game.actors.filter(a=>a.alive);
  if(living.length<=1){game.result={winnerId:living[0]?.id??null,time:game.time};game.events.push({text:living.length?`${living[0].name}成为最后的幸存者`:'试炼结束 · 无人生还',time:game.time,color:'#f2be65'});}
  game.events=game.events.slice(-30);
}
