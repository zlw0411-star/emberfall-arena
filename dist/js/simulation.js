import {MATCH_SIZE,generateMap,rngFromSeed,randomFree,moveEntity,blocked} from './world.js';
import {createActor,configureActorForMode,updateCombat,castSkill,damage,PROGRESSION} from './combat.js';
import {modeOf,normalizeMode} from './modes.js';
import {think} from './ai.js';
import {MONSTERS,MONSTER_SPAWN_POLICY} from './balance.js';

/**
 * 输入适配：按当前模式声明传递鼠标瞄准与左键攻击。
 * 每次读取注册表，支持模块加载后注册或覆盖模式。
 */
function applyPointerInput(mode, actor, command) {
  if (!modeOf(mode).usesPointerAttack) return;
  actor.attackHeld = !!command.attackHeld;
  actor.attackPressed = !!command.attackPressed;
  const dx = (command.aimX ?? actor.x) - actor.x, dy = (command.aimY ?? actor.y) - actor.y;
  if (Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) > .001) actor.aimAngle = Math.atan2(dy, dx);
}

// Twelve travelers share 20% more supplies than the eight-traveler arena.
// Scaling supplies by the full roster ratio made the stronger PvP finish too early.
const resourceScale=1.2;
// monsterXp / bruteXp 由 MONSTERS 表导出，保持对外接口不变。
export const CONFIG={actorCount:MATCH_SIZE,simulationHz:60,grace:90,pvpNotice:10,maxLevel:PROGRESSION.maxLevel,warning:10,shrinkDuration:180,matchLimit:720,finaleDeadline:520,initialGems:Math.round(72*resourceScale),initialMonsters:Math.round(24*resourceScale),monsterCap:Math.round(52*resourceScale),gemCap:Math.round(110*resourceScale),monsterInterval:3.2/resourceScale,gemInterval:7/resourceScale,mapGemXp:5,monsterXp:MONSTERS.slime.xp,bruteXp:MONSTERS.brute.xp};
const names=['你','苔痕','鸦羽','夜行者','烛影','赤砂','雾凇','游隼','青芒','松烟','星屑','玄石'];
const colors=['#f2be65','#7bc796','#aa9de6','#6bb8dc','#e39ca4','#df9764','#9ccec6','#c7c28a','#a6cb68','#a89a7d','#e2a8d9','#829bba'];
export function createGame(seed=Date.now(),options={}){
  const map=generateMap(seed),rng=rngFromSeed(seed);
  const game={seed,map,rng,time:0,phase:'grace',actors:[],monsters:[],gems:[],bullets:[],effects:[],events:[],zone:null,result:null,paused:false,pvpNoticeSent:false,nextId:100,spawnTimer:0,gemTimer:0,spawnCount:0,gemSpawnCount:0};
  Object.defineProperty(game,'mode',{value:normalizeMode(options?.mode),enumerable:true});
  game.actors=map.spawnPoints.map((p,i)=>{
    const actor=createActor('a'+i,names[i],p.x,p.y,i===0,colors[i]);
    configureActorForMode(actor,game.mode);
    return actor;
  });
  for(let i=0;i<CONFIG.initialGems;i++)spawnGem(game);
  for(let i=0;i<CONFIG.initialMonsters;i++)spawnMonster(game);
  game.events.push({text:'试炼开启 · 90 秒发育保护',time:0,color:'#f2be65'});
  return game;
}
export function spawnGem(game){
  if(game.phase==='finale'||game.result)return null;
  const p=randomFree(game.map,game.rng,24);const gem={id:game.nextId++,...p,value:CONFIG.mapGemXp,kind:'xp'};game.gems.push(gem);game.gemSpawnCount++;return gem;
}
export function spawnMonster(game){
  if(game.phase==='finale'||game.result||game.monsters.filter(m=>m.alive).length>=CONFIG.monsterCap)return null;
  let p=randomFree(game.map,game.rng,30);
  for(let i=0;i<20&&game.actors.some(a=>a.alive&&Math.hypot(a.x-p.x,a.y-p.y)<180);i++)p=randomFree(game.map,game.rng,30);
  // rng 消耗顺序必须与历史一致：先抽 brute，再抽 bat。
  const policy=MONSTER_SPAWN_POLICY;
  const tier=game.time>policy.bruteAfterSeconds&&game.rng()<policy.bruteChance?'brute':game.rng()<policy.batChance?'bat':'slime';
  const def=MONSTERS[tier];
  const m={id:game.nextId++,...p,radius:def.radius,type:tier,hp:def.hp,maxHp:def.hp,speed:def.spawnSpeed,damage:def.damage,attackTimer:0,alive:true,xp:def.xp};game.monsters.push(m);game.spawnCount++;return m;
}
export function startFinale(game,reason='level'){
  if(game.phase==='finale'||game.result)return;
  let p={x:game.map.width/2,y:game.map.height/2};
  const valid=(game.map.freePoints||[]).filter(p=>p.x>250&&p.y>250&&p.x<game.map.width-250&&p.y<game.map.height-250&&!blocked(game.map,p.x,p.y,100));
  if(valid.length)p=valid[Math.floor(game.rng()*valid.length)];
  else for(let i=0;i<500;i++){const q=randomFree(game.map,game.rng,110);if(!blocked(game.map,q.x,q.y,100)){p=q;break;}}
  const r=Math.max(...[{x:0,y:0},{x:game.map.width,y:0},{x:0,y:game.map.height},{x:game.map.width,y:game.map.height}].map(q=>Math.hypot(q.x-p.x,q.y-p.y)));
  game.phase='finale';game.zone={...p,radius:r,initialRadius:r,startedAt:game.time,reason};
  game.events.push({text:reason==='time'?'试炼时限将至！余烬风暴即将降临':'有人满级！余烬风暴即将降临',time:game.time,color:'#e78877'});
}
export function stepGame(game,dt,input={}){
  if(game.paused||game.result)return;
  for(const e of [...game.actors,...game.monsters,...game.bullets]){e.prevX=e.x;e.prevY=e.y;}
  dt=Math.min(dt,Math.max(0,CONFIG.matchLimit-game.time));
  game.time+=dt;
  if(game.phase!=='finale'&&game.actors.some(a=>a.alive&&a.level>=CONFIG.maxLevel))startFinale(game);
  if(game.phase!=='finale'&&game.time>=CONFIG.finaleDeadline)startFinale(game,'time');
  if(game.phase==='grace'&&!game.pvpNoticeSent&&game.time>=CONFIG.grace-CONFIG.pvpNotice&&game.time<CONFIG.grace){game.pvpNoticeSent=true;game.events.push({text:`全场公告：${Math.ceil(CONFIG.grace-game.time)} 秒后解除保护，旅者可互相攻击！`,time:game.time,color:'#edbd81'});}
  if(game.phase==='grace'&&game.time>=CONFIG.grace){game.phase='hunt';game.events.push({text:'保护结束 · 狩猎开始',time:game.time,color:'#e78877'});}
  for(const a of game.actors){
    if(!a.alive)continue;
    const command=(!a.isPlayer||input.autoPlayer)?think(game,a,dt):input;
    applyPointerInput(game.mode,a,command);
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
    if(game.gemTimer>=CONFIG.gemInterval){game.gemTimer%=CONFIG.gemInterval;if(game.gems.length<CONFIG.gemCap)for(let i=0;i<5;i++)spawnGem(game);}
  }else{
    const elapsed=game.time-game.zone.startedAt;
    game.zone.radius=game.zone.initialRadius*Math.max(0,1-Math.max(0,elapsed-CONFIG.warning)/CONFIG.shrinkDuration);
    if(elapsed>CONFIG.warning){const rate=.055+.105*Math.min(1,(elapsed-CONFIG.warning)/CONFIG.shrinkDuration);for(const a of game.actors)if(a.alive&&Math.hypot(a.x-game.zone.x,a.y-game.zone.y)>game.zone.radius)damage(game,a,a.maxHp*rate*dt,null);}
  }
  // The final storm covers even the exact center at the round deadline.
  const remaining=game.actors.filter(a=>a.alive);
  if(game.time>=CONFIG.matchLimit&&remaining.length>1){
    if(game.zone)game.zone.radius=0;
    game.events.push({text:'12 分钟时限已到 · 最终风暴吞没遗迹',time:game.time,color:'#e78877'});
    for(const a of remaining)damage(game,a,a.maxHp*2,{type:'zone'});
  }
  const living=game.actors.filter(a=>a.alive);
  if(living.length<=1){game.result={winnerId:living[0]?.id??null,time:game.time};game.events.push({text:living.length?`${living[0].name}成为最后的幸存者`:'试炼结束 · 无人生还',time:game.time,color:'#f2be65'});}
  game.events=game.events.slice(-30);
}
