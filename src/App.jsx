import React,{useState,useEffect,useRef,useCallback}from"react";
import{LineChart,Line,XAxis,YAxis,Tooltip,ResponsiveContainer,ReferenceLine}from"recharts";
const M="'Space Mono',monospace",CS="'Barlow Condensed',sans-serif";
const S={bg:"#020617",bg1:"#0f172a",bg2:"#0c1f3a",bd:"1px solid #1e293b",bd2:"1px solid #334155",t1:"#f1f5f9",t2:"#94a3b8",t3:"#64748b",t4:"#475569",t5:"#334155",acc:"#38bdf8",g:"#22c55e",r:"#ef4444",y:"#f59e0b",p:"#a78bfa",o:"#fb923c",cy:"#06b6d4",tl:"#0ea5e9"};
const inp={background:S.bg,border:S.bd2,borderRadius:4,color:S.acc,fontFamily:M,fontSize:11,padding:"5px 8px",outline:"none"};
const lbl={fontSize:9,color:S.t4,letterSpacing:1,marginBottom:3,display:"block",textTransform:"uppercase"};
const box={padding:12,background:S.bg,borderRadius:5,border:S.bd};
const DU=[
  {id:"ED",name:"Emergency Dept",licensed:30,surge:40,losHours:8,baseOcc:0.85,mortalityRate:0.002,color:S.y,isMorgue:false,isORC:false},
  {id:"OR",name:"Operating Room",licensed:10,surge:14,losHours:4,baseOcc:0.70,mortalityRate:0.005,color:"#6366f1",isMorgue:false,isORC:false},
  {id:"PACU",name:"PACU",licensed:12,surge:16,losHours:2,baseOcc:0.75,mortalityRate:0.001,color:"#8b5cf6",isMorgue:false,isORC:false},
  {id:"ICU",name:"ICU",licensed:20,surge:26,losHours:120,baseOcc:0.80,mortalityRate:0.040,color:S.r,isMorgue:false,isORC:false},
  {id:"StepDown",name:"Step-Down/PCU",licensed:18,surge:24,losHours:72,baseOcc:0.78,mortalityRate:0.010,color:"#f97316",isMorgue:false,isORC:false},
  {id:"Ward",name:"Med-Surg Ward",licensed:60,surge:80,losHours:120,baseOcc:0.82,mortalityRate:0.008,color:S.g,isMorgue:false,isORC:false},
  {id:"ORC",name:"Offsite Recovery",licensed:200,surge:200,losHours:96,baseOcc:0.00,mortalityRate:0.002,color:S.tl,isMorgue:false,isORC:true},
  {id:"AirField",name:"Air Field Hold",licensed:90,surge:90,losHours:4,baseOcc:0.00,mortalityRate:0.001,color:S.cy,isMorgue:false,isORC:false},
  {id:"Burn",name:"Burn Center",licensed:10,surge:14,losHours:400,baseOcc:0.65,mortalityRate:0.060,color:S.o,isMorgue:false,isORC:false},
  {id:"Morgue",name:"Morgue",licensed:20,surge:40,losHours:168,baseOcc:0.00,mortalityRate:0.000,color:S.t4,isMorgue:true,isORC:false},
];
const DA=[
  {id:"ED",name:"ED Walk-in",basePerDay:180,admitRate:0.22,fracCrit:0.05,fracHigh:0.15,fracMod:0.35},
  {id:"Outpt",name:"Outpatient",basePerDay:40,admitRate:0.15,fracCrit:0.02,fracHigh:0.18,fracMod:0.50},
  {id:"Xfer",name:"Transfer In",basePerDay:10,admitRate:0.60,fracCrit:0.20,fracHigh:0.40,fracMod:0.30},
];
const DP={surgeTrigger:0.80,divTrigger:0.90,offloadRatePerDay:10,partnerCapacity:50};
const MCI=[
  {label:"Baseline",fracCrit:0.05,fracHigh:0.15,fracMod:0.35,mortalityMod:1.0,burnFrac:0.02,volMod:1.0},
  {label:"Minor MCI",fracCrit:0.15,fracHigh:0.25,fracMod:0.35,mortalityMod:1.5,burnFrac:0.08,volMod:1.0},
  {label:"Moderate MCI",fracCrit:0.30,fracHigh:0.30,fracMod:0.25,mortalityMod:2.0,burnFrac:0.15,volMod:1.0},
  {label:"Major MCI",fracCrit:0.50,fracHigh:0.25,fracMod:0.15,mortalityMod:3.0,burnFrac:0.25,volMod:1.1},
  {label:"Catastrophic",fracCrit:0.65,fracHigh:0.20,fracMod:0.10,mortalityMod:4.0,burnFrac:0.35,volMod:1.2},
];
const DS={onHandDays:4,warehouseDays:14,leadTimeDays:7,baseDailyConsumption:1.0};
const DCK={chalkSize:36,chalkIntervalHours:8,mskFrac:0.50,burnFrac:0.10};
const rng0=s=>{let x=s;return()=>{x|=0;x=x+0x6D2B79F5|0;let t=Math.imul(x^x>>>15,1|x);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};};
const poi=(l,r)=>{if(l<=0)return 0;if(l>30)return Math.max(0,Math.round(l+Math.sqrt(l)*(r()*2-1)*1.2));const L=Math.exp(-l);let k=0,p=1;do{k++;p*=r();}while(p>L);return k-1;};
const los=(h,r)=>{const sig=Math.sqrt(Math.log(1.25)),mu=Math.log(Math.max(0.1,h))-0.5*sig*sig,u1=Math.max(1e-10,r()),u2=r(),z=Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);return Math.max(0.1,Math.exp(mu+sig*z));};
const acuity=(fc,fh,fm,r)=>{const x=r();return x<fc?"critical":x<fc+fh?"high":x<fc+fh+fm?"moderate":"low";};
const addEv=(s,t,m)=>s.events.push({type:t,msg:m,time:s.t});
const relBed=(u,pid)=>{const b=u.beds.find(b=>b.patientId===pid);if(b){b.occupied=false;b.patientId=null;b.acuity=null;}u.census=Math.max(0,u.census-1);u.waiting=Math.max(0,u.waiting-1);};
const admitBed=(s,pid,uid)=>{const p=s.pts[pid],u=s.units[uid];if(!p||!u)return;const b=u.beds.find(b=>!b.occupied);if(b){b.occupied=true;b.patientId=pid;b.acuity=p.acuity;}u.census++;p.state="inBed";s.dAdm++;};

function admitPt(s,pid){
  const p=s.pts[pid];if(!p)return;
  const u=s.units[p.cur],cfg=u?.config;if(!u)return;
  const ST=s.sc.surgeTrigger??0.80,DT=s.sc.divTrigger??0.90;
  const cap=u.surgeActive?cfg.surge:cfg.licensed;
  if(p.cur==="Ward"&&u.diversionActive){
    const orc=s.units["ORC"];
    if(orc&&orc.census<orc.config.surge){relBed(u,pid);p.cur="ORC";p.route=["ORC"];p.ri=0;p.losR=los(orc.config.losHours,s.rng);p.state="arriving";s.totORC++;addEv(s,"offload",`P${pid}→ORC`);admitBed(s,pid,"ORC");return;}
  }
  if(u.diversionActive&&!cfg.isMorgue&&!cfg.isORC){u.waiting++;p.state="waiting";return;}
  if(u.census<cap)admitBed(s,pid,p.cur);else{u.waiting++;p.state="waiting";}
}

