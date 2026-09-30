export function drawLineChart(canvas, points){
  draw(canvas,points,"line");
}
export function drawBarChart(canvas, points){
  draw(canvas,points,"bar");
}
function draw(canvas,points,type){
  const rect=canvas.getBoundingClientRect(), dpr=Math.min(devicePixelRatio||1,2);
  const w=Math.max(280,rect.width),h=Math.max(190,rect.height);
  canvas.width=w*dpr;canvas.height=h*dpr;
  const ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);
  const style=getComputedStyle(document.documentElement);
  const text=style.getPropertyValue("--text-faint").trim()||"#758195";
  const line=style.getPropertyValue("--line").trim()||"#e0e5eb";
  const accent=style.getPropertyValue("--accent").trim()||"#16a34a";
  const secondary=style.getPropertyValue("--secondary").trim()||"#3b82f6";
  const pad={l:36,r:12,t:18,b:34},cw=w-pad.l-pad.r,ch=h-pad.t-pad.b;
  const max=Math.max(1,...points.map(p=>Number(p.value)||0));
  ctx.font="10px Inter, sans-serif";ctx.fillStyle=text;ctx.strokeStyle=line;ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const y=pad.t+ch*(i/4);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillText(String(Math.round(max*(1-i/4))),4,y+3)}
  const step=cw/Math.max(points.length,1);
  if(type==="bar"){
    points.forEach((p,i)=>{const value=Number(p.value)||0,bh=ch*(value/max),x=pad.l+i*step+step*.18,y=pad.t+ch-bh;
      const g=ctx.createLinearGradient(0,y,0,pad.t+ch);g.addColorStop(0,accent);g.addColorStop(1,secondary);ctx.fillStyle=g;ctx.fillRect(x,y,Math.max(3,step*.64),bh);
    });
  }else{
    ctx.beginPath();points.forEach((p,i)=>{const x=pad.l+i*(cw/Math.max(points.length-1,1)),y=pad.t+ch-ch*((Number(p.value)||0)/max);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.strokeStyle=accent;ctx.lineWidth=2.3;ctx.stroke();
    points.forEach((p,i)=>{const x=pad.l+i*(cw/Math.max(points.length-1,1)),y=pad.t+ch-ch*((Number(p.value)||0)/max);ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle=accent;ctx.fill()});
  }
  const every=Math.max(1,Math.ceil(points.length/6));ctx.fillStyle=text;ctx.textAlign="center";
  points.forEach((p,i)=>{if(i%every&&i!==points.length-1)return;const x=type==="bar"?pad.l+i*step+step/2:pad.l+i*(cw/Math.max(points.length-1,1));ctx.fillText(String(p.label).replace(" 20"," "),x,h-11)});
  ctx.textAlign="start";
}
