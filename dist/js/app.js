import {createGame,stepGame,CONFIG} from './simulation.js';
import {SKILLS,chooseSkill,getChoices,xpNeeded,PROGRESSION,COMBAT_BALANCE} from './combat.js';
import {Renderer,drawHero} from './renderer.js';

const $=id=>document.getElementById(id),show=(id,yes)=>$(id).classList.toggle('hidden',!yes),timeText=t=>`${String(Math.floor(Math.max(0,t)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`;
let game=createGame(Date.now()),started=false,spectateId=null,deathDismissed=false,helpWasPaused=false,choiceKey='',lastLevel=1,lastPhase='grace',lastAlive=8,lastHp=280,lastKills=0,lastHud=0,soundOn=false,audio=null;
const keys=new Set(),pointer={x:0,y:0};let castSlot=-1;
const renderer=new Renderer($('game'),$('minimap'));
const skillLevelLabel=PROGRESSION.milestones.join(' / ');
const portrait=$('portrait').getContext('2d');portrait.imageSmoothingEnabled=false;drawHero(portrait,24,25,'#f2be65',0,false,1.45);

function beep(freq=440,duration=.08,volume=.025){if(!soundOn)return;try{audio||=new AudioContext();if(audio.state==='suspended')audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.type='triangle';o.frequency.value=freq;g.gain.setValueAtTime(volume,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+duration);}catch{}}
function toast(text){$('world-toast').textContent=text;show('world-toast',true);clearTimeout(toast.timer);toast.timer=setTimeout(()=>show('world-toast',false),3200);}
function begin(){game=createGame(Date.now());started=true;deathDismissed=false;spectateId=null;keys.clear();choiceKey='';lastLevel=1;lastPhase='grace';lastAlive=8;lastHp=game.actors[0].hp;lastKills=0;for(const id of ['start-overlay','pause-overlay','result-overlay','death-card','choices'])show(id,false);$('game-shell').classList.remove('spectating');renderer.seed=null;renderer.lastMap=0;$('game-shell').focus({preventScroll:true});beep(330,.2);toast('试炼开始 · 90 秒发育保护');updateHud();}
function pause(yes){if(!started||game.result)return;game.paused=yes;keys.clear();castSlot=-1;show('pause-overlay',yes);$('pause-button').textContent=yes?'▷':'Ⅱ';$('pause-button').setAttribute('aria-label',yes?'继续':'暂停');updateHud();}
function pick(index){const a=game.actors[0];if(!started||game.paused||game.result||!a.alive)return;const id=a.choices[index];if(id&&chooseSkill(game,a,id)){choiceKey='';beep(660,.1);toast(`已觉醒 · ${SKILLS[id].name}`);updateHud();}}
function openHelp(){helpWasPaused=game.paused;if(started&&!game.result)pause(true);show('help-overlay',true);}
function closeHelp(){show('help-overlay',false);if(started&&!helpWasPaused)pause(false);}
$('start-button').onclick=begin;for(const id of ['restart-pause','restart-death','restart-result'])$(id).onclick=begin;
$('pause-button').onclick=()=>pause(!game.paused);$('resume-button').onclick=()=>pause(false);
$('help-button').onclick=openHelp;$('close-help').onclick=closeHelp;$('help-done').onclick=closeHelp;
$('sound-button').onclick=()=>{soundOn=!soundOn;$('sound-button').textContent=soundOn?'♫':'♪';$('sound-button').style.color=soundOn?'#e6bd79':'';$('sound-button').setAttribute('aria-label',soundOn?'关闭声音':'开启声音');beep(523,.13);};
$('spectate-button').onclick=()=>{deathDismissed=true;show('death-card',false);toast('观战中 · 点击右侧存活旅者切换视角');};
$('choices').addEventListener('click',e=>{const card=e.target.closest('[data-choice]');if(card)pick(Number(card.dataset.choice));});
$('roster').addEventListener('click',e=>{if(game.actors[0].alive)return;const row=e.target.closest('[data-actor]');if(row&&game.actors.some(a=>a.id===row.dataset.actor&&a.alive))spectateId=row.dataset.actor;});
$('game-shell').tabIndex=-1;
window.addEventListener('keydown',e=>{const key=e.key.toLowerCase();if(['arrowup','arrowdown','arrowleft','arrowright',' ','escape','1','2','3','q','e','r'].includes(key))e.preventDefault();if(e.repeat)return;if(key==='escape'){if(!$('help-overlay').classList.contains('hidden'))closeHelp();else pause(!game.paused);return;}keys.add(key);if('123'.includes(key))pick(Number(key)-1);if(['q','e','r'].includes(key)&&started&&!game.paused)castSlot=['q','e','r'].indexOf(key);});
window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
$('game').addEventListener('pointermove',e=>{const r=$('game').getBoundingClientRect();pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top;});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause(true);});window.addEventListener('blur',()=>{keys.clear();if(started)pause(true);});

