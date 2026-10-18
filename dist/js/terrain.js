// Procedural biome artwork only: terrain never changes collision or hazard timing.
const THEMES={desert:{ground:'#665a48',tiles:['#675b48','#685c49','#655a47','#695c49'],dark:'#3e3933',mid:'#897257',light:'#baa07a',edge:'#d3b58a'},frost:{ground:'#829ca5',tiles:['#849ea7','#869fa8','#819ba5','#88a1a8'],dark:'#405f74',mid:'#7499b0',light:'#bdd6dc',edge:'#e2e9dd'},swamp:{ground:'#24443f',tiles:['#26463f','#27463f','#24443e','#284740'],dark:'#132f32',mid:'#3f6250',light:'#668060',edge:'#8f9b69'}};
export const terrainBiome=map=>Object.hasOwn(THEMES,map?.biome)?map.biome:'courtyard';
const rect=(c,col,x,y,w,h)=>{c.fillStyle=col;c.fillRect(Math.round(x),Math.round(y),Math.max(0,w),Math.max(0,h));};
function oval(c,col,x,y,rx,ry){c.fillStyle=col;rx=Math.max(1,rx);ry=Math.max(1,ry);for(let yy=-ry;yy<ry;yy+=3){const half=Math.floor(rx*Math.sqrt(Math.max(0,1-Math.pow((yy+1)/ry,2)))/2)*2;c.fillRect(Math.round(x-half),Math.round(y+yy),half*2,3);}}
function path(c,col,points,width=1){c.strokeStyle=col;c.lineWidth=width;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(Math.round(x),Math.round(y)):c.moveTo(Math.round(x),Math.round(y)));c.stroke();}
export function bakeBiome(c,map,rng){
 const id=terrainBiome(map),p=THEMES[id];if(!p)return false;
 rect(c,p.ground,0,0,map.width,map.height);
 for(let y=0;y<map.height;y+=32)for(let x=0;x<map.width;x+=32)rect(c,p.tiles[Math.floor(rng()*4)],x,y,32,32);
 // Large quiet terrain forms and fine details are both baked once.
 for(let i=0;i<1050;i++){
  const x=Math.floor(rng()*map.width/2)*2,y=Math.floor(rng()*map.height/2)*2,s=12+rng()*30;
  if(id==='desert'){
   for(let k=0;k<3;k++)path(c,k===0?'#817057':'#74644e',[[x,y+k*6],[x+s*.3,y-2+k*6],[x+s*.7,y+2+k*6],[x+s,y+k*6]],1);
   if(i%7===0){rect(c,'#49473e',x,y,5,3);rect(c,'#99866a',x,y-1,4,1);}
  }else if(id==='frost'){
   oval(c,i%3?'#a5bbc0':'#6c8c9c',x,y,s,s*.36);
   if(i%3===0){path(c,'#496e86',[[x-s*.8,y],[x-4,y+2],[x+3,y-4],[x+s*.7,y-1]],2);path(c,'#c0d3d6',[[x-4,y+4],[x+4,y-2],[x+s*.7,y+1]]);}
   else {rect(c,'#c8d6d4',x-s*.5,y-2,s*.7,2);rect(c,'#b4c9ca',x+s*.3,y+3,7,2);}
  }else{
   oval(c,i%3?'#294f46':'#1b3c3d',x,y,s,s*.5);
   if(i%4===0){path(c,'#49634a',[[x-s,y+4],[x-6,y-1],[x+2,y+5],[x+s,y+8]],3);path(c,'#6c7951',[[x-s,y+3],[x-6,y-2],[x+2,y+4]],1);}
  }
 }
 for(let i=0;i<4600;i++){const x=rng()*map.width,y=rng()*map.height;
  if(id==='desert'){rect(c,i%4?'#938063':'#45453d',x,y,1+i%3,1);if(i%19===0){rect(c,'#bba581',x,y,6,2);rect(c,'#524c3e',x+2,y+2,5,1);}}
  else if(id==='frost'){rect(c,i%4?'#b0c4c7':'#66889a',x,y,2,1);if(i%29===0){rect(c,'#d8e2dc',x,y,9,2);rect(c,'#a7bfc6',x-2,y+2,13,2);}}
  else{rect(c,i%3?'#42694f':'#627b53',x,y,2,3+i%5);if(i%4===0)rect(c,'#335e4d',x-2,y+2,5,2);if(i%37===0){rect(c,'#a08d72',x,y,4,2);rect(c,'#655a59',x+1,y+2,2,3);}}
 }
 // A distinct central landmark is a floor marking, never an invisible obstacle.
 const cx=map.width/2,cy=map.height/2;
 for(let i=0;i<24;i++){const a=i*Math.PI/12,r=126;rect(c,p.mid,cx+Math.cos(a)*r-3,cy+Math.sin(a)*r-2,6,4);}
 for(const t of map.traps){
  if(t.type==='mud'){
   oval(c,id==='desert'?'#87704b':id==='frost'?'#7795a3':'#47604a',t.x,t.y,t.r+5,t.r*.76+3);
   oval(c,id==='desert'?'#61543d':id==='frost'?'#bfcece':'#163b38',t.x,t.y,t.r,t.r*.72);
   for(let k=0;k<8;k++){const a=k*Math.PI/4,rr=t.r*(.3+.05*(k%3));path(c,id==='desert'?'#a98b58':id==='frost'?'#e1e6dc':'#58764f',[[t.x+Math.cos(a)*rr-6,t.y+Math.sin(a)*rr*.7],[t.x+Math.cos(a)*rr+6,t.y+Math.sin(a)*rr*.7+1]],1);}
   if(id==='swamp')for(let k=0;k<5;k++){const a=k*1.7;oval(c,'#4f7852',t.x+Math.cos(a)*t.r*.72,t.y+Math.sin(a)*t.r*.5,4,2);}
  }else{
   rect(c,p.dark,t.x-t.r,t.y-t.r,t.r*2,t.r*2);
   rect(c,p.mid,t.x-t.r,t.y-t.r,t.r*2,2);
   for(let x=-t.r+4;x<t.r;x+=10)for(let y=-t.r+4;y<t.r;y+=10){rect(c,id==='desert'?'#272c2b':id==='frost'?'#294c64':'#102b2a',t.x+x,t.y+y,5,4);rect(c,p.light,t.x+x,t.y+y,4,1);}
  }
 }
 return true;
}
export function drawBiomeObstacle(c,o,id){
 const p=THEMES[id];if(!p)return false;const {x,y,w,h}=o,rock=o.kind==='rock';
 oval(c,'#10232a55',x+w/2+4,y+h+3,w*.6,8);
 if(id==='desert'){
  // Broad mineral facets and sparse broken seams avoid a regular brick pattern.
  rect(c,'#494238',x+2,y-7,w-2,h+8);rect(c,p.mid,x,y-9,w,h+8);
  c.fillStyle='#a58b66';c.beginPath();c.moveTo(x,y-7);c.lineTo(x+w*.35,y-12);c.lineTo(x+w*.42,y+h*.2);c.lineTo(x+w*.25,y+h*.43);c.lineTo(x+w*.31,y+h*.8);c.lineTo(x+3,y+h-2);c.closePath();c.fill();
  c.fillStyle='#6b5944';c.beginPath();c.moveTo(x+w*.7,y-8);c.lineTo(x+w,y-4);c.lineTo(x+w,y+h);c.lineTo(x+w*.58,y+h);c.lineTo(x+w*.66,y+h*.57);c.lineTo(x+w*.57,y+h*.3);c.closePath();c.fill();
  c.fillStyle=p.light;c.beginPath();c.moveTo(x+3,y-9);c.lineTo(x+9,y-15);c.lineTo(x+w*.42,y-15);c.lineTo(x+w*.48,y-12);c.lineTo(x+w-8,y-14);c.lineTo(x+w-2,y-8);c.lineTo(x+w*.62,y-5);c.lineTo(x+w*.33,y-7);c.closePath();c.fill();
  path(c,'#d0b38a',[[x+9,y-15],[x+w*.4,y-15],[x+w*.47,y-12]],2);
  const seams=Math.max(2,Math.min(5,Math.floor(h/28)));
  for(let k=0;k<seams;k++){const q=(k+1)/(seams+1),xx=x+w*(.14+((k*7)%11)/24),yy=y+h*q,len=w*(.18+(k%3)*.055);path(c,'#645440',[[xx,yy],[xx+len*.46,yy+2],[xx+len,yy-1]],2);path(c,'#a68c67',[[xx+2,yy+3],[xx+len*.47,yy+4]],1);if(k%2===0)path(c,'#6b5944',[[xx+len*.46,yy+2],[xx+len*.4,yy+8],[xx+len*.54,yy+13]],1);}
  // Small chips sit inside the footprint, preserving a readable solid edge.
  rect(c,'#584b3a',x,y+h*.32,3,7);rect(c,'#b49870',x+3,y+h*.32+7,4,2);
  rect(c,'#584b3a',x+w-4,y+h*.68,4,5);rect(c,'#9f835f',x+w-7,y+h*.68+5,4,2);
  if(!rock){path(c,'#65513e',[[x+w*.54,y-4],[x+w*.5,y+h*.18],[x+w*.6,y+h*.29]],2);}
 }else if(id==='frost'){
  rect(c,p.dark,x,y-9,w,h+9);rect(c,p.mid,x+2,y-14,w-4,h+10);rect(c,'#9cbecb',x+3,y-14,w*.46,h+5);rect(c,p.light,x,y-17,w,6);rect(c,p.edge,x+3,y-19,w-6,4);
  for(let k=0;k<Math.max(1,Math.floor(w/22));k++){const xx=x+7+k*22;path(c,'#416b88',[[xx,y-10],[xx+5,y+2],[xx+1,y+9],[xx+8,y+h-3]],2);path(c,'#c4dee0',[[xx+2,y-10],[xx+7,y+2],[xx+3,y+9]],1);rect(c,'#dcebe4',xx,y-13,2,6);}
  for(let xx=x+5;xx<x+w-3;xx+=13){rect(c,'#b9d7dd',xx,y-10,3,7+(Math.floor(xx)%5));rect(c,'#edf1e6',xx,y-10,1,5);}
  oval(c,'#b2c5c7',x+w*.75,y+h+1,w*.33,4);rect(c,'#d1ded9',x+w*.55,y+h-2,w*.36,2);
 }else{
  rect(c,'#182f2d',x,y-9,w,h+11);rect(c,rock?'#3b5850':'#3c4b3a',x+2,y-15,w-4,h+14);rect(c,'#657357',x+3,y-17,w-6,4);rect(c,'#52674b',x,y-13,w*.3,h+8);rect(c,'#273f36',x+w*.65,y-10,w*.35,h+8);
  for(let xx=x+6;xx<x+w;xx+=12){path(c,'#25382b',[[xx,y-11],[xx-2,y+2],[xx+3,y+h],[xx+8,y+h+5]],3);path(c,'#73805a',[[xx+1,y-10],[xx,y+1],[xx+5,y+h]],1);}
  for(let xx=x+2;xx<x+w-2;xx+=7){const hh=4+Math.abs(Math.floor(xx))%9;rect(c,'#527a4d',xx,y-17,6,hh);rect(c,'#81915e',xx,y-17,4,2);}
  path(c,'#6a7350',[[x+4,y+h-1],[x-7,y+h+4],[x-14,y+h+3]],3);path(c,'#6a7350',[[x+w-4,y+h-1],[x+w+8,y+h+5],[x+w+14,y+h+2]],3);
 }
 return true;
}
export function drawBiomeSpike(c,t,time,id){
 if(!THEMES[id])return false;const phase=(time+t.offset)%4;if(phase<2.1)return true;const up=phase>=2.8;
 c.save();const warning=id==='frost'?'#efb686':id==='swamp'?'#f0c46e':'#ffb36b';
 c.globalAlpha=up?.4:.22+.12*Math.sin(time*18);rect(c,warning,t.x-t.r,t.y-t.r,t.r*2,t.r*2);c.globalAlpha=up?.95:.75;
 c.strokeStyle=warning;c.lineWidth=1;c.setLineDash(up?[]:[3,3]);c.strokeRect(t.x-t.r+.5,t.y-t.r+.5,t.r*2-1,t.r*2-1);c.setLineDash([]);
 for(let x=-t.r+4;x<t.r-2;x+=10)for(let y=-t.r+4;y<t.r-2;y+=10){const px=t.x+x,py=t.y+y;if(!up){rect(c,warning,px,py,4,2);continue;}
  if(id==='desert'){rect(c,'#9a4934',px-1,py-4,6,10);rect(c,'#ef9c4f',px,py-7,4,10);rect(c,'#ffe3a0',px+1,py-4,2,6);rect(c,'#f5bf73',px+2,py-10-(Math.floor(time*9+x+y)%3),1,3);}
  else if(id==='frost'){path(c,'#83bfd5',[[px-2,py+4],[px+1,py-9],[px+5,py+4]],3);path(c,'#e0f2e9',[[px+1,py-8],[px+1,py+2]],1);}
  else{path(c,'#5d8650',[[px-2,py+5],[px+2,py-5],[px,py-9]],3);path(c,'#cad38d',[[px+2,py-5],[px+6,py-7]],2);rect(c,'#a2b874',px,py-9,2,3);}
 }c.restore();return true;
}
export function drawBiomeAmbient(c,id,time,left,top,w,h){
 if(!THEMES[id])return false;c.save();
 for(let i=0;i<(id==='frost'?32:20);i++){const speed=id==='desert'?17:id==='frost'?5:2,x=left+((i*149+time*speed)%w+w)%w,y=top+((i*91+time*(id==='frost'?10:-3))%h+h)%h;c.globalAlpha=id==='swamp'?.12+.14*(1+Math.sin(i+time*1.8)):.13+(i%3)*.045;
  rect(c,id==='desert'?'#d2b180':id==='frost'?'#e1efea':'#c7d795',x,y,id==='desert'?4:1+i%2,1+i%2);
 }c.restore();return true;
}
