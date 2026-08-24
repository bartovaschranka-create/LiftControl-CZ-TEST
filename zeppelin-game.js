(function installCinematicZeppelinMission(){
  'use strict';

  const title = document.querySelector('header .header-title');
  const wrap = document.getElementById('zeppelinGame');
  const canvas = document.getElementById('zeppelinCanvas');
  const startPane = document.getElementById('zeppelinStartPane');
  const startBtn = document.getElementById('zeppelinStartBtn');
  const closeBtn = document.getElementById('zeppelinCloseBtn');
  const soundBtn = document.getElementById('zeppelinSoundBtn');
  const scoreEl = document.getElementById('zeppelinScore');
  const livesEl = document.getElementById('zeppelinLives');
  const timeEl = document.getElementById('zeppelinTime');
  const phaseEl = document.getElementById('zeppelinPhase');
  const bossFillEl = document.getElementById('zeppelinBossFill');
  const resultEl = document.getElementById('zeppelinResult');
  if(!title || !wrap || !canvas || !startPane || !startBtn) return;

  const ctx = canvas.getContext('2d');
  const MISSION_SECONDS = 75;
  const BOSS_MAX = 180;
  const BEST_KEY = 'liftcontrol_zeppelin_cinematic_best_v1';
  const sprites = {
    zeppelin:new Image(),
    bomb:new Image(),
    prague:new Image()
  };
  const keyedSprites={zeppelin:null,bomb:null};
  sprites.zeppelin.decoding='async';
  sprites.bomb.decoding='async';
  sprites.prague.decoding='async';
  sprites.zeppelin.addEventListener('load',()=>{keyedSprites.zeppelin=removeNeutralBackdrop(sprites.zeppelin);});
  sprites.bomb.addEventListener('load',()=>{keyedSprites.bomb=removeNeutralBackdrop(sprites.bomb);});
  sprites.zeppelin.src='./assets/game/zeppelin-cinematic-v2.png';
  sprites.bomb.src='./assets/game/bomb-cinematic-v2.png';
  sprites.prague.src='./assets/game/prague-night-cinematic-v2.png';
  const landmarkBlueprints = [
    {name:'Hrad', fx:.18},
    {name:'Karlův most', fx:.42},
    {name:'Petřín', fx:.68},
    {name:'Žižkov', fx:.85}
  ];

  let w = 390, h = 720, dpr = 1, raf = 0, last = 0;
  let taps = 0, tapTimer = 0, state = 'idle', muted = false;
  let score = 0, timeLeft = MISSION_SECONDS, elapsed = 0, phase = 1;
  let introTime = 0, outroTime = 0, phaseBanner = 0, phaseChanged = false;
  let bombs = [], particles = [], smoke = [], stars = [], rain = [], landmarks = [];
  let aimX = w*.5, aimY = h*.34, zeppelinX = w*.18, zeppelinDir = 1;
  let bombTimer = 1.2, screenShake = 0, flash = 0, destroyed = 0, spawned = 0;
  let engines = [], bossDefeated = false, audioCtx = null;

  function cityY(){ return h - Math.max(150,Math.min(205,h*.23)); }
  function turret(){ return {x:w*.5,y:h-42}; }
  function zeppelinScale(){ return Math.min(1,Math.max(.62,w/450)); }
  function zeppelinDimensions(){ const width=Math.min(340,Math.max(270,w*.82)); return {width,height:width*.608}; }
  function zeppelinY(){ return Math.max(150,Math.min(188,h*.21)) + Math.sin(performance.now()/680)*5; }
  function landmarkX(l){ return l.fx*w; }
  function totalLandmarkHealth(){ return landmarks.reduce((sum,l)=>sum+l.health,0); }

  function removeNeutralBackdrop(img){
    try{
      const out=document.createElement('canvas'),ow=img.naturalWidth,oh=img.naturalHeight,total=ow*oh;
      out.width=ow;out.height=oh;
      const outCtx=out.getContext('2d',{willReadFrequently:true});outCtx.drawImage(img,0,0);
      const frame=outCtx.getImageData(0,0,ow,oh),pixels=frame.data,seen=new Uint8Array(total),stack=new Int32Array(total);let top=0;
      const isBackdrop=(idx)=>{const p=idx*4,r=pixels[p],g=pixels[p+1],b=pixels[p+2],hi=Math.max(r,g,b),lo=Math.min(r,g,b);return hi-lo<24&&(r+g+b)/3>202;};
      const add=(idx)=>{if(idx<0||idx>=total||seen[idx]||!isBackdrop(idx))return;seen[idx]=1;stack[top++]=idx;};
      for(let x=0;x<ow;x++){add(x);add((oh-1)*ow+x);}
      for(let y=1;y<oh-1;y++){add(y*ow);add(y*ow+ow-1);}
      while(top){const idx=stack[--top],x=idx%ow;pixels[idx*4+3]=0;if(x>0)add(idx-1);if(x<ow-1)add(idx+1);if(idx>=ow)add(idx-ow);if(idx<total-ow)add(idx+ow);}
      outCtx.putImageData(frame,0,0);return out;
    }catch(e){console.warn('Sprite background extraction failed',e);return null;}
  }

  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1,2);
    w = Math.max(320,window.innerWidth || 390);
    h = Math.max(520,window.innerHeight || 720);
    canvas.width = Math.floor(w*dpr);
    canvas.height = Math.floor(h*dpr);
    canvas.style.width = w+'px';
    canvas.style.height = h+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    aimX = Math.max(24,Math.min(w-24,aimX || w*.5));
    aimY = Math.max(80,Math.min(cityY()-55,aimY || h*.34));
    stars = Array.from({length:90},(_,i)=>({
      x:(i*97+29)%w,
      y:28+((i*59)%Math.max(180,h*.62)),
      r:i%9===0?1.7:.75+(i%3)*.2,
      a:.35+(i%6)*.1
    }));
    rain = Array.from({length:70},(_,i)=>({x:(i*71+13)%w,y:(i*43)%h,len:8+(i%5)*3,speed:260+(i%7)*28}));
  }

  function resetMission(){
    resize();
    state = 'cinematic'; score = 0; timeLeft = MISSION_SECONDS; elapsed = 0; phase = 1;
    introTime = 0; outroTime = 0; phaseBanner = 2.4; phaseChanged = false;
    bombs = []; particles = []; smoke = []; screenShake = 0; flash = 0;
    destroyed = 0; spawned = 0; bossDefeated = false; bombTimer = 1.15;
    landmarks = landmarkBlueprints.map(l=>({...l,health:3,hit:0}));
    engines = [{name:'Levý motor',hp:90,max:90,localX:-.24},{name:'Pravý motor',hp:90,max:90,localX:.28}];
    zeppelinX = w+220; zeppelinDir = -1;
    aimX = w*.5; aimY = h*.34;
    wrap.classList.add('playing');
    wrap.classList.remove('boss-fight');
    startPane.querySelector('h3').textContent = 'Praha volá o pomoc';
    startPane.querySelector('p').textContent = 'Veď světlomet prstem nebo myší. Chraň čtyři pražské památky a v závěru udrž paprsek na motorech Zeppelinu.';
    resultEl.textContent = '';
    startBtn.textContent = 'Spustit noční hlídku';
    updateHud();
    playSiren();
  }

  function updateHud(){
    const phaseNames = ['Noc 1 · Poplach','Noc 1 · Těžký nálet','Finále · Motory Zeppelinu'];
    scoreEl.textContent = 'Skóre '+score;
    livesEl.textContent = 'Památky '+totalLandmarkHealth()+'/12';
    timeEl.textContent = Math.ceil(Math.max(0,timeLeft))+' s';
    phaseEl.textContent = state==='cinematic' ? 'Noc 1 · Poplach' : phaseNames[phase-1];
    const bossHealth = engines.reduce((sum,e)=>sum+Math.max(0,e.hp),0);
    bossFillEl.style.width = Math.max(0,bossHealth/BOSS_MAX*100)+'%';
  }

  function openGame(){
    wrap.classList.add('show');
    wrap.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    resize();
    draw();
    startLoop();
  }

  function closeGame(){
    state = 'idle';
    cancelAnimationFrame(raf);
    wrap.classList.remove('show','playing','boss-fight');
    wrap.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }

  function startLoop(){
    cancelAnimationFrame(raf);
    last = 0;
    raf = requestAnimationFrame(loop);
  }

  function setAim(ev){
    if(ev.target && ev.target.closest && ev.target.closest('button')) return;
    aimX = Math.max(20,Math.min(w-20,ev.clientX || aimX));
    aimY = Math.max(72,Math.min(cityY()-42,ev.clientY || aimY));
    if(state==='cinematic' && introTime>1.1) introTime = 4.6;
    ev.preventDefault();
  }

  function initAudio(){
    if(audioCtx) { audioCtx.resume?.(); return; }
    try{ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ audioCtx = null; }
  }

  function tone(freq,duration,type='sine',volume=.035,endFreq=freq){
    if(muted || !audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq,now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30,endFreq),now+duration);
    gain.gain.setValueAtTime(.0001,now);
    gain.gain.exponentialRampToValueAtTime(volume,now+.02);
    gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now); osc.stop(now+duration+.03);
  }

  function playSiren(){
    tone(330,1.15,'sawtooth',.018,620);
    setTimeout(()=>{ if(state==='cinematic') tone(620,1.15,'sawtooth',.016,330); },1050);
  }
  function playShot(){ tone(720,.09,'square',.018,1160); }
  function playExplosion(heavy=false){ tone(heavy?105:155,heavy?.42:.24,'sawtooth',heavy?.055:.033,42); }
  function haptic(ms){ try{ navigator.vibrate?.(ms); }catch(e){} }

  function distToBeam(px,py){
    const a = turret(), vx = aimX-a.x, vy = aimY-a.y, wx = px-a.x, wy = py-a.y;
    const c = Math.max(0,Math.min(1,(wx*vx+wy*vy)/Math.max(1,vx*vx+vy*vy)));
    return Math.hypot(px-(a.x+vx*c),py-(a.y+vy*c));
  }

  function addParticles(x,y,color,count=20,power=170){
    for(let i=0;i<count;i++){
      const a=Math.random()*Math.PI*2, speed=35+Math.random()*power;
      particles.push({x,y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,life:.45+Math.random()*.55,max:1,color,size:1.5+Math.random()*4});
    }
  }

  function addSmoke(x,y,count=5){
    for(let i=0;i<count;i++) smoke.push({x:x+(Math.random()-.5)*10,y:y+(Math.random()-.5)*8,vx:(Math.random()-.5)*13,vy:-16-Math.random()*22,life:1.2+Math.random()*1.2,max:2.4,r:6+Math.random()*10});
  }

  function chooseTarget(){
    const alive = landmarks.map((l,i)=>({l,i})).filter(o=>o.l.health>0);
    return alive.length ? alive[Math.floor(Math.random()*alive.length)].i : Math.floor(Math.random()*landmarks.length);
  }

  function spawnBomb(){
    const target = chooseTarget();
    const typeRoll = Math.random();
    const type = phase===1 ? (typeRoll<.82?'normal':'heavy') : (typeRoll<.48?'fast':typeRoll<.78?'normal':'heavy');
    const travel = type==='fast' ? 2.85 : type==='heavy' ? 5.2 : 4.05;
    const ship=zeppelinDimensions();
    const x = zeppelinX+(Math.random()-.5)*ship.width*.42;
    const y = zeppelinY()+ship.height*.24;
    const targetX = landmarkX(landmarks[target])+(Math.random()-.5)*26;
    bombs.push({x,y,vx:(targetX-x)/travel,vy:type==='fast'?96:60,type,target,spin:0,exposure:0,hit:false});
    spawned++;
  }

  function enginePoints(){
    const ship=zeppelinDimensions();
    const facing=zeppelinDir>=0 ? 1 : -1;
    const y=zeppelinY()+ship.height*.19;
    return engines.map(e=>({x:zeppelinX+e.localX*ship.width*facing,y,engine:e}));
  }

  function changePhase(next){
    if(phase===next) return;
    phase = next; phaseBanner = 2.5; phaseChanged = true;
    if(phase===2){ flash=.34; tone(210,.7,'sawtooth',.025,390); }
    if(phase===3){ wrap.classList.add('boss-fight'); bombs=[]; bombTimer=1.2; tone(135,1.1,'sawtooth',.035,70); }
    updateHud();
  }

  function updateBombs(dt){
    bombs.forEach(b=>{
      b.x += b.vx*dt; b.y += b.vy*dt; b.vy += (b.type==='heavy'?16:11)*dt; b.spin += dt*(b.type==='fast'?8:4);
      const threshold = b.type==='fast'?.11:b.type==='heavy'?.30:.18;
      if(distToBeam(b.x,b.y)<(b.type==='heavy'?39:32) && b.y<cityY()-4){
        b.exposure += dt;
        if(b.exposure>=threshold){
          b.hit=true; destroyed++; score += b.type==='heavy'?30:b.type==='fast'?20:15;
          addParticles(b.x,b.y,b.type==='heavy'?'#fbbf24':'#dbeafe',b.type==='heavy'?34:23,b.type==='heavy'?230:170);
          addSmoke(b.x,b.y,b.type==='heavy'?6:3); playExplosion(b.type==='heavy');
        }
      } else b.exposure=Math.max(0,b.exposure-dt*.8);
      if(!b.hit && b.y>=cityY()-12){
        b.hit=true;
        const target = landmarks[b.target];
        if(target && target.health>0){ target.health--; target.hit=.7; }
        screenShake=Math.max(screenShake,b.type==='heavy'?13:8); flash=.22;
        addParticles(b.x,cityY()-16,'#ff9d45',b.type==='heavy'?42:29,240);
        addSmoke(b.x,cityY()-20,10); playExplosion(true); haptic(35);
      }
    });
    bombs = bombs.filter(b=>!b.hit && b.y<h+50);
  }

  function updateBoss(dt){
    enginePoints().forEach(p=>{
      if(p.engine.hp<=0) return;
      if(distToBeam(p.x,p.y)<30){
        p.engine.hp=Math.max(0,p.engine.hp-dt*34);
        score += Math.random()<dt*8 ? 2 : 0;
        if(Math.random()<dt*18) addParticles(p.x,p.y,'#fde68a',2,75);
        if(Math.random()<dt*5) playShot();
        if(p.engine.hp<=0){
          addParticles(p.x,p.y,'#fb923c',52,270); addSmoke(p.x,p.y,18);
          screenShake=14; flash=.35; score+=150; playExplosion(true); haptic(55);
        }
      }
    });
    if(engines.every(e=>e.hp<=0) && !bossDefeated){
      bossDefeated=true; state='victory'; outroTime=0; bombs=[]; score+=Math.ceil(timeLeft)*5;
      tone(392,.35,'square',.025,523); setTimeout(()=>tone(523,.55,'square',.025,784),280);
    }
  }

  function updateAmbient(dt){
    particles.forEach(p=>{ p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=105*dt; p.life-=dt; });
    particles=particles.filter(p=>p.life>0);
    smoke.forEach(s=>{ s.x+=s.vx*dt; s.y+=s.vy*dt; s.life-=dt; s.r+=dt*7; });
    smoke=smoke.filter(s=>s.life>0);
    rain.forEach(r=>{ r.y+=r.speed*dt; r.x-=r.speed*.18*dt; if(r.y>h+20){r.y=-20;r.x=Math.random()*w;} if(r.x<0)r.x=w; });
    landmarks.forEach(l=>{ l.hit=Math.max(0,l.hit-dt); });
    screenShake=Math.max(0,screenShake-dt*25); flash=Math.max(0,flash-dt*1.7); phaseBanner=Math.max(0,phaseBanner-dt);
  }

  function finishMission(won,reason=''){
    state='result'; wrap.classList.remove('playing','boss-fight');
    const hp=totalLandmarkHealth(), saved=Math.round(hp/12*100);
    const accuracy=spawned?Math.min(100,Math.round(destroyed/spawned*100)):0;
    const starsCount=won ? 1+(hp>=7?1:0)+(hp>=10&&timeLeft>=8?1:0) : 0;
    let best=0; try{ best=Number(localStorage.getItem(BEST_KEY)||0); if(score>best)localStorage.setItem(BEST_KEY,String(score)); }catch(e){}
    startPane.querySelector('h3').textContent=won?'Praha je ubráněna':'Praha padla do tmy';
    startPane.querySelector('p').textContent=won
      ? `Zachráněno ${saved} % památek · přesnost ${accuracy} % · skóre ${score}${Math.max(best,score)===score?' · nový rekord':''}`
      : `${reason||'Zeppelin prolomil obranu.'} Skóre ${score} · zničeno bomb ${destroyed}.`;
    resultEl.textContent=won?'★'.repeat(starsCount)+'☆'.repeat(3-starsCount):'Bez hodnocení';
    startBtn.textContent='Hrát misi znovu'; updateHud();
  }

  function update(dt){
    updateAmbient(dt);
    if(state==='cinematic'){
      introTime+=dt; zeppelinX=w+210-introTime*88;
      if(introTime>=4.8){ state='playing'; zeppelinX=Math.max(155,w*.18); zeppelinDir=1; phaseBanner=2.4; bombTimer=.8; }
      return;
    }
    if(state==='victory'){
      outroTime+=dt; zeppelinDir=1; zeppelinX+=dt*125; addSmoke(zeppelinX-zeppelinDimensions().width*.27,zeppelinY()+zeppelinDimensions().height*.18,1);
      if(outroTime>=2.8) finishMission(true);
      return;
    }
    if(state!=='playing') return;

    elapsed+=dt; timeLeft=Math.max(0,MISSION_SECONDS-elapsed);
    if(elapsed>=42) changePhase(3); else if(elapsed>=20) changePhase(2);
    zeppelinX+=zeppelinDir*(phase===3?22:phase===2?43:31)*dt;
    const margin=Math.min(172,w*.38);
    if(zeppelinX>w-margin){zeppelinX=w-margin;zeppelinDir=-1;}
    if(zeppelinX<margin){zeppelinX=margin;zeppelinDir=1;}

    bombTimer-=dt;
    const interval=phase===1?1.35:phase===2?.72:1.18;
    if(bombTimer<=0){ spawnBomb(); bombTimer=interval*(.82+Math.random()*.38); }
    updateBombs(dt);
    if(phase===3) updateBoss(dt);
    if(totalLandmarkHealth()<=0) finishMission(false,'Všechny čtyři památky byly zasaženy.');
    else if(timeLeft<=0) finishMission(false,'Motory Zeppelinu zůstaly v chodu.');
    updateHud();
  }

  function drawSky(){
    const storm=phase>=2 || state==='victory';
    if(sprites.prague.complete && sprites.prague.naturalWidth){
      ctx.drawImage(sprites.prague,0,0,w,h);
    }else{
      const g=ctx.createLinearGradient(0,0,0,h);
      g.addColorStop(0,'#071124');g.addColorStop(.55,'#0b294e');g.addColorStop(1,'#020611');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    }
    const mood=ctx.createLinearGradient(0,0,0,h);
    mood.addColorStop(0,storm?'rgba(2,8,22,.30)':'rgba(4,15,36,.06)');mood.addColorStop(.58,'rgba(0,8,24,.04)');mood.addColorStop(1,'rgba(0,2,10,.22)');
    ctx.fillStyle=mood;ctx.fillRect(0,0,w,h);
    if(storm){ ctx.globalAlpha=.28;ctx.strokeStyle='#9cc8ed';ctx.lineWidth=1;rain.forEach(r=>{ctx.beginPath();ctx.moveTo(r.x,r.y);ctx.lineTo(r.x-r.len*.22,r.y+r.len);ctx.stroke();});ctx.globalAlpha=1; }
  }

  function drawSearchlights(){
    const top=phase===3?zeppelinY()+18:h*.25;
    [[w*.08,top,w*.29],[w*.92,top,w*.71]].forEach((v,i)=>{
      const sway=Math.sin(performance.now()/950+i*2.2)*w*.12;
      const grd=ctx.createLinearGradient(v[0],cityY(),v[2]+sway,top);
      grd.addColorStop(0,'rgba(190,224,255,.26)');grd.addColorStop(1,'rgba(190,224,255,0)');
      ctx.strokeStyle=grd;ctx.lineWidth=22;ctx.beginPath();ctx.moveTo(v[0],cityY());ctx.lineTo(v[2]+sway,top);ctx.stroke();
    });
  }

  function drawPrague(){
    const damageY=[h*.70,h*.82,h*.69,h*.66];
    landmarks.forEach((l,i)=>{
      const x=landmarkX(l), damage=1-l.health/3;
      if(damage>0){
        const glow=ctx.createRadialGradient(x,damageY[i],2,x,damageY[i],35+damage*20);glow.addColorStop(0,`rgba(255,200,75,${.45*damage})`);glow.addColorStop(.5,`rgba(249,90,26,${.24*damage})`);glow.addColorStop(1,'rgba(249,90,26,0)');ctx.fillStyle=glow;ctx.fillRect(x-60,damageY[i]-60,120,120);
        for(let f=0;f<Math.ceil(damage*4);f++){const fx=x+(f-1.5)*7,fy=damageY[i]-f%2*7;ctx.fillStyle=f%2?'#f97316':'#fde047';ctx.beginPath();ctx.moveTo(fx-5,fy+14);ctx.quadraticCurveTo(fx,fy-13-Math.sin(performance.now()/120+f)*5,fx+6,fy+14);ctx.fill();}
        if(Math.random()<.13) addSmoke(x,damageY[i]-12,1);
      }
      const bw=Math.min(70,w*.18),bx=Math.max(3,Math.min(w-bw-3,x-bw/2)),by=h*.58;
      ctx.fillStyle='rgba(1,8,22,.76)';ctx.beginPath();ctx.roundRect(bx-3,by-16,bw+6,24,6);ctx.fill();
      ctx.fillStyle='rgba(0,0,0,.72)';ctx.fillRect(bx,by,bw,5);ctx.fillStyle=l.health>1?'#60a5fa':l.health?'#f59e0b':'#ef4444';ctx.fillRect(bx,by,bw*(l.health/3),5);
      ctx.fillStyle='#e0f2fe';ctx.font='800 9px Inter,Arial';ctx.textAlign='center';ctx.fillText(l.name,x,by-5);
    });
    ctx.textAlign='start';
  }

  function drawZeppelin(){
    const ship=zeppelinDimensions(),zy=zeppelinY(),facing=zeppelinDir>=0?1:-1;
    ctx.save();ctx.translate(zeppelinX,zy);ctx.scale(facing,1);
    ctx.shadowColor='rgba(108,190,255,.62)';ctx.shadowBlur=24;
    if(keyedSprites.zeppelin){
      ctx.drawImage(keyedSprites.zeppelin,-ship.width/2,-ship.height/2,ship.width,ship.height);
    }else{
      const fallback=ctx.createLinearGradient(-ship.width/2,0,ship.width/2,0);fallback.addColorStop(0,'#091b38');fallback.addColorStop(.45,'#b47818');fallback.addColorStop(1,'#f9d776');ctx.fillStyle=fallback;ctx.beginPath();ctx.ellipse(0,0,ship.width*.46,ship.height*.28,0,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
    if(phase===3 || state==='victory'){
      enginePoints().forEach(p=>{
        const ratio=Math.max(0,p.engine.hp/p.engine.max);
        if(ratio<=0 || state==='victory'){ addSmoke(p.x,p.y,1); return; }
        ctx.strokeStyle=ratio>.55?'#fcd34d':'#fb7185';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,15+Math.sin(performance.now()/160)*2,0,Math.PI*2);ctx.stroke();
        ctx.fillStyle='rgba(0,0,0,.65)';ctx.fillRect(p.x-18,p.y+20,36,4);ctx.fillStyle=ratio>.55?'#facc15':'#ef4444';ctx.fillRect(p.x-18,p.y+20,36*ratio,4);
        if(ratio<.55 && Math.random()<.12) addSmoke(p.x,p.y,1);
      });
    }
  }

  function drawBomb(b){
    const bw=b.type==='heavy'?34:b.type==='fast'?24:28,bh=b.type==='heavy'?68:b.type==='fast'?51:58;
    const angle=Math.atan2(b.vy,b.vx)-Math.PI/2+Math.sin(b.spin)*.045;
    ctx.save();ctx.translate(b.x,b.y);ctx.rotate(angle);ctx.shadowColor=b.type==='fast'?'#fb3d24':'#ffb347';ctx.shadowBlur=b.exposure>0?24:13;
    if(b.type==='fast')ctx.filter='hue-rotate(330deg) saturate(1.65) brightness(1.15)';
    else if(b.type==='heavy')ctx.filter='saturate(.92) brightness(.88)';
    if(keyedSprites.bomb){ctx.drawImage(keyedSprites.bomb,-bw/2,-bh*.64,bw,bh);}
    else{ctx.fillStyle='#111827';ctx.strokeStyle='#f59e0b';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,3,bw*.3,bh*.3,0,0,Math.PI*2);ctx.fill();ctx.stroke();}
    ctx.filter='none';ctx.restore();
  }

  function drawEffects(){
    smoke.forEach(s=>{ctx.globalAlpha=Math.max(0,s.life/s.max)*.46;ctx.fillStyle='#172033';ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();});ctx.globalAlpha=1;
    particles.forEach(p=>{ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();});ctx.globalAlpha=1;
  }

  function drawBeam(){
    if(state==='idle' || state==='result') return;
    const t=turret(), dx=aimX-t.x,dy=aimY-t.y,len=Math.max(1,Math.hypot(dx,dy)),nx=-dy/len,ny=dx/len,width=18;
    const glow=ctx.createLinearGradient(t.x,t.y,aimX,aimY);glow.addColorStop(0,'rgba(191,229,255,.12)');glow.addColorStop(1,'rgba(255,255,224,.48)');
    ctx.fillStyle=glow;ctx.beginPath();ctx.moveTo(t.x-5*nx,t.y-5*ny);ctx.lineTo(aimX+width*nx,aimY+width*ny);ctx.lineTo(aimX-width*nx,aimY-width*ny);ctx.closePath();ctx.fill();
    ctx.strokeStyle='rgba(238,248,255,.93)';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(t.x,t.y);ctx.lineTo(aimX,aimY);ctx.stroke();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(aimX,aimY,7+Math.sin(performance.now()/95)*2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#dbeafe';ctx.beginPath();ctx.arc(t.x,t.y,22,0,Math.PI*2);ctx.fill();ctx.fillStyle='#155eab';ctx.beginPath();ctx.arc(t.x,t.y,10,0,Math.PI*2);ctx.fill();
  }

  function drawCinematic(){
    if(state!=='cinematic' && state!=='victory') return;
    ctx.save();ctx.fillStyle='rgba(0,0,0,.72)';ctx.fillRect(0,0,w,Math.max(28,h*.08));ctx.fillRect(0,h-Math.max(28,h*.08),w,Math.max(28,h*.08));
    if(state==='cinematic'){
      const lines=introTime<1.65?['PRAHA · 23:47','NOC 1 — POPLACH']:introTime<3.35?['NEPŘÁTELSKÁ VZDUCHOLOĎ','CHRAŇTE PAMÁTKY']:['SVĚTLOMET PŘIPRAVEN','TAHEM ZAMĚŘUJETE'];
      const alpha=Math.min(1,introTime*2,Math.max(0,(4.8-introTime)*2));ctx.globalAlpha=alpha;ctx.textAlign='center';ctx.fillStyle='#dbeafe';ctx.font=`900 ${Math.min(24,w*.06)}px Inter,Arial`;ctx.fillText(lines[0],w/2,h*.43);ctx.fillStyle='#93c5fd';ctx.font=`800 ${Math.min(14,w*.035)}px Inter,Arial`;ctx.fillText(lines[1],w/2,h*.43+29);ctx.globalAlpha=1;
      ctx.fillStyle='rgba(255,255,255,.58)';ctx.font='700 10px Inter,Arial';ctx.fillText('Klepnutím přeskočíte',w/2,h*.82);
    }else{
      ctx.textAlign='center';ctx.fillStyle='#fde68a';ctx.font=`900 ${Math.min(25,w*.065)}px Inter,Arial`;ctx.fillText('MOTORY ZNIČENY',w/2,h*.43);ctx.fillStyle='#dbeafe';ctx.font='800 13px Inter,Arial';ctx.fillText('Zeppelin ustupuje nad Vltavu',w/2,h*.43+28);
    }
    ctx.restore();
  }

  function drawPhaseBanner(){
    if(phaseBanner<=0 || state!=='playing') return;
    const names=phase===1?['FÁZE I','PRVNÍ NÁLET']:phase===2?['FÁZE II','TĚŽKÝ NÁLET']:['FINÁLE','ZNIČTE OBA MOTORY'];
    const alpha=Math.min(1,phaseBanner*2,(2.5-phaseBanner)*2);ctx.save();ctx.globalAlpha=Math.max(0,alpha);ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='900 12px Inter,Arial';ctx.fillText(names[0],w/2,h*.35);ctx.fillStyle='#93c5fd';ctx.font=`900 ${Math.min(22,w*.055)}px Inter,Arial`;ctx.fillText(names[1],w/2,h*.35+27);ctx.restore();
  }

  function draw(){
    ctx.save();
    if(screenShake>0)ctx.translate((Math.random()-.5)*screenShake,(Math.random()-.5)*screenShake);
    drawSky();drawSearchlights();drawZeppelin();bombs.forEach(drawBomb);drawPrague();drawEffects();drawBeam();drawPhaseBanner();drawCinematic();
    if(flash>0){ctx.fillStyle=`rgba(255,239,194,${flash})`;ctx.fillRect(0,0,w,h);}
    ctx.restore();
  }

  function loop(ts){
    if(!wrap.classList.contains('show')) return;
    const dt=Math.min(.034,((ts||0)-(last||ts||0))/1000||.016);last=ts||0;
    update(dt);draw();raf=requestAnimationFrame(loop);
  }

  title.addEventListener('click',()=>{
    clearTimeout(tapTimer);taps++;
    if(taps>=5){taps=0;openGame();return;}
    tapTimer=setTimeout(()=>{taps=0;},1400);
  });
  startBtn.addEventListener('click',()=>{initAudio();resetMission();startLoop();});
  closeBtn?.addEventListener('click',closeGame);
  soundBtn?.addEventListener('click',()=>{muted=!muted;soundBtn.textContent=muted?'×':'♪';soundBtn.setAttribute('aria-label',muted?'Zapnout zvuk':'Vypnout zvuk');if(!muted){initAudio();tone(660,.12,'sine',.025,880);}});
  wrap.addEventListener('pointerdown',setAim,{passive:false});
  wrap.addEventListener('pointermove',ev=>{if(ev.pointerType==='mouse' || ev.buttons || ev.pointerType==='touch')setAim(ev);},{passive:false});
  window.addEventListener('resize',()=>{if(wrap.classList.contains('show'))resize();});
  document.addEventListener('keydown',ev=>{
    if(ev.key==='Escape'&&wrap.classList.contains('show'))closeGame();
    if(!wrap.classList.contains('show'))return;
    if(ev.key==='ArrowLeft')aimX=Math.max(20,aimX-24);
    if(ev.key==='ArrowRight')aimX=Math.min(w-20,aimX+24);
    if(ev.key==='ArrowUp')aimY=Math.max(72,aimY-24);
    if(ev.key==='ArrowDown')aimY=Math.min(cityY()-42,aimY+24);
  });
  resize();
})();
