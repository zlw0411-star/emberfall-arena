// Render-only sword choreography. Event positions are never advanced here.
export const MELEE_VISUAL_TIMING = Object.freeze({
  lunge: Object.freeze({duration:.72,bodyDuration:.42}),
  whirlwind: Object.freeze({duration:.92,bodyDuration:.64}),
  heavySlash: Object.freeze({duration:1.05,bodyDuration:.72}),
});
const TAU=Math.PI*2;
const clamp=n=>Math.max(0,Math.min(1,n));
const ease=n=>1-Math.pow(1-clamp(n),3);
const finite=(n,f=0)=>Number.isFinite(n)?n:f;
function pixel(c,color,x,y,size=2){c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),size,size);}
function line(c,color,x,y,xx,yy,width=1){c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(Math.round(x),Math.round(y));c.lineTo(Math.round(xx),Math.round(yy));c.stroke();}
// A narrow tapered ribbon, not a filled sector. Quantized vertices keep the blade crisp.
function crescent(c,r,start,sweep,width,color,alpha=1){
 if(!(r>0)||!Number.isFinite(r)||Math.abs(sweep)<.001||alpha<=0)return;
 c.save();c.globalAlpha*=clamp(alpha);c.fillStyle=color;c.beginPath();
 const n=Math.max(6,Math.min(28,Math.ceil(Math.abs(sweep)*12)));
 for(let i=0;i<=n;i++){const p=i/n,a=start+sweep*p,rr=r+Math.sin(p*Math.PI)*width*.25;const x=Math.round(Math.cos(a)*rr),y=Math.round(Math.sin(a)*rr);if(i)c.lineTo(x,y);else c.moveTo(x,y);}
 for(let i=n;i>=0;i--){const p=i/n,a=start+sweep*p,rr=r-Math.sin(p*Math.PI)*width;c.lineTo(Math.round(Math.cos(a)*rr),Math.round(Math.sin(a)*rr));}
 c.closePath();c.fill();c.restore();
}
function ghost(c,x,y,angle,alpha){
 c.save();c.globalAlpha*=clamp(alpha);c.translate(Math.round(x),Math.round(y));
 pixel(c,'#294f60',-9,-12,16);c.fillStyle='#72c9d7';c.fillRect(-7,-15,13,5);c.fillStyle='#438796';c.fillRect(-10,-7,4,13);c.fillRect(5,-7,4,13);c.fillRect(-5,4,4,9);c.fillRect(2,4,4,9);
 c.rotate(angle);line(c,'#baf7ef',13,0,45,0,2);line(c,'#5ab6c9',21,-4,21,4,2);c.restore();
}
function particles(c,r,angle,p,color,count=10,spread=1){
 for(let i=0;i<count;i++){const k=(i*.61803398875)%1,a=angle+(k-.5)*spread,rr=r*(.45+.5*((i*7%11)/11))+p*(9+i%4*3);pixel(c,i%3===0?'#fff3cf':color,Math.cos(a)*rr,Math.sin(a)*rr,(i%3===0?2:1));}
}
function lunge(c,e,t){
 const p=clamp(t/.72),fade=Math.pow(clamp((.72-t)/.42),1.15),a=finite(e.angle),ox=finite(e.originX,e.x),oy=finite(e.originY,e.y),x=finite(e.x),y=finite(e.y),r=Math.max(1,finite(e.range,68));
 c.save();c.globalAlpha*=fade;
 for(let i=0;i<4;i++){const q=(i+1)/5;ghost(c,ox+(x-ox)*q,oy+(y-oy)*q,a,(.1+i*.045)*clamp((.57-t)/.25));}
 const nx=-Math.sin(a),ny=Math.cos(a),travel=ease(t/.18);
 for(let i=0;i<3;i++){const off=(i-1)*5;line(c,i===1?'#d2fff5':'#65cbdc',ox+(x-ox)*p*.65+nx*off,oy+(y-oy)*p*.65+ny*off,ox+(x-ox)*travel+nx*off,oy+(y-oy)*travel+ny*off,i===1?2:1);}
 c.translate(x,y);const cut=ease(t/.25),arc=Math.min(1.65,finite(e.arc,1.5));
 crescent(c,r*.94,a-arc*.5,arc*cut,9,'#459aad',.45);
 crescent(c,r*.91,a-arc*.5,arc*cut,4,'#b7fff2',.95);
 crescent(c,r*.73,a+arc*.49,-arc*.72*cut,3,'#72d5e5',.7);
 if(t>.06){c.globalAlpha*=clamp((.65-t)/.4);particles(c,r,a,p,'#6ae0e9',9,arc);}
 c.restore();
}
function whirlwind(c,e,t){
 const p=clamp(t/.92),spin=ease(t/.72)*Math.PI*3,fade=clamp(t/.07)*Math.pow(1-p, .8),r=Math.max(1,finite(e.range,78)),a=finite(e.angle)+spin;
 c.save();c.translate(finite(e.x),finite(e.y));c.globalAlpha*=fade;
 for(let i=0;i<3;i++){const tip=a-i*2.1;const radius=r*(.93-i*.13);crescent(c,radius,tip-1.65,1.65,8-i*1.5,i===1?'#7fd5cb':'#b4a5ea',.48);crescent(c,radius,tip-.88,.88,3,i===1?'#d4fff0':'#e4d9ff',.95);}
 for(let i=0;i<14;i++){const b=i*TAU/14+spin*.65,rr=r*(.78+(i%3)*.065);c.save();c.globalAlpha*=.35+.5*((i%4)/3);c.translate(Math.round(Math.cos(b)*rr),Math.round(Math.sin(b)*rr));c.rotate(b);c.fillStyle=i%2?'#bda7e7':'#8bdbce';c.fillRect(-2,-1,4+(i%3),2);c.restore();}
 c.restore();
}
function heavy(c,e,t,actor){
 const w=Math.max(.01,finite(e.windup,.35)),a=finite(e.angle),r=Math.max(1,finite(e.range,96)),arc=Math.min(Math.PI*.8,finite(e.arc,1.4));
 const before=t<w,locked=Number.isFinite(e.impactAt)&&!before,x=locked?finite(e.impactX,e.x):before?finite(actor.x):finite(e.x),y=locked?finite(e.impactY,e.y):before?finite(actor.y):finite(e.y);
 c.save();c.translate(x,y);
 if(before){const q=clamp(t/w);c.globalAlpha*=.25+.6*q;
  for(const side of [-1,1]){const b=a+side*arc*.5;line(c,'#a87b42',Math.cos(b)*r*.37,Math.sin(b)*r*.37,Math.cos(b)*r,Math.sin(b)*r);}
  crescent(c,r,a-arc*.5,arc,2,'#c89651',.5);line(c,'#f6d18a',Math.cos(a)*19,Math.sin(a)*19,Math.cos(a)*(22+q*22),Math.sin(a)*(22+q*22),2);
  for(let i=0;i<5;i++){const b=a+2+i*.39,rr=34*(1-q)+15;pixel(c,'#ffd895',Math.cos(b)*rr,Math.sin(b)*rr,2);}
 }else{const age=t-w,q=clamp(age/.24),fade=Math.pow(clamp((1.05-t)/.46),1.3),head=a-arc*.5+arc*ease(q);c.globalAlpha*=fade;
  crescent(c,r*.96,a-arc*.5,Math.max(.03,arc*ease(q)),13,'#b76435',.7);
  crescent(c,r*.94,a-arc*.5,Math.max(.03,arc*ease(q)),7,'#f5b35f',.9);
  crescent(c,r*.93,head-Math.min(arc*.42,.58),Math.min(arc*.42,.58),3,'#fff0ba',1);
  line(c,'#fff1bc',Math.cos(head)*22,Math.sin(head)*22,Math.cos(head)*r*.94,Math.sin(head)*r*.94,age<.24?3:1);
  c.globalAlpha*=clamp((.68-age)/.55);particles(c,r,a,age,'#f0a45d',13,arc);
 }c.restore();
}
function actionAngle(action,t){
 const a=finite(action.angle),arc=finite(action.arc,1.5),w=finite(action.windup),active=Math.max(.001,finite(action.active,.08));
 if(action.kind==='whirlwind')return a+ease(t/.64)*Math.PI*3;
 if(action.kind==='lunge')return a-.7+1.4*ease(t/.26);
 if(action.kind==='heavySlash')return t<w?a-arc*.5-.3*clamp(t/w):a-arc*.5+arc*ease((t-w)/.24);
 if(t<w)return a-arc*.5*ease(t/Math.max(w,.001));
 const hit=clamp((t-w)/Math.max(.13,active));
 return t<w+Math.max(.13,active)?a-arc*.5+arc*ease(hit):a+arc*.5*(1-ease((t-w-Math.max(.13,active))/Math.max(.001,finite(action.recovery,.2))));
}
export function drawMeleeVisuals(c,actor,renderTime,{timeOffset=0}={}){
 let visible=false,pose=null;
 for(const e of (actor.meleeVisuals||[]).slice(-3)){const timing=MELEE_VISUAL_TIMING[e.kind];if(!timing)continue;const t=finite(renderTime)-finite(e.startedAt);if(t<0||t>=timing.duration)continue;visible=true;
  if(e.kind==='lunge')lunge(c,e,t);else if(e.kind==='whirlwind')whirlwind(c,e,t);else heavy(c,e,t,actor);
  if(t<timing.bodyDuration)pose=actionAngle(e,t);
 }
 const action=actor.meleeAction;
 if(action){const t=Math.max(0,finite(action.elapsed)+finite(timeOffset));pose=actionAngle(action,t);
  if(action.kind==='basic'){const w=finite(action.windup),age=t-w,r=Math.max(1,finite(action.range,68)),arc=finite(action.arc,1.5);if(age>=0){const q=ease(age/.16),fade=clamp(1-age/.34);c.save();c.translate(finite(actor.x),finite(actor.y));c.globalAlpha*=fade;crescent(c,r*.94,finite(action.angle)-arc*.5,arc*q,5,'#c7d5ae',.65);crescent(c,r*.93,finite(action.angle)-arc*.5,arc*q,2,'#fff0bf');c.restore();}}
 }
 if(!action&&!visible&&actor.isPlayer){const a=finite(actor.aimAngle),r=Math.max(1,finite(actor.attackRange,68));c.save();c.globalAlpha*=.5;pixel(c,'#e6bd79',finite(actor.x)+Math.cos(a)*r-1,finite(actor.y)+Math.sin(a)*r-1,2);c.restore();}
 return pose===null?finite(actor.aimAngle):pose;
}
export function drawMeleeImpact(c,e){
 const p=clamp(1-finite(e.ttl)/Math.max(.001,finite(e.maxTtl,.28)));if(p>=1)return;
 c.save();c.translate(finite(e.x),finite(e.y));c.globalAlpha*=Math.pow(1-p,1.2);
 for(let i=0;i<7;i++){const a=finite(e.angle)+(i-3)*.39+(i%2)*.23,r=2+p*(12+i%3*5),len=(1-p)*(4+i%3*2);line(c,i%3===0?'#fff4cf':e.color||'#eccb8d',Math.cos(a)*r,Math.sin(a)*r,Math.cos(a)*(r+len),Math.sin(a)*(r+len),i%3===0?2:1);pixel(c,'#fff0c4',Math.cos(a)*(r+len),Math.sin(a)*(r+len),i%2+1);}
 c.restore();
}