function chalk(s,ck,mi){
  const n=ck.chalkSize;addEv(s,"surge",`✈ Chalk: ${n} pts`);
  const bn=Math.round(n*ck.burnFrac),mn2=Math.round(n*ck.mskFrac);
  for(let i=0;i<n;i++){
    const pid=s.nid++,isBurn=i<bn,isMsk=i>=bn&&i<bn+mn2;
    s.pts[pid]={id:pid,acuity:isMsk?"high":"critical",route:isBurn?["AirField","Burn"]:isMsk?["AirField"]:["AirField","OR","PACU","ICU","StepDown"],ri:0,cur:"AirField",losR:los(isMsk?72:4,s.rng),tt:0,state:"queued",arrAt:s.t+Math.floor(i/18),msk:isMsk};
    if(isMsk)s.totMSK++;if(isBurn)s.totBurn++;
  }
}

function logS(s,uid,u,type){
  const cfg=u.config,occ=u.census/Math.max(cfg.licensed,1),socc=u.census/Math.max(cfg.surge,1);
  s.slog.push({time:s.t,day:+(s.t/24).toFixed(2),unitId:uid,unitName:cfg.name,type,census:u.census,licensed:cfg.licensed,surge:cfg.surge,pL:Math.round(occ*100),pS:Math.round(socc*100)});
}

function snap(s,d){
  const tc=Object.values(s.units).filter(u=>!u.config.isMorgue).reduce((a,u)=>a+u.census,0);
  const us={};Object.entries(s.units).forEach(([id,u])=>{us[id]={census:u.census,pctSurge:Math.round(u.census/Math.max(u.config.surge,1)*100),div:u.diversionActive,surge:u.surgeActive};});
  return{day:d,tc,deaths:s.deaths,burn:s.totBurn,orc:s.totORC,msk:s.totMSK,onHand:+(s.sup.onHand??0).toFixed(1),wh:+(s.sup.warehouse??0).toFixed(1),surgeEv:s.slog.filter(e=>e.type==="SURGE_ACTIVATED").length,divEv:s.slog.filter(e=>e.type==="DIVERSION_TRIGGERED").length,growthEv:s.slog.filter(e=>e.type==="GROWTH_RECOMMENDED").length,units:us};
}

function createState(pol,uDefs,sup,ck){
  const rng=rng0(pol.seed??42),units={};
  uDefs.forEach(u=>{const base=(u.isMorgue||u.isORC||u.id==="AirField")?0:Math.round(u.licensed*u.baseOcc);units[u.id]={config:u,beds:Array.from({length:Math.max(u.surge,1)},(_,i)=>({id:i,occupied:i<base,patientId:i<base?-(i+1):null,acuity:i<base?"moderate":null})),census:base,waiting:0,surgeActive:false,diversionActive:false};});
  return{rng,t:0,nextDay:24,nid:1,pts:{},units,dAdm:0,dDis:0,deaths:0,totBurn:0,totORC:0,totMSK:0,events:[],slog:[],sc:{...pol},sup:{...sup,onHand:sup.onHandDays,warehouse:sup.warehouseDays,resupply:false,resupplyAt:null},ck:{...ck,nextAt:ck.chalkIntervalHours},snaps:{}};
}

function tick(state,dh,arr,mi,ck2,vols){
  const s=state,pre=MCI[mi??0];
  s.t+=dh;if(s.t>=s.nextDay){s.dAdm=0;s.dDis=0;s.nextDay+=24;}
  const ST=s.sc.surgeTrigger??0.80,DT=s.sc.divTrigger??0.90;
  if(s.t>=s.ck.nextAt&&ck2.chalkSize>0){chalk(s,ck2,mi);s.ck.nextAt=s.t+ck2.chalkIntervalHours;}
  Object.values(s.pts).forEach(p=>{if(p.state==="queued"&&p.arrAt<=s.t){p.state="arriving";const u=s.units["AirField"];if(u&&u.census<u.config.surge)admitBed(s,p.id,"AirField");else{if(u)u.waiting++;p.state="waiting";}}});
  arr.forEach(ch=>{
    const vol=(vols[ch.id]??ch.basePerDay)*(pre.volMod??1);
    const n=poi(vol*(dh/24),s.rng);
    for(let i=0;i<n;i++){
      if(s.rng()>(ch.admitRate??0.5))continue;
      const ac=acuity(pre.fracCrit,pre.fracHigh,pre.fracMod,s.rng);
      const route=ac==="low"?["ED"]:ac==="moderate"?["ED","Ward"]:ac==="high"?["ED","StepDown"]:["ED","OR","PACU","ICU","StepDown"];
      const pid=s.nid++,fu=route[0],uc=s.units[fu]?.config;
      s.pts[pid]={id:pid,acuity:ac,route,ri:0,cur:fu,losR:uc?los(uc.losHours,s.rng):4,tt:0,state:"arriving",channel:ch.id};
      admitPt(s,pid);
    }
  });
  const ready=[];
  Object.values(s.pts).forEach(p=>{p.tt+=dh;if(p.state==="inBed"){p.losR-=dh;if(p.losR<=0)ready.push(p.id);}});
  ready.forEach(pid=>{
    const p=s.pts[pid];if(!p)return;
    const u=s.units[p.cur],cfg=u?.config;
    if(cfg?.isMorgue){relBed(u,pid);delete s.pts[pid];return;}
    const mm=({low:0.1,moderate:0.5,high:1.0,critical:2.5}[p.acuity]??1)*(pre.mortalityMod??1);
    if(u&&s.rng()<(cfg.mortalityRate??0.01)*mm){
      relBed(u,pid);s.deaths++;addEv(s,"death",`P${pid} died in ${p.cur}`);
      const mg=s.units["Morgue"];
      if(mg&&mg.census<mg.config.surge){s.pts[pid]={id:pid,acuity:"critical",route:["Morgue"],ri:0,cur:"Morgue",losR:los(mg.config.losHours,s.rng),tt:0,state:"arriving",channel:"death"};const fb=mg.beds.find(b=>!b.occupied);if(fb){fb.occupied=true;fb.patientId=pid;fb.acuity="critical";}mg.census++;s.pts[pid].state="inBed";}
      return;
    }
    p.ri++;const nu=p.route[p.ri];
    if(u)relBed(u,pid);
    if(!nu){s.dDis++;delete s.pts[pid];}
    else{
      p.cur=nu;const nc=s.units[nu]?.config;p.losR=nc?los(nc.losHours,s.rng):4;p.state="arriving";
      if(nu==="Ward"&&s.units["Ward"]?.diversionActive){const orc=s.units["ORC"];if(orc&&orc.census<orc.config.surge){p.cur="ORC";p.route[p.ri]="ORC";p.losR=los(orc.config.losHours,s.rng);s.totORC++;addEv(s,"offload",`P${pid}→ORC`);admitBed(s,pid,"ORC");return;}}
      admitPt(s,pid);
    }
  });
  const tc=Object.values(s.units).filter(u=>!u.config.isMorgue).reduce((a,u)=>a+u.census,0);
  const cr=Object.values(s.pts).filter(p=>p.acuity==="critical"||p.acuity==="high").length;
  const burn2=(s.sup.baseDailyConsumption??1)*(pre.volMod??1)*(1+(cr/Math.max(tc,1))*0.5)*(tc/150)*(dh/24);
  if(s.sup.onHand>0)s.sup.onHand=Math.max(0,s.sup.onHand-burn2);else s.sup.warehouse=Math.max(0,(s.sup.warehouse??0)-burn2);
  if(!s.sup.resupply&&s.sup.onHand<(s.sup.leadTimeDays??7)){s.sup.resupply=true;s.sup.resupplyAt=s.t+(s.sup.leadTimeDays??7)*24;addEv(s,"supply","🚚 Resupply ordered");}
  if(s.sup.resupply&&s.sup.resupplyAt<=s.t){s.sup.onHand=Math.min(s.sup.onHandDays??4,(s.sup.onHand??0)+(s.sup.warehouseDays??14)*0.5);s.sup.resupply=false;s.sup.resupplyAt=null;addEv(s,"supply","✓ Resupply received");}
  Object.entries(s.units).forEach(([uid,u])=>{
    const cfg=u.config;if(cfg.isMorgue)return;
    const occ=u.census/Math.max(cfg.licensed,1),socc=u.census/Math.max(cfg.surge,1);
    const ws=u.surgeActive,wd=u.diversionActive;
    u.surgeActive=occ>=ST;u.diversionActive=socc>=DT;
    if(!ws&&u.surgeActive){addEv(s,"surge",`${uid} surge`);logS(s,uid,u,"SURGE_ACTIVATED");}
    if(ws&&!u.surgeActive)logS(s,uid,u,"SURGE_CLEARED");
    if(!wd&&u.diversionActive){addEv(s,"divert",`${uid} DIVERSION`);logS(s,uid,u,"DIVERSION_TRIGGERED");}
    if(wd&&!u.diversionActive){addEv(s,"clear",`${uid} div cleared`);logS(s,uid,u,"DIVERSION_CLEARED");}
  });
  const dc=Object.values(s.units).filter(u=>!u.config.isMorgue&&u.diversionActive).length;
  if(dc>=2){const last=s.slog[s.slog.length-1];if(!last||last.type!=="GROWTH_RECOMMENDED"||s.t-last.time>24)s.slog.push({time:s.t,day:+(s.t/24).toFixed(2),unitId:"SYS",unitName:"System",type:"GROWTH_RECOMMENDED",pS:null,note:`${dc} units diverting`});}
  [1,3,7,14,30].forEach(d=>{if(!s.snaps[d]&&s.t>=d*24)s.snaps[d]=snap(s,d);});
  if(s.events.length>100)s.events=s.events.slice(-100);
  if(s.slog.length>400)s.slog=s.slog.slice(-400);
  return s;
}

