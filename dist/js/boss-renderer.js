// Presentation only: geometry and lifetimes come from the encounter snapshots.
import { BOSS_CONFIG } from './boss-config.js';
const TAU = Math.PI * 2;
const COLORS = { courtyard: ['#62634f','#928460','#eab26c'], desert: ['#806047','#b39465','#f2b779'], frost: ['#547d8c','#a2cad1','#d6fbf3'], swamp: ['#435c50','#7f9870','#c5e493'] };
function rect(c,color,x,y,w,h){c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}

export function drawBossGuard(c, boss) {
  if (!boss?.alive) return;
  const radius = BOSS_CONFIG.nearGuardRadius;
  c.save(); c.strokeStyle = '#183a32bb'; c.lineWidth = 3.5;
  c.setLineDash([5, 6]); c.beginPath(); c.arc(boss.x, boss.y, radius, 0, TAU); c.stroke();
  c.strokeStyle = '#a6e1cacc'; c.lineWidth = 1.5; c.stroke();
  c.setLineDash([]);
  for (let i = 0; i < 8; i++) {
    const angle = i * TAU / 8;
    c.beginPath(); c.moveTo(boss.x + Math.cos(angle) * (radius - 4), boss.y + Math.sin(angle) * (radius - 4));
    c.lineTo(boss.x + Math.cos(angle) * (radius + 4), boss.y + Math.sin(angle) * (radius + 4)); c.stroke();
  }
  c.font = '8px monospace'; c.textAlign = 'center'; c.fillStyle = '#b5e1ce';
  c.fillText(`近身护佑 · 首领伤害 -${Math.round(BOSS_CONFIG.nearGuardReduction * 100)}%`, boss.x, boss.y + radius + 14);
  c.restore();
}

export function drawBossTelegraph(c, boss, time) {
  const a = boss?.attack;
  if (!boss?.alive || !a) return;
  const age = time - a.startedAt;
  const warning = age < a.windup;
  if (age < 0 || age > a.windup + a.active + .35) return;
  c.save(); c.lineWidth = 2; c.strokeStyle = warning ? '#efb275' : '#ffe2a1';
  c.fillStyle = warning ? '#d878482b' : '#ffe0a16b';
  c.globalAlpha = warning ? .72 + Math.sin(age * 15) * .18 : Math.max(0, 1 - (age-a.windup)/.5);
  if (warning) c.setLineDash([7,5]);
  if (a.kind === 'rocks') {
    for (const p of a.targets || []) {
      c.beginPath(); c.arc(p.x,p.y,p.radius,0,TAU); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(p.x-10,p.y);c.lineTo(p.x+10,p.y);c.moveTo(p.x,p.y-10);c.lineTo(p.x,p.y+10);c.stroke();
      if (!warning) { rect(c,'#9e7955',p.x-18,p.y-25,36,40);rect(c,'#deba7d',p.x-14,p.y-25,25,8); }
    }
  } else {
    c.translate(boss.x,boss.y); c.rotate(a.angle);
    if(a.kind === 'sweep') {
      c.beginPath();c.moveTo(0,0);c.arc(0,0,a.radius,-a.arc/2,a.arc/2);c.closePath();c.fill();c.stroke();
      if(!warning){c.lineWidth=5;c.beginPath();c.arc(0,0,a.radius*.9,-a.arc/2,a.arc/2);c.stroke();}
    } else for(let i=0;i<4;i++) {
      c.save();c.rotate(i*Math.PI/2);c.fillRect(0,-a.width/2,a.radius,a.width);c.strokeRect(0,-a.width/2,a.radius,a.width);
      if(!warning) for(let j=0;j<10;j++)rect(c,'#f2bc75',30+j*44,-3+(j%2)*6,20,4);
      c.restore();
    }
  }
  c.restore();
}

export function drawBossBody(c,boss,time,biome='courtyard') {
  if(!boss) return;
  const [dark,stone,glow]=COLORS[biome] || COLORS.courtyard;
  c.save();c.translate(boss.x,boss.y);
  if(!boss.alive){c.globalAlpha=.6;for(let i=0;i<9;i++)rect(c,stone,(i%3-1)*30,-8+Math.floor(i/3)*16,20,12);c.restore();return;}
  const windup=boss.attack && time<boss.attack.startedAt+boss.attack.windup;
  const lift=windup?Math.sin(Math.min(1,(time-boss.attack.startedAt)/boss.attack.windup)*Math.PI/2)*9:0;
  c.fillStyle='#07100e88';c.beginPath();c.ellipse(0,34,68,29,0,0,TAU);c.fill();
  rect(c,'#28372e',-46,-48,92,90);rect(c,dark,-43,-60,86,85);rect(c,stone,-34,-60,68,10);
  rect(c,dark,-64,-40-lift,22,61);rect(c,stone,-64,-40-lift,22,11);rect(c,dark,42,-40-lift,22,61);rect(c,stone,42,-40-lift,22,11);
  rect(c,'#263a31',-35,18,25,39);rect(c,'#263a31',10,18,25,39);rect(c,stone,-38,49,30,12);rect(c,stone,8,49,30,12);
  rect(c,stone,-23,-84,46,37);rect(c,dark,-18,-79,36,25);rect(c,'#192922',-23,-72,46,8);
  const pulse=.7+.3*Math.sin(time*4);c.globalAlpha=pulse;
  rect(c,glow,-15,-70,10,4);rect(c,glow,5,-70,10,4);rect(c,glow,-8,-23,16,22);rect(c,'#fff3cd',-3,-18,6,11);c.globalAlpha=1;
  for(let i=0;i<boss.stage;i++){rect(c,glow,-28+i*22,-43,12,4);rect(c,glow,-26+i*22,-37,4,11);}
  if(windup){c.strokeStyle=glow;c.lineWidth=2;c.strokeRect(-69,-45-lift,27,66);c.strokeRect(42,-45-lift,27,66);}
  if(boss.hitFlash>0){c.globalAlpha=Math.min(.5,boss.hitFlash*3);rect(c,'#fff6ce',-40,-56,80,70);}
  c.restore();
}