function updateHud(){
 const a=game.actors[0],living=game.actors.filter(a=>a.alive),phase=game.phase;const count=living.length;
 $('clock').textContent=timeText(game.time);$('seed-label').textContent=`SEED ${game.seed}`;$('alive-count').textContent=String(count).padStart(2,'0');$('roster-count').textContent=`${count} IN THE RUINS`;
 $('player-level').textContent=`LV. ${String(a.level).padStart(2,'0')}`;$('hp-fill').style.width=`${100*a.hp/a.maxHp}%`;$('hp-text').textContent=`${Math.ceil(a.hp)} / ${a.maxHp}`;$('xp-fill').style.width=a.level>=CONFIG.maxLevel?'100%':`${100*a.xp/xpNeeded(a.level)}%`;$('xp-text').textContent=a.level>=CONFIG.maxLevel?'最高等级':`XP ${Math.floor(a.xp)} / ${xpNeeded(a.level)}`;$('attack-stat').textContent=`攻击 ${(a.attackDamage*(1+(a.skills.power||0)*COMBAT_BALANCE.powerDamagePerRank)).toFixed(1)}`;
 const phaseNames={grace:'发育保护',hunt:'自由争夺',finale:'终局决战'};$('phase-tag').textContent=started?phaseNames[phase]:'准备进入';$('phase-tag').className='phase-tag '+phase;
 let label='发育保护期',remaining=CONFIG.grace-game.time,progress=Math.max(0,remaining/CONFIG.grace),description='角色暂不互伤，打怪拾取经验以成长。';
 if(phase==='hunt'){label='争夺进行中';remaining=0;progress=1;description='已开放互伤 · 任意旅者满级后开启决战。';}
 if(phase==='finale'){const elapsed=game.time-game.zone.startedAt;label=elapsed<10?'风暴即将降临':'安全区正在缩小';remaining=elapsed<10?10-elapsed:190-elapsed;progress=Math.max(0,(190-elapsed)/190);description=elapsed<10?'刷怪已停止 · 向地图标记的圆心移动。':'圈外持续受伤 · 最后一位旅者获胜。';show('zone-banner',started&&!game.result);$('zone-banner').textContent=elapsed<10?`⚠ 决战开启 · ${Math.ceil(10-elapsed)} 秒后缩圈`:`⚠ 余烬风暴 · 安全区半径 ${Math.round(game.zone.radius)}m`;}
 else {const notice=phase==='grace'&&remaining>0&&remaining<=CONFIG.pvpNotice;show('zone-banner',started&&!game.result&&notice);if(notice)$('zone-banner').textContent=`⚠ 全场公告 · ${Math.ceil(remaining)} 秒后允许旅者互相攻击`;}
 $('stage-label').textContent=label;$('stage-time').textContent=phase==='hunt'?'已解除保护':timeText(remaining);$('stage-fill').style.width=`${progress*100}%`;$('stage-description').textContent=description;
 for(const p of ['grace','hunt','finale'])$('timeline-'+p).classList.toggle('active',p===phase);
 $('footer-status').textContent=!started?'遗迹已就绪，等待你的到来':game.result?'试炼已结束':game.paused?'世界已暂停':!a.alive?'正在观战 · 点击试炼者切换视角':a.pendingChoices?'觉醒待选 · 战场持续运行，请保持移动':phase==='grace'?`保护生效中 · 2 级首次觉醒 · ${CONFIG.maxLevel} 级进入决战`:'危险无处不在，留意你的四周';
 $('roster').innerHTML=game.actors.map(o=>`<div class="roster-row ${o.isPlayer?'you':''} ${!o.alive?'dead':''}" data-actor="${o.id}" ${!a.alive&&o.alive?'role="button" tabindex="0"':''}><span class="roster-avatar" style="color:${o.color}">${o.alive?'♟':'×'}</span><span class="roster-name">${o.isPlayer?'灰烬旅者 <small>你</small>':o.name}</span><span class="roster-level">LV.${String(o.level).padStart(2,'0')}</span><span class="roster-state">${o.alive?'存活':'陨落'}</span></div>`).join('');
 $('skills-bar').innerHTML=Array.from({length:PROGRESSION.maxActiveSkills},(_,slot)=>{const id=a.activeSkills[slot],s=SKILLS[id],cd=a.cooldowns[id]||0;return `<div class="skill-slot ${s?'':'locked'}" title="${s?s.name+' · '+s.description:`在 ${skillLevelLabel} 级选择强化，最多三个主动技能`}"><kbd>${['Q','E','R'][slot]}</kbd>${s?s.icon:'◇'}<small>${s?s.name:'待觉醒'}</small>${cd?`<i class="cooldown-mask" style="height:${Math.min(100,cd/s.cooldown*100)}%"></i><span class="cooldown-number">${cd.toFixed(1)}</span>`:''}</div>`;}).join('');
 if(a.alive&&a.pendingChoices&&!game.result){if(!a.choices.length)getChoices(game,a);const key=a.choices.join(',')+':'+a.pendingChoices;if(key!==choiceKey){choiceKey=key;$('choices').innerHTML=a.choices.map((id,i)=>{const s=SKILLS[id],rank=a.skills[id]||0;return `<button class="choice-card" data-choice="${i}"><kbd>${i+1}</kbd><span style="color:${s.color}">${s.icon}</span><h3>${s.name}<small class="choice-rank">${rank?'强化 '+rank+' → '+(rank+1):s.type==='active'?'主动技能':'被动强化'}</small></h3><p>${s.description}</p></button>`;}).join('');}show('choices',true);}else{show('choices',false);choiceKey='';}
 $('event-log').innerHTML=game.events.slice(-3).reverse().map(e=>`<p><time>${timeText(e.time)}</time><span style="color:${e.color||'#97aa84'}">${e.text}</span></p>`).join('');
 if(started&&!a.alive&&!game.result){$('game-shell').classList.add('spectating');show('death-card',!deathDismissed);if(!spectateId||!living.some(o=>o.id===spectateId))spectateId=living[0]?.id;}
 if(started&&game.result){show('result-overlay',true);show('death-card',false);show('choices',false);show('zone-banner',false);const winner=game.actors.find(o=>o.id===game.result.winnerId);$('result-kicker').textContent=winner?.isPlayer?'THE LAST LIGHT STANDING':'TRIAL COMPLETE';$('result-title').textContent=winner?.isPlayer?'你是最后的微光':winner?`${winner.name} 赢得试炼`:'余烬之下，无人生还';$('result-subtitle').textContent=winner?.isPlayer?'风暴散去，遗迹记住了你的名字。':'每一次陨落，都是下一次觉醒的开始。';$('result-stats').innerHTML=`<div><strong>${timeText(game.time)}</strong><small>存活试炼时间</small></div><div><strong>${a.level}</strong><small>最终等级</small></div><div><strong>${a.monsterKills}</strong><small>击败怪物</small></div>`;}
 if(started){if(a.kills>lastKills){toast(a.level<CONFIG.maxLevel?'击败旅者 · 经验已获取':'击败旅者');beep(880,.16);}if(a.level>lastLevel){toast(a.pendingChoices?'力量觉醒 · 选择一项强化':'等级提升 · LV.'+a.level);beep(784,.14);}if(phase!==lastPhase){toast(phase==='finale'?'有人满级！准备迎接余烬风暴':'保护结束 · 旅者之间可以互相攻击');beep(220,.4);}if(count<lastAlive)beep(196,.15);if(a.hp<lastHp-1)beep(110,.04,.012);}
 lastLevel=a.level;lastPhase=phase;lastAlive=count;lastHp=a.hp;lastKills=a.kills;
}
let previous=performance.now(),accumulator=0,fpsFrames=0,fpsAt=performance.now();const step=1/CONFIG.simulationHz;
function frame(now){const delta=Math.min(.1,(now-previous)/1000);previous=now;fpsFrames++;if(now-fpsAt>=750){$('fps-meter').textContent=`FPS ${Math.round(fpsFrames*1000/(now-fpsAt))}`;fpsFrames=0;fpsAt=now;}if(started&&!game.paused&&!game.result){accumulator+=delta;let ticks=0;while(accumulator>=step&&ticks++<6){const aim=renderer.toWorld(pointer.x,pointer.y);stepGame(game,step,{mx:Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft')),my:Number(keys.has('s')||keys.has('arrowdown'))-Number(keys.has('w')||keys.has('arrowup')),aimX:aim.x,aimY:aim.y,castSlot});castSlot=-1;accumulator-=step;}accumulator=Math.min(accumulator,step);}else accumulator=0;
 renderer.draw(game,{started,spectateId,alpha:started&&!game.paused&&!game.result?accumulator/step:1});if(now-lastHud>100){updateHud();lastHud=now;}requestAnimationFrame(frame);}
window.addEventListener('resize',()=>renderer.resize());updateHud();requestAnimationFrame(frame);