function BedGrid({unit,cfg}){
  const cols=Math.min(Math.ceil(Math.sqrt(Math.max(cfg.surge,1))),20);
  return <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:2,padding:4}}>
    {unit.beds.slice(0,cfg.surge).map((b,i)=>{const isL=i<cfg.licensed,ac=b.acuity==="critical"?S.r:b.acuity==="high"?"#f97316":b.acuity==="moderate"?"#eab308":S.g;return <div key={b.id} style={{width:7,height:7,borderRadius:1,background:b.occupied?(cfg.isMorgue?S.t4:ac):isL?"#1e293b":"#0a0f1a",border:`1px solid ${isL?"#1e293b":"#0a0f1a"}`}}/>;})}</div>;
}
function UnitCard({us}){
  const cfg=us.config,pct=cfg.surge>0?us.census/cfg.surge:0;
  const st=cfg.isMorgue?"MORGUE":cfg.isORC?"ORC":us.diversionActive?"DIVERT":us.surgeActive?"SURGE":"OK";
  const sc={DIVERT:S.r,SURGE:S.y,OK:S.g,MORGUE:S.t4,ORC:S.tl}[st];
  const bc=us.diversionActive?S.r:us.surgeActive?S.y:S.g;
  return <div style={{background:S.bg1,border:`1px solid ${us.diversionActive&&!cfg.isMorgue?"#ef444433":"#1e293b"}`,borderLeft:`3px solid ${cfg.color}`,borderRadius:6,padding:"9px 11px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
      <span style={{fontFamily:M,fontSize:9,color:S.t2,letterSpacing:1,textTransform:"uppercase"}}>{cfg.name}</span>
      <span style={{fontSize:8,fontFamily:M,color:sc,background:`${sc}18`,padding:"2px 5px",borderRadius:3,border:`1px solid ${sc}44`}}>{st}</span>
    </div>
    <div style={{display:"flex",gap:12,marginBottom:5,alignItems:"baseline"}}>
      <span style={{fontFamily:M,fontSize:20,fontWeight:700,color:cfg.isMorgue?S.t3:S.t1}}>{us.census}<span style={{fontSize:10,color:S.t4}}>/{cfg.surge}</span></span>
      {us.waiting>0&&!cfg.isMorgue&&<span style={{fontSize:9,color:S.y}}>Q:{us.waiting}</span>}
    </div>
    {!cfg.isMorgue&&<div style={{height:4,background:"#1e293b",borderRadius:2,marginBottom:5,overflow:"hidden"}}><div style={{height:"100%",borderRadius:2,width:`${Math.min(100,pct*100)}%`,background:bc,transition:"width 0.5s"}}/></div>}
    <BedGrid unit={us} cfg={cfg}/>
  </div>;
}
function EvLog({events}){
  const ref=useRef();useEffect(()=>{if(ref.current)ref.current.scrollTop=ref.current.scrollHeight;},[events]);
  const C={surge:S.y,divert:S.r,clear:S.g,admit:"#1e3a5f",discharge:"#064e3b",offload:S.p,death:"#dc2626",supply:S.cy};
  return <div ref={ref} style={{height:110,overflowY:"auto",fontFamily:M,fontSize:9,color:S.t3,lineHeight:1.8,scrollbarWidth:"thin"}}>{events.slice(-40).map((e,i)=><div key={i} style={{color:C[e.type]??S.t3}}><span style={{color:S.t5}}>[{(e.time/24).toFixed(2)}d] </span>{e.msg}</div>)}</div>;
}
const STCI={SURGE_ACTIVATED:{c:S.y,i:"⚡"},SURGE_CLEARED:{c:S.g,i:"✓"},DIVERSION_TRIGGERED:{c:S.r,i:"⛔"},DIVERSION_CLEARED:{c:S.g,i:"✓"},GROWTH_RECOMMENDED:{c:S.p,i:"📈"}};

function Panels({slog,deaths,uDefs,simState}){
  const [tab,setTab]=useState("log");
  return <div style={{background:S.bg1,border:S.bd,borderRadius:6,overflow:"hidden"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:S.bd,background:S.bg}}>
      <div><div style={{fontFamily:CS,fontSize:14,fontWeight:700,letterSpacing:2,color:S.t1,textTransform:"uppercase"}}>📋 Surge Tracking</div><div style={{fontSize:8,color:S.t4,marginTop:1}}>{slog.length} events · {deaths} deaths</div></div>
      <div style={{display:"flex",gap:4}}>{["log","capacity","summary"].map(t=><button key={t} onClick={()=>setTab(t)} style={{background:tab===t?S.bg2:"none",border:`1px solid ${tab===t?S.acc:S.t5}`,borderRadius:3,color:tab===t?S.acc:S.t4,fontFamily:M,fontSize:8,padding:"3px 8px",cursor:"pointer",textTransform:"uppercase"}}>{t}</button>)}</div>
    </div>
    {tab==="log"&&<div style={{maxHeight:280,overflowY:"auto",scrollbarWidth:"thin"}}>
      {[...slog].reverse().slice(0,80).map((e,i)=>{const tc=STCI[e.type]??{c:S.t3,i:"·"};return <div key={i} style={{display:"grid",gridTemplateColumns:"55px 90px 1fr",gap:5,padding:"5px 12px",borderBottom:`1px solid ${S.bg}`,background:i%2===0?S.bg:"transparent",alignItems:"start"}}>
        <span style={{fontFamily:M,fontSize:8,color:S.t4}}>D{e.day?.toFixed(1)}</span>
        <span style={{fontFamily:M,fontSize:8,color:tc.c}}>{tc.i} {e.unitId==="SYS"?"SYS":e.unitName}</span>
        <span style={{fontSize:8,color:S.t2}}>{e.note??""}{e.census!=null&&<span style={{color:S.t4}}> · {e.census}/{e.surge}</span>}</span>
      </div>;})}
    </div>}
    {tab==="capacity"&&<div style={{padding:12,maxHeight:320,overflowY:"auto"}}>
      {uDefs.filter(u=>!u.isMorgue).map(u=>{
        const us=simState.units[u.id];if(!us)return null;
        const pS=us.census/Math.max(u.surge,1),pL=us.census/Math.max(u.licensed,1);
        const st=pS>=0.90?"DIVERT":pS>=0.75?"SURGE":pL>=0.85?"NEAR":"OK";
        const c={DIVERT:S.r,SURGE:S.y,NEAR:"#fbbf24",OK:S.g}[st];
        return <div key={u.id} style={{display:"grid",gridTemplateColumns:"115px 50px 55px 70px 1fr",gap:5,alignItems:"center",padding:"5px 8px",borderRadius:4,background:S.bg,border:`1px solid ${c}22`,marginBottom:4}}>
          <span style={{fontFamily:M,fontSize:8,color:S.t2}}>{u.name}</span>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,fontWeight:700,color:S.t1,fontFamily:M}}>{us.census}/{u.licensed}</div><div style={{fontSize:7,color:S.t4}}>lic</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,fontWeight:700,color:c,fontFamily:M}}>{Math.round(pS*100)}%</div><div style={{fontSize:7,color:S.t4}}>surge</div></div>
          <span style={{fontFamily:M,fontSize:7,color:c,background:`${c}18`,padding:"2px 4px",borderRadius:3,textAlign:"center"}}>{st}</span>
          <span style={{fontSize:8,color:S.t3}}>{{DIVERT:"⛔ Expand now",SURGE:"⚡ Pre-position",NEAR:"⚠ Monitor",OK:"Normal"}[st]}</span>
        </div>;
      })}
    </div>}
    {tab==="summary"&&<div style={{padding:12}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7,marginBottom:10}}>
        {[["Deaths",deaths,S.r],["Surge Evts",slog.filter(e=>e.type==="SURGE_ACTIVATED").length,S.y],["Diversions",slog.filter(e=>e.type==="DIVERSION_TRIGGERED").length,S.r],["Growth Alerts",slog.filter(e=>e.type==="GROWTH_RECOMMENDED").length,S.p]].map(([l,v,c])=><div key={l} style={{textAlign:"center",padding:"7px 5px",background:S.bg,borderRadius:4,border:S.bd}}><div style={{fontSize:17,fontWeight:700,color:c,fontFamily:M}}>{v}</div><div style={{fontSize:8,color:S.t4,marginTop:2}}>{l}</div></div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(155px,1fr))",gap:5}}>
        {uDefs.filter(u=>!u.isMorgue).map(u=>{const sc=slog.filter(e=>e.unitId===u.id&&e.type==="SURGE_ACTIVATED").length,dc=slog.filter(e=>e.unitId===u.id&&e.type==="DIVERSION_TRIGGERED").length,pk=Math.max(0,...slog.filter(e=>e.unitId===u.id).map(e=>e.pS||0));return <div key={u.id} style={{padding:"7px 9px",background:S.bg,borderRadius:4,border:S.bd}}><div style={{display:"flex",alignItems:"center",gap:5,marginBottom:4}}><span style={{width:6,height:6,borderRadius:1,background:u.color,display:"inline-block"}}/><span style={{fontFamily:M,fontSize:8,color:S.t2,textTransform:"uppercase"}}>{u.name}</span></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:3}}>{[["Surge",sc,S.y],["Divert",dc,S.r],["Peak",pk>0?pk+"%":"—",pk>=90?S.r:pk>=75?S.y:S.t4]].map(([l,v,c])=><div key={l} style={{textAlign:"center"}}><div style={{fontSize:11,fontWeight:700,color:c,fontFamily:M}}>{v}</div><div style={{fontSize:7,color:S.t4}}>{l}</div></div>)}</div></div>;})}
      </div>
    </div>}
  </div>;
}

function SupBar({sup}){
  if(!sup)return null;
  const oh=sup.onHand??sup.onHandDays??4,wh=sup.warehouse??sup.warehouseDays??14,tot=oh+wh;
  const ohc=oh<1?S.r:oh<3?S.y:S.g;
  return <div style={{background:S.bg1,border:S.bd,borderRadius:6,padding:"10px 14px"}}>
    <div style={{fontSize:9,color:S.t4,letterSpacing:2,marginBottom:7}}>🏥 MED SUPPLY</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7,marginBottom:7}}>
      {[["On-Hand",`${oh.toFixed(1)}d`,ohc],["Warehouse",`${wh.toFixed(1)}d`,wh<3?S.r:S.g],["Lead Time",`${sup.leadTimeDays??7}d`,S.t3],["Status",sup.resupply?"ORDERED":"OK",sup.resupply?S.p:S.g]].map(([l,v,c])=><div key={l} style={{textAlign:"center",padding:"5px 3px",background:S.bg,borderRadius:4}}><div style={{fontSize:13,fontWeight:700,color:c,fontFamily:M}}>{v}</div><div style={{fontSize:8,color:S.t4,marginTop:1}}>{l}</div></div>)}
    </div>
    <div style={{height:5,background:"#1e293b",borderRadius:2,overflow:"hidden",display:"flex"}}>
      <div style={{height:"100%",width:`${(oh/Math.max(tot,1))*100}%`,background:ohc,transition:"width 0.5s"}}/>
      <div style={{height:"100%",width:`${(wh/Math.max(tot,1))*100}%`,background:"#1e4a3a"}}/>
    </div>
    {oh<1&&<div style={{marginTop:5,padding:"4px 8px",background:"#1a0000",border:`1px solid ${S.r}55`,borderRadius:3,fontSize:8,color:S.r}}>⛔ ON-HAND CRITICAL</div>}
  </div>;
}

function Report({snaps,uDefs,mi}){
  const days=[1,3,7,14,30],avail=days.filter(d=>snaps[d]);
  const [sel,setSel]=useState(null);
  useEffect(()=>{if(avail.length>0&&!sel)setSel(avail[avail.length-1]);},[avail.length]);
  const sn=sel?snaps[sel]:null;
  const fmt=s=>{if(!s)return"";return[`SURGE REPORT Day ${s.day}`,`MCI: ${MCI[mi]?.label}`,`Census:${s.tc} Deaths:${s.deaths} Burn:${s.burn} ORC:${s.orc} MSK:${s.msk}`,`Supply On-Hand:${s.onHand}d Warehouse:${s.wh}d`,`Surge:${s.surgeEv} Diversions:${s.divEv} Growth:${s.growthEv}`,``,...uDefs.filter(u=>!u.isMorgue).map(u=>{const us=s.units[u.id];if(!us)return"";return`${u.name}: ${us.census} (${us.pctSurge}%)${us.div?" [DIVERT]":us.surge?" [SURGE]":""}`;})].join('\n');};
  const dl=(ext,data,t)=>{const b=new Blob([data],{type:t});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=`surge_d${sel}.${ext}`;a.click();URL.revokeObjectURL(u);};
  return <div style={{background:S.bg1,border:S.bd,borderRadius:6,overflow:"hidden"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:S.bd,background:S.bg}}>
      <div style={{fontFamily:CS,fontSize:14,fontWeight:700,letterSpacing:2,color:S.t1,textTransform:"uppercase"}}>📊 Report</div>
      <div style={{display:"flex",gap:4}}>{days.map(d=><button key={d} onClick={()=>setSel(d)} disabled={!snaps[d]} style={{background:sel===d?S.bg2:"none",border:`1px solid ${sel===d?S.acc:snaps[d]?S.t5:"#1e293b"}`,borderRadius:3,color:sel===d?S.acc:snaps[d]?S.t3:"#2a3a4a",fontFamily:M,fontSize:8,padding:"3px 7px",cursor:snaps[d]?"pointer":"not-allowed"}}>D{d}</button>)}</div>
    </div>
    {!sn?<div style={{padding:24,textAlign:"center",color:S.t5,fontFamily:M,fontSize:9}}>Snapshots at Day 1,3,7,14,30</div>:
    <div style={{padding:12}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))",gap:6,marginBottom:10}}>
        {[["Census",sn.tc,S.acc],["Deaths",sn.deaths,S.r],["Burn",sn.burn,S.o],["ORC",sn.orc,S.tl],["MSK",sn.msk,S.cy],["Surge",sn.surgeEv,S.y],["Diversions",sn.divEv,S.r],["Supply",`${sn.onHand}d`,sn.onHand<2?S.r:S.g]].map(([l,v,c])=><div key={l} style={{textAlign:"center",padding:"7px 5px",background:S.bg,borderRadius:4,border:S.bd}}><div style={{fontSize:15,fontWeight:700,color:c,fontFamily:M}}>{v}</div><div style={{fontSize:8,color:S.t4,marginTop:2}}>{l}</div></div>)}
      </div>
      <div style={{marginBottom:10}}>
        {uDefs.filter(u=>!u.isMorgue).map(u=>{const us=sn.units[u.id];if(!us)return null;const bc=us.div?S.r:us.surge?S.y:S.g;return <div key={u.id} style={{display:"grid",gridTemplateColumns:"125px 1fr 42px 65px",gap:6,alignItems:"center",marginBottom:4}}><span style={{fontSize:8,color:S.t3}}>{u.name}</span><div style={{height:4,background:"#1e293b",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min(100,us.pctSurge)}%`,background:bc,borderRadius:2}}/></div><span style={{fontSize:9,color:bc,textAlign:"right",fontWeight:700}}>{us.pctSurge}%</span><span style={{fontSize:7,color:bc,background:`${bc}18`,padding:"1px 4px",borderRadius:3,textAlign:"center"}}>{us.div?"DIVERT":us.surge?"SURGE":"OK"}</span></div>;})}
      </div>
      <div style={{background:S.bg,borderRadius:3,border:S.bd,padding:8,marginBottom:8,fontFamily:M,fontSize:8,color:S.t3,whiteSpace:"pre",overflowX:"auto",maxHeight:130,overflowY:"auto"}}>{fmt(sn)}</div>
      <div style={{display:"flex",gap:6}}>
        <button onClick={()=>dl("txt",fmt(sn),"text/plain")} style={{flex:1,padding:"6px",borderRadius:3,background:S.bg2,border:`1px solid ${S.acc}`,color:S.acc,fontFamily:M,fontSize:9,cursor:"pointer"}}>⬇ .txt</button>
        <button onClick={()=>dl("json",JSON.stringify(sn,null,2),"application/json")} style={{flex:1,padding:"6px",borderRadius:3,background:S.bg1,border:S.bd2,color:S.t3,fontFamily:M,fontSize:9,cursor:"pointer"}}>⬇ .json</button>
        <button onClick={()=>navigator.clipboard?.writeText(fmt(sn))} style={{padding:"6px 10px",borderRadius:3,background:S.bg1,border:S.bd2,color:S.t3,fontFamily:M,fontSize:9,cursor:"pointer"}}>Copy</button>
      </div>
    </div>}
  </div>;
}

function Settings({uDefs,arr,pol,sup,ck,onSave,onClose}){
  const [tab,setTab]=useState("units");
  const [units,setU]=useState(uDefs.map(u=>({...u})));
  const [arr2,setA]=useState(arr.map(a=>({...a})));
  const [pol2,setP]=useState({...pol});
  const [sup2,setSup]=useState({...sup});
  const [ck2,setCk]=useState({...ck});
  const fRef=useRef();
  const su=(i,f,v)=>setU(p=>p.map((u,j)=>j===i?{...u,[f]:f==="name"?v:parseFloat(v)||0}:u));
  const sa=(i,f,v)=>setA(p=>p.map((a,j)=>j===i?{...a,[f]:parseFloat(v)||0}:a));
  const warns=arr2.map(a=>{const s=+(a.fracCrit+a.fracHigh+a.fracMod).toFixed(3);return s>1.001?`${a.name}: ${Math.round(s*100)}%`:null;}).filter(Boolean);
  const exJ=()=>{const d={units,arrivals:arr2,policy:pol2,supply:sup2,chalk:ck2};const b=new Blob([JSON.stringify(d,null,2)],{type:"application/json"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download="surge_config.json";a.click();URL.revokeObjectURL(u);};
  const imJ=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{const d=JSON.parse(ev.target.result);if(d.units)setU(d.units);if(d.arrivals)setA(d.arrivals);if(d.policy)setP(d.policy);if(d.supply)setSup(d.supply);if(d.chalk)setCk(d.chalk);}catch{alert("Invalid JSON");}};r.readAsText(f);};
  const N=(l,v,fn,mn,mx,st,pct)=><div style={box}><label style={{...lbl,color:S.t2,marginBottom:6}}>{l}</label><div style={{display:"flex",gap:5,alignItems:"center"}}><input type="number" min={mn} max={mx} step={st} value={pct?Math.round(v*100):v} onChange={e=>{let x=parseFloat(e.target.value)||0;fn(pct?x/100:x);}} style={{...inp,width:75}}/>{pct&&<span style={{color:S.t4,fontSize:11}}>%</span>}</div></div>;
  return <div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(2,6,23,0.95)",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{background:S.bg1,border:S.bd,borderRadius:8,width:"min(880px,96vw)",maxHeight:"90vh",display:"flex",flexDirection:"column"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 16px",borderBottom:S.bd,flexShrink:0}}>
        <div style={{fontFamily:CS,fontSize:17,fontWeight:800,letterSpacing:3,color:S.t1,textTransform:"uppercase"}}>⚙ Configuration</div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <input ref={fRef} type="file" accept=".json" onChange={imJ} style={{display:"none"}}/>
          <button onClick={()=>fRef.current.click()} style={{padding:"4px 9px",borderRadius:3,background:"none",border:S.bd2,color:S.t3,fontFamily:M,fontSize:9,cursor:"pointer"}}>⬆ Import</button>
          <button onClick={exJ} style={{padding:"4px 9px",borderRadius:3,background:"none",border:S.bd2,color:S.t3,fontFamily:M,fontSize:9,cursor:"pointer"}}>⬇ Export</button>
          <button onClick={onClose} style={{background:"none",border:"none",color:S.t4,cursor:"pointer",fontSize:20}}>✕</button>
        </div>
      </div>
      <div style={{display:"flex",borderBottom:S.bd,padding:"0 16px",flexShrink:0,overflowX:"auto"}}>
        {["units","arrivals","chalk","supply","policy"].map(t=><button key={t} onClick={()=>setTab(t)} style={{background:"none",border:"none",cursor:"pointer",fontFamily:M,fontSize:9,letterSpacing:1,textTransform:"uppercase",padding:"8px 11px",marginBottom:-1,color:tab===t?S.acc:S.t4,borderBottom:`2px solid ${tab===t?S.acc:"transparent"}`,whiteSpace:"nowrap"}}>{t}</button>)}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:16,scrollbarWidth:"thin"}}>
        {tab==="units"&&<table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr style={{borderBottom:S.bd}}>{["Unit","Licensed","Surge","LOS(h)","Occ%","Mort%"].map(h=><th key={h} style={{textAlign:"left",padding:"5px 6px",fontFamily:M,fontSize:8,color:S.t4,fontWeight:"normal"}}>{h}</th>)}</tr></thead><tbody>{units.map((u,i)=><tr key={u.id} style={{borderBottom:`1px solid ${S.bg}`}}><td style={{padding:"5px"}}><span style={{display:"inline-block",width:7,height:7,borderRadius:1,background:u.color,marginRight:6}}/><span style={{color:S.t2,fontFamily:M,fontSize:9}}>{u.name}</span></td>{["licensed","surge","losHours"].map(f=><td key={f} style={{padding:"3px 4px"}}><input type="number" value={u[f]} onChange={e=>su(i,f,e.target.value)} style={{...inp,width:58}}/></td>)}<td style={{padding:"3px 4px"}}>{!u.isMorgue?<input type="number" value={Math.round(u.baseOcc*100)} onChange={e=>su(i,"baseOcc",(parseFloat(e.target.value)||0)/100)} style={{...inp,width:48}}/>:<span style={{color:S.t5,fontSize:9}}>N/A</span>}</td><td style={{padding:"3px 4px"}}>{!u.isMorgue?<input type="number" value={(u.mortalityRate*100).toFixed(1)} onChange={e=>su(i,"mortalityRate",(parseFloat(e.target.value)||0)/100)} style={{...inp,width:48}}/>:<span style={{color:S.t5,fontSize:9}}>N/A</span>}</td></tr>)}</tbody></table>}
        {tab==="arrivals"&&<div>{warns.length>0&&<div style={{marginBottom:7,padding:"5px 9px",background:"#1a0000",border:`1px solid ${S.r}55`,borderRadius:4}}>{warns.map((w,i)=><div key={i} style={{fontSize:9,color:S.r}}>⚠ {w}</div>)}</div>}{arr2.map((a,i)=><div key={a.id} style={{marginBottom:10,...box}}><div style={{fontFamily:CS,fontSize:12,fontWeight:600,color:S.t2,letterSpacing:2,marginBottom:7,textTransform:"uppercase"}}>{a.name}</div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(90px,1fr))",gap:7}}>{[["Pts/day","basePerDay",0,2000,1,false],["Admit%","admitRate",0,100,1,true],["Crit%","fracCrit",0,100,1,true],["High%","fracHigh",0,100,1,true],["Mod%","fracMod",0,100,1,true]].map(([l,f,mn,mx,st,pct])=><div key={f}><label style={lbl}>{l}</label><input type="number" min={mn} max={mx} step={st} value={pct?Math.round(a[f]*100):a[f]} onChange={e=>sa(i,f,pct?(parseFloat(e.target.value)||0)/100:e.target.value)} style={{...inp,width:65}}/></div>)}<div><label style={lbl}>Low% (auto)</label><div style={{padding:"5px 7px",background:S.bg1,borderRadius:3,border:S.bd,fontFamily:M,fontSize:10,color:S.g}}>{Math.max(0,Math.round((1-a.fracCrit-a.fracHigh-a.fracMod)*100))}%</div></div></div></div>)}</div>}
        {tab==="chalk"&&<div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {N("Chalk Size (max 90)",ck2.chalkSize,v=>setCk(c=>({...c,chalkSize:v})),1,90,1,false)}
          {N("Interval (hours)",ck2.chalkIntervalHours,v=>setCk(c=>({...c,chalkIntervalHours:v})),1,72,1,false)}
          {N("MSK Hold %",ck2.mskFrac,v=>setCk(c=>({...c,mskFrac:v})),0,100,1,true)}
          {N("Burn Route %",ck2.burnFrac,v=>setCk(c=>({...c,burnFrac:v})),0,50,1,true)}
        </div><div style={{marginTop:9,...box}}><div style={{fontSize:8,color:S.t4,marginBottom:5}}>PREVIEW</div><div style={{display:"flex",gap:14}}>{[["MSK Hold",Math.round(ck2.chalkSize*ck2.mskFrac),S.cy],["→ Burn",Math.round(ck2.chalkSize*ck2.burnFrac),S.o],["→ Surgical",ck2.chalkSize-Math.round(ck2.chalkSize*ck2.mskFrac)-Math.round(ck2.chalkSize*ck2.burnFrac),"#6366f1"]].map(([l,v,c])=><div key={l} style={{textAlign:"center"}}><div style={{fontSize:15,fontWeight:700,color:c,fontFamily:M}}>{v}</div><div style={{fontSize:8,color:S.t4,marginTop:2}}>{l}</div></div>)}</div></div></div>}
        {tab==="supply"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {N("On-Hand Days",sup2.onHandDays,v=>setSup(p=>({...p,onHandDays:v})),0,30,0.5,false)}
          {N("Warehouse Days",sup2.warehouseDays,v=>setSup(p=>({...p,warehouseDays:v})),0,60,1,false)}
          {N("Lead Time Days",sup2.leadTimeDays,v=>setSup(p=>({...p,leadTimeDays:v})),1,30,1,false)}
          {N("Base Consumption",sup2.baseDailyConsumption,v=>setSup(p=>({...p,baseDailyConsumption:v})),0.1,5,0.1,false)}
        </div>}
        {tab==="policy"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {N("Surge Trigger",pol2.surgeTrigger,v=>setP(p=>({...p,surgeTrigger:v})),50,100,1,true)}
          {N("Diversion Trigger",pol2.divTrigger,v=>setP(p=>({...p,divTrigger:v})),50,100,1,true)}
          {N("Max Offload/Day",pol2.offloadRatePerDay,v=>setP(p=>({...p,offloadRatePerDay:v})),0,200,1,false)}
          {N("Partner Capacity",pol2.partnerCapacity,v=>setP(p=>({...p,partnerCapacity:v})),0,1000,1,false)}
        </div>}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",padding:"9px 16px",borderTop:S.bd,flexShrink:0}}>
        <button onClick={()=>{setU(DU.map(u=>({...u})));setA(DA.map(a=>({...a})));setP({...DP});setSup({...DS});setCk({...DCK});}} style={{background:"none",border:S.bd2,borderRadius:3,color:S.t4,fontFamily:M,fontSize:9,padding:"5px 11px",cursor:"pointer"}}>↺ Defaults</button>
        <div style={{display:"flex",gap:6}}>
          <button onClick={onClose} style={{background:"none",border:S.bd2,borderRadius:3,color:S.t4,fontFamily:M,fontSize:9,padding:"5px 11px",cursor:"pointer"}}>Cancel</button>
          <button onClick={()=>{if(!warns.length)onSave(units,arr2,pol2,sup2,ck2);}} disabled={!!warns.length} style={{background:warns.length?S.bg1:S.bg2,border:`1px solid ${warns.length?S.t5:S.acc}`,borderRadius:3,color:warns.length?S.t4:S.acc,fontFamily:M,fontSize:9,padding:"5px 16px",cursor:warns.length?"not-allowed":"pointer",fontWeight:700}}>✓ Save & Restart</button>
        </div>
      </div>
    </div>
  </div>;
}

const TTip=({active,payload})=>active&&payload?.length?<div style={{background:S.bg1,border:S.bd,padding:"6px 9px",borderRadius:4,fontFamily:M,fontSize:9}}>{payload.map(p=><div key={p.dataKey} style={{color:p.color}}>{p.dataKey}:{p.value}</div>)}</div>:null;

export default function App(){
  const [uDefs,setUD]=useState(DU.map(u=>({...u})));
  const [arr,setArr]=useState(DA.map(a=>({...a})));
  const [pol,setPol]=useState({...DP});
  const [sup,setSup]=useState({...DS});
  const [ck,setCk]=useState({...DCK});
  const [showSet,setSet]=useState(false);
  const [mi,setMi]=useState(0);
  const [running,setRun]=useState(false);
  const [speed,setSpeed]=useState(12);
  const [cd,setCd]=useState([]);
  const [vED,setVED]=useState(180);
  const [vOut,setVOut]=useState(40);
  const [vXf,setVXf]=useState(10);
  const [sim,setSim]=useState(()=>createState({...DP,seed:42},DU,DS,DCK));
  const sRef=useRef(sim);sRef.current=sim;
  const rafRef=useRef(null),ltRef=useRef(null);
  const arrRef=useRef(arr);arrRef.current=arr;
  const miRef=useRef(mi);miRef.current=mi;
  const ckRef=useRef(ck);ckRef.current=ck;
  const vRef=useRef({ED:vED,Outpt:vOut,Xfer:vXf});
  useEffect(()=>{vRef.current={ED:vED,Outpt:vOut,Xfer:vXf};},[vED,vOut,vXf]);
  const reset=useCallback((p,u,s,c)=>{const ns=createState({...(p??pol),seed:Math.floor(Math.random()*99999)},u??DU,s??DS,c??DCK);setSim(ns);sRef.current=ns;setCd([]);setRun(false);ltRef.current=null;},[pol]);
  const save=useCallback((nu,na,np,ns,nc)=>{setUD(nu);setArr(na);setPol(np);setSup(ns);setCk(nc);setSet(false);reset(np,nu,ns,nc);},[reset]);
  useEffect(()=>{
    if(!running){cancelAnimationFrame(rafRef.current);return;}
    const f=ts=>{
      if(ltRef.current===null)ltRef.current=ts;
      const rd=Math.min((ts-ltRef.current)/1000,0.2);ltRef.current=ts;
      const cur=sRef.current;
      const next=tick({...cur,units:JSON.parse(JSON.stringify(cur.units)),pts:{...cur.pts},events:[...cur.events],slog:[...cur.slog],sup:{...cur.sup},ck:{...cur.ck},snaps:{...cur.snaps}},rd*speed,arrRef.current,miRef.current,ckRef.current,vRef.current);
      sRef.current=next;setSim({...next});
      setCd(prev=>{const last=prev[prev.length-1];if(last&&Math.abs(last.day-next.t/24)<0.04)return prev;return[...prev.slice(-300),{day:parseFloat((next.t/24).toFixed(2)),ED:next.units.ED?.census??0,ICU:next.units.ICU?.census??0,Ward:next.units.Ward?.census??0,Burn:next.units.Burn?.census??0,ORC:next.units.ORC?.census??0,Air:next.units.AirField?.census??0,Total:Object.values(next.units).filter(u=>!u.config.isMorgue).reduce((a,u)=>a+u.census,0)}];});
      rafRef.current=requestAnimationFrame(f);
    };
    rafRef.current=requestAnimationFrame(f);
    return()=>cancelAnimationFrame(rafRef.current);
  },[running,speed]);
  const cU=uDefs.filter(u=>!u.isMorgue);
  const tL=cU.reduce((s,u)=>s+u.licensed,0),tS=cU.reduce((s,u)=>s+u.surge,0);
  const tC=Object.values(sim.units).filter(u=>!u.config.isMorgue).reduce((s,u)=>s+u.census,0);
  const anyD=cU.some(u=>sim.units[u.id]?.diversionActive),anyS=cU.some(u=>sim.units[u.id]?.surgeActive);
  const pre=MCI[mi];
  return <div style={{minHeight:"100vh",background:S.bg,fontFamily:M,color:"#e2e8f0"}}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Barlow+Condensed:wght@300;600;800&display=swap');*{box-sizing:border-box;margin:0;padding:0;}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#1e293b}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}input[type=range]{-webkit-appearance:none;height:3px;border-radius:2px;background:#1e293b;outline:none}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:11px;height:11px;border-radius:50%;background:#38bdf8;cursor:pointer}input[type=number]{-moz-appearance:textfield}input[type=number]::-webkit-inner-spin-button{opacity:.3}`}</style>
    {showSet&&<Settings uDefs={uDefs} arr={arr} pol={pol} sup={sup} ck={ck} onSave={save} onClose={()=>setSet(false)}/>}
    <div style={{borderBottom:S.bd,padding:"8px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",background:anyD?"#1a0000":S.bg,transition:"background 1s"}}>
      <div><div style={{fontFamily:CS,fontSize:19,fontWeight:800,letterSpacing:3,color:S.t1,textTransform:"uppercase"}}>Hospital Surge Command</div><div style={{fontSize:9,color:S.t4,letterSpacing:2,marginTop:1}}>CAPACITY MGMT · {pre.label.toUpperCase()}</div></div>
      <div style={{display:"flex",alignItems:"center",gap:9}}>
        <button onClick={()=>{setRun(false);setSet(true);}} style={{background:S.bg1,border:S.bd2,borderRadius:4,color:S.t2,fontFamily:M,fontSize:9,padding:"5px 11px",cursor:"pointer"}}>⚙ SETTINGS</button>
        <div style={{textAlign:"right"}}><div style={{fontSize:8,color:S.t4,letterSpacing:2,marginBottom:1}}>STATUS</div><div style={{fontFamily:CS,fontSize:15,fontWeight:600,color:anyD?S.r:anyS?S.y:S.g,letterSpacing:2,animation:anyD?"pulse 1s infinite":"none"}}>{anyD?"DIVERSION":anyS?"SURGE":"NORMAL"}</div></div>
        <div style={{textAlign:"right"}}><div style={{fontSize:8,color:S.t4,letterSpacing:2,marginBottom:1}}>SIM TIME</div><div style={{fontFamily:M,fontSize:12,color:S.acc}}>D{String(Math.floor(sim.t/24)).padStart(2,"0")} · {String(Math.floor(sim.t%24)).padStart(2,"0")}:{String(Math.floor((sim.t%1)*60)).padStart(2,"0")}</div></div>
        <div style={{textAlign:"right"}}><div style={{fontSize:8,color:S.t4,letterSpacing:2,marginBottom:1}}>CENSUS / DEATHS</div><div style={{fontSize:15,fontWeight:700,color:tC>tS*0.9?S.r:S.t1,fontFamily:M}}>{tC}<span style={{fontSize:9,color:S.t4}}>/{tS}</span><span style={{fontSize:9,color:S.r,marginLeft:6}}>☩{sim.deaths}</span></div></div>
      </div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"245px 1fr",height:"calc(100vh - 54px)"}}>
      <div style={{borderRight:S.bd,padding:11,overflowY:"auto",display:"flex",flexDirection:"column",gap:9,background:S.bg}}>
        <div>
          <div style={{fontSize:9,color:S.t4,letterSpacing:2,marginBottom:4}}>MCI SCENARIO</div>
          <div style={{fontSize:8,color:S.t5,marginBottom:5}}>Acuity shift, not volume</div>
          {MCI.map((sc,i)=><button key={i} onClick={()=>setMi(i)} style={{display:"block",width:"100%",textAlign:"left",padding:"5px 8px",marginBottom:2,borderRadius:4,background:mi===i?S.bg2:"transparent",border:`1px solid ${mi===i?S.acc:"#1e293b"}`,color:mi===i?S.acc:S.t3,fontFamily:M,fontSize:9,cursor:"pointer"}}><span style={{marginRight:5}}>{["●","◆","▲","★","⚠"][i]}</span>{sc.label}<span style={{float:"right",fontSize:8,color:S.t5}}>{Math.round(sc.fracCrit*100)}%crit</span></button>)}
          {mi>0&&<div style={{marginTop:4,padding:"4px 6px",background:"#0d0020",border:`1px solid ${S.p}44`,borderRadius:3,fontSize:8,color:S.p}}>Crit:{Math.round(pre.fracCrit*100)}% Burn:{Math.round(pre.burnFrac*100)}% Mort:{pre.mortalityMod}×</div>}
        </div>
        <div style={{borderTop:S.bd,paddingTop:9}}>
          <div style={{fontSize:9,color:S.t4,letterSpacing:2,marginBottom:6}}>DAILY VOLUME</div>
          {[["ED Walk-in",vED,setVED,0,800],["Outpatient",vOut,setVOut,0,400],["Transfers",vXf,setVXf,0,100]].map(([l,v,sv,mn,mx])=><div key={l} style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:9,color:S.t2}}>{l}</span><span style={{fontSize:10,color:S.acc,fontWeight:700,fontFamily:M}}>{v}</span></div><input type="range" min={mn} max={mx} step={1} value={v} onChange={e=>sv(parseInt(e.target.value))} style={{width:"100%"}}/></div>)}
        </div>
        <div style={{borderTop:S.bd,paddingTop:9}}>
          <div style={{fontSize:9,color:S.t4,letterSpacing:2,marginBottom:6}}>AIR CHALK</div>
          {[["Size",ck.chalkSize,v=>setCk(c=>({...c,chalkSize:v})),0,90],["Interval(h)",ck.chalkIntervalHours,v=>setCk(c=>({...c,chalkIntervalHours:v})),1,72]].map(([l,v,sv,mn,mx])=><div key={l} style={{marginBottom:7}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:9,color:S.t2}}>{l}</span><span style={{fontSize:10,color:S.cy,fontWeight:700,fontFamily:M}}>{v}</span></div><input type="range" min={mn} max={mx} step={1} value={v} onChange={e=>sv(parseInt(e.target.value))} style={{width:"100%"}}/></div>)}
          <div style={{fontSize:8,color:S.t5}}>MSK:{Math.round(ck.chalkSize*ck.mskFrac)} Burn:{Math.round(ck.chalkSize*ck.burnFrac)} Surg:{ck.chalkSize-Math.round(ck.chalkSize*ck.mskFrac)-Math.round(ck.chalkSize*ck.burnFrac)}</div>
        </div>
        <div style={{borderTop:S.bd,paddingTop:9}}>
          <div style={{fontSize:9,color:S.t4,letterSpacing:2,marginBottom:6}}>SIMULATION</div>
          <div style={{display:"flex",gap:5,marginBottom:8}}>
            <button onClick={()=>{ltRef.current=null;setRun(r=>!r);}} style={{flex:1,padding:"7px 0",borderRadius:4,cursor:"pointer",background:running?"#1a0a0a":S.bg2,border:`1px solid ${running?S.r:S.acc}`,color:running?S.r:S.acc,fontFamily:M,fontSize:10}}>{running?"⏸ PAUSE":"▶ RUN"}</button>
            <button onClick={()=>reset(pol,uDefs,sup,ck)} style={{padding:"7px 10px",borderRadius:4,cursor:"pointer",background:S.bg1,border:S.bd,color:S.t4,fontFamily:M,fontSize:10}}>↺</button>
          </div>
          <div><div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:9,color:S.t2}}>Speed</span><span style={{fontSize:9,color:S.acc}}>{speed<1?speed.toFixed(1):speed}h/s</span></div><input type="range" min={0.1} max={96} step={0.1} value={speed} onChange={e=>setSpeed(parseFloat(e.target.value))} style={{width:"100%"}}/><div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:S.t5,marginTop:1}}><span>0.1h/s</span><span>96h/s</span></div></div>
        </div>
        <div style={{borderTop:S.bd,paddingTop:9}}>
          <div style={{fontSize:9,color:S.t4,letterSpacing:2,marginBottom:5}}>TOTALS</div>
          {[["Admitted",sim.dAdm,S.acc],["Discharged",sim.dDis,S.g],["ORC Admits",sim.totORC,S.tl],["MSK Hold",sim.totMSK,S.cy],["Burn Admits",sim.totBurn,S.o],["Deaths",sim.deaths,S.r]].map(([l,v,c])=><div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:9,color:S.t4}}>{l}</span><span style={{fontSize:12,fontWeight:700,color:c,fontFamily:M}}>{v}</span></div>)}
        </div>
        <div style={{borderTop:S.bd,paddingTop:9,flex:1}}><div style={{fontSize:9,color:S.t4,letterSpacing:2,marginBottom:4}}>EVENT LOG</div><EvLog events={sim.events}/></div>
      </div>
      <div style={{overflowY:"auto",padding:11,display:"flex",flexDirection:"column",gap:9}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:7}}>{uDefs.filter(u=>!u.isMorgue).map(cfg=>sim.units[cfg.id]&&<UnitCard key={cfg.id} us={sim.units[cfg.id]}/>)}</div>
        {sim.units["Morgue"]&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:7}}><UnitCard us={sim.units["Morgue"]}/></div>}
        <SupBar sup={sim.sup}/>
        <Panels slog={sim.slog} deaths={sim.deaths} uDefs={uDefs} simState={sim}/>
        <Report snaps={sim.snaps} uDefs={uDefs} mi={mi}/>
        <div style={{background:S.bg1,border:S.bd,borderRadius:6,padding:11}}>
          <div style={{fontSize:9,color:S.t4,letterSpacing:2,marginBottom:6}}>CENSUS OVER TIME</div>
          <div style={{display:"flex",gap:9,marginBottom:6,flexWrap:"wrap"}}>{[["ED",S.y],["ICU",S.r],["Ward",S.g],["Burn",S.o],["ORC",S.tl],["Air",S.cy],["Total",S.acc]].map(([k,c])=><span key={k} style={{fontSize:8,color:c}}><span style={{display:"inline-block",width:9,height:2,background:c,marginRight:3,verticalAlign:"middle"}}/>{k}</span>)}</div>
          <ResponsiveContainer width="100%" height={145}>
            <LineChart data={cd} margin={{top:3,right:5,bottom:3,left:0}}>
              <XAxis dataKey="day" stroke="#1e293b" tick={{fill:S.t5,fontSize:8,fontFamily:"Space Mono"}} tickFormatter={v=>`D${Math.floor(v)}`}/>
              <YAxis stroke="#1e293b" tick={{fill:S.t5,fontSize:8,fontFamily:"Space Mono"}}/>
              <Tooltip content={<TTip/>}/>
              <ReferenceLine y={tL} stroke={S.t5} strokeDasharray="4 2"/>
              <ReferenceLine y={tS} stroke={S.t4} strokeDasharray="4 2"/>
              {[["ED",S.y],["ICU",S.r],["Ward",S.g],["Burn",S.o],["ORC",S.tl],["Air",S.cy]].map(([k,c])=><Line key={k} dataKey={k} stroke={c} dot={false} strokeWidth={1.5} isAnimationActive={false}/>)}
              <Line dataKey="Total" stroke={S.acc} dot={false} strokeWidth={2} isAnimationActive={false} strokeDasharray="6 2"/>
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{background:S.bg1,border:S.bd,borderRadius:6,padding:11}}>
          <div style={{fontSize:9,color:S.t4,letterSpacing:2,marginBottom:8}}>SURGE OCCUPANCY</div>
          {uDefs.filter(u=>!u.isMorgue).map(cfg=>{const u=sim.units[cfg.id];if(!u)return null;const pct=u.census/Math.max(cfg.surge,1),lp=cfg.licensed/Math.max(cfg.surge,1),bc=u.diversionActive?S.r:u.surgeActive?S.y:S.g;return <div key={cfg.id} style={{marginBottom:5,display:"grid",gridTemplateColumns:"130px 1fr 42px",gap:6,alignItems:"center"}}><span style={{fontSize:8,color:S.t3}}>{cfg.name}</span><div style={{height:4,background:"#1e293b",borderRadius:2,position:"relative",overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min(100,pct*100)}%`,background:bc,borderRadius:2,transition:"width 0.5s"}}/><div style={{position:"absolute",top:0,left:`${lp*100}%`,width:2,height:"100%",background:S.t4}}/></div><span style={{fontSize:9,color:bc,textAlign:"right",fontWeight:700}}>{Math.round(pct*100)}%</span></div>;})}
        </div>
        <div style={{background:S.bg1,border:S.bd,borderRadius:6,padding:11}}>
          <div style={{fontSize:9,color:S.t4,letterSpacing:2,marginBottom:6}}>TIPPING POINT</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(125px,1fr))",gap:4}}>{uDefs.filter(u=>!u.isMorgue).map(cfg=>{const u=sim.units[cfg.id];if(!u)return null;const rem=cfg.surge-u.census;return <div key={cfg.id} style={{padding:"5px 7px",borderRadius:3,background:S.bg,border:`1px solid ${u.diversionActive?"#ef444433":"#0f172a"}`}}><div style={{fontSize:8,color:S.t4,marginBottom:2}}>{cfg.name}</div><div style={{fontSize:9,color:u.diversionActive?S.r:u.surgeActive?S.y:S.t4}}>{u.diversionActive?"⛔ CAPACITY":u.surgeActive?`${rem} left`:`${rem} free`}</div></div>;})}
          </div>
        </div>
      </div>
    </div>
  </div>;
}
