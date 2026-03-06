import { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION DEFAULTS  (military-calibrated)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_UNITS = [
  { id:"ED",       name:"Emergency Dept",     licensed:30,  surge:40,   losHours:8,    baseOcc:0.85, mortalityRate:0.002, color:"#f59e0b", isMorgue:false },
  { id:"OR",       name:"Operating Room",     licensed:10,  surge:14,   losHours:4,    baseOcc:0.70, mortalityRate:0.005, color:"#6366f1", isMorgue:false },
  { id:"PACU",     name:"PACU",               licensed:12,  surge:16,   losHours:2,    baseOcc:0.75, mortalityRate:0.001, color:"#8b5cf6", isMorgue:false },
  { id:"ICU",      name:"ICU",                licensed:20,  surge:26,   losHours:120,  baseOcc:0.80, mortalityRate:0.040, color:"#ef4444", isMorgue:false },
  { id:"StepDown", name:"Step-Down / PCU",    licensed:18,  surge:24,   losHours:72,   baseOcc:0.78, mortalityRate:0.010, color:"#f97316", isMorgue:false },
  { id:"Ward",     name:"Med-Surg Ward",      licensed:60,  surge:80,   losHours:120,  baseOcc:0.82, mortalityRate:0.008, color:"#22c55e", isMorgue:false },
  { id:"AirField", name:"Air Field Hold",     licensed:8,   surge:12,   losHours:4,    baseOcc:0.30, mortalityRate:0.001, color:"#06b6d4", isMorgue:false },
  { id:"Burn",     name:"Burn Center",        licensed:10,  surge:14,   losHours:400,  baseOcc:0.65, mortalityRate:0.060, color:"#fb923c", isMorgue:false },
  { id:"Morgue",   name:"Morgue",             licensed:20,  surge:40,   losHours:168,  baseOcc:0.10, mortalityRate:0.000, color:"#475569", isMorgue:true  },
];

const DEFAULT_ARRIVALS = [
  { id:"ED",      name:"ED Walk-in",       basePerDay:180, admitRate:0.22, fracCrit:0.05, fracHigh:0.15, fracMod:0.35 },
  { id:"Outpt",   name:"Outpatient Conv.", basePerDay:40,  admitRate:0.15, fracCrit:0.02, fracHigh:0.18, fracMod:0.50 },
  { id:"AirEvac", name:"Air Evacuation",   basePerDay:0,   admitRate:0.80, fracCrit:0.40, fracHigh:0.35, fracMod:0.20 },
  { id:"Xfer",    name:"Transfer In",      basePerDay:10,  admitRate:0.60, fracCrit:0.20, fracHigh:0.40, fracMod:0.30 },
];

const DEFAULT_POLICY = { surgeTrigger:0.80, divTrigger:0.90, offloadRatePerDay:10, partnerCapacity:50 };

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION CORE
// ─────────────────────────────────────────────────────────────────────────────

function buildRoute(acuity, channel) {
  if (acuity==="low")      return ["ED"];
  if (acuity==="moderate") return ["ED","Ward"];
  if (acuity==="high")     return ["ED","StepDown"];
  if (channel==="AirEvac") return ["AirField","OR","PACU","ICU","StepDown"];
  return ["ED","OR","PACU","ICU","StepDown"];
}

function sampleAcuity(ch, rng) {
  const r=rng();
  if(r<ch.fracCrit) return "critical";
  if(r<ch.fracCrit+ch.fracHigh) return "high";
  if(r<ch.fracCrit+ch.fracHigh+ch.fracMod) return "moderate";
  return "low";
}

function samplePoisson(lambda, rng) {
  if(lambda<=0) return 0;
  if(lambda>30) return Math.max(0,Math.round(lambda+Math.sqrt(lambda)*(rng()*2-1)*1.2));
  const L=Math.exp(-lambda); let k=0,p=1;
  do{k++;p*=rng();}while(p>L);
  return k-1;
}

function sampleLOS(losHours, rng) {
  const sigma=Math.sqrt(Math.log(1.25));
  const mu=Math.log(Math.max(0.1,losHours))-0.5*sigma*sigma;
  const u1=Math.max(1e-10,rng()),u2=rng();
  const z=Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
  return Math.max(0.1,Math.exp(mu+sigma*z));
}

function makeRng(seed) {
  let s=seed;
  return ()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
}

function createSimState(scenario, unitDefs) {
  const rng=makeRng(scenario.seed??42);
  const units={};
  unitDefs.forEach(u=>{
    const baseline=u.isMorgue?0:Math.round(u.licensed*u.baseOcc);
    units[u.id]={
      config:u,
      beds:Array.from({length:u.surge},(_,i)=>({id:i,occupied:i<baseline,patientId:i<baseline?-(i+1):null,acuity:i<baseline?"moderate":null})),
      census:baseline,waiting:0,surgeActive:false,diversionActive:false,
    };
  });
  return {
    rng,simTimeHours:0,nextDayReset:24,nextPatientId:1,
    patients:{},units,
    dailyAdmitted:0,dailyDischarged:0,dailyOffloaded:0,totalDeaths:0,
    events:[],
    scenario:{...scenario},
    // Surge capability tracking
    surgeLog:[],  // [{time, unitId, unitName, type, bedsUsed, licensed, surgeCapacity}]
  };
}

function tickSim(state, deltaHours, arrivalChannels) {
  const s=state;
  s.simTimeHours+=deltaHours;
  if(s.simTimeHours>=s.nextDayReset){s.dailyAdmitted=0;s.dailyDischarged=0;s.dailyOffloaded=0;s.nextDayReset+=24;}
  const sc=s.scenario,surgeTrig=sc.surgeTrigger??0.80,divTrig=sc.divTrigger??0.90;
  const offloadEn=sc.offloadEnabled??true,offloadRate=sc.offloadRatePerDay??10;

  arrivalChannels.forEach(ch=>{
    let base=ch.id==="AirEvac"?(sc.airEvacPerDay??0):ch.basePerDay*(sc.surgeMultiplier??1.0);
    const count=samplePoisson(base*(deltaHours/24),s.rng);
    for(let i=0;i<count;i++){
      if(s.rng()>ch.admitRate) continue;
      const acuity=sampleAcuity(ch,s.rng),route=buildRoute(acuity,ch.id);
      const pid=s.nextPatientId++,firstUnit=route[0];
      const unitCfg=s.units[firstUnit]?.config;
      const losH=unitCfg?sampleLOS(unitCfg.losHours,s.rng):4;
      s.patients[pid]={id:pid,acuity,route,routeIdx:0,currentUnit:firstUnit,losRemaining:losH,totalTime:0,state:"arriving",channel:ch.id};
      admitPatient(s,pid,surgeTrig,divTrig,offloadEn,offloadRate);
    }
  });

  const readyToMove=[];
  Object.values(s.patients).forEach(p=>{
    p.totalTime+=deltaHours;
    if(p.state==="inBed"){p.losRemaining-=deltaHours;if(p.losRemaining<=0)readyToMove.push(p.id);}
  });

  readyToMove.forEach(pid=>{
    const p=s.patients[pid];if(!p)return;
    const unit=s.units[p.currentUnit];
    const cfg=unit?.config;
    // Morgue patients just leave after LOS (body removed)
    if(cfg?.isMorgue){
      releaseBed(unit,pid);delete s.patients[pid];return;
    }
    const mortalityMod={low:0.1,moderate:0.5,high:1.0,critical:2.5}[p.acuity]??1.0;
    if(unit&&s.rng()<(cfg.mortalityRate??0.01)*mortalityMod){
      releaseBed(unit,pid);
      s.totalDeaths++;
      addEvent(s,"death",`P${pid} died in ${p.currentUnit}`);
      // Route to morgue if it exists
      const morgue=s.units["Morgue"];
      if(morgue&&morgue.census<morgue.config.surge){
        const losH=sampleLOS(morgue.config.losHours,s.rng);
        s.patients[pid]={id:pid,acuity:"critical",route:["Morgue"],routeIdx:0,currentUnit:"Morgue",losRemaining:losH,totalTime:0,state:"arriving",channel:"death"};
        const freeBed=morgue.beds.find(b=>!b.occupied);
        if(freeBed){freeBed.occupied=true;freeBed.patientId=pid;freeBed.acuity="critical";}
        morgue.census++;s.patients[pid].state="inBed";
      }
      return;
    }
    p.routeIdx++;
    const nextUnit=p.route[p.routeIdx];
    if(unit)releaseBed(unit,pid);
    if(!nextUnit){s.dailyDischarged++;addEvent(s,"discharge",`P${pid} discharged`);delete s.patients[pid];}
    else{
      p.currentUnit=nextUnit;
      const nCfg=s.units[nextUnit]?.config;
      p.losRemaining=nCfg?sampleLOS(nCfg.losHours,s.rng):4;p.state="arriving";
      admitPatient(s,pid,surgeTrig,divTrig,offloadEn,offloadRate);
    }
  });

  // Update surge/diversion status and log surge events
  Object.entries(s.units).forEach(([uid,unit])=>{
    const cfg=unit.config;
    if(cfg.isMorgue)return;
    const occ=unit.census/cfg.licensed,surgeOcc=unit.census/cfg.surge;
    const wasSurge=unit.surgeActive,wasDiv=unit.diversionActive;
    unit.surgeActive=occ>=surgeTrig;
    unit.diversionActive=surgeOcc>=divTrig;

    // Log surge capability events
    if(!wasSurge&&unit.surgeActive){
      addEvent(s,"surge",`${uid} surge activated`);
      s.surgeLog.push({
        time:s.simTimeHours, day:+(s.simTimeHours/24).toFixed(2),
        unitId:uid, unitName:cfg.name, type:"SURGE_ACTIVATED",
        census:unit.census, licensed:cfg.licensed, surgeCapacity:cfg.surge,
        pctLicensed:Math.round(occ*100), pctSurge:Math.round(surgeOcc*100),
        note:`Surge beds opened — ${cfg.surge-cfg.licensed} additional beds activated`,
      });
    }
    if(wasSurge&&!unit.surgeActive){
      s.surgeLog.push({
        time:s.simTimeHours, day:+(s.simTimeHours/24).toFixed(2),
        unitId:uid, unitName:cfg.name, type:"SURGE_CLEARED",
        census:unit.census, licensed:cfg.licensed, surgeCapacity:cfg.surge,
        pctLicensed:Math.round(occ*100), pctSurge:Math.round(surgeOcc*100),
        note:"Surge status cleared — census below threshold",
      });
    }
    if(!wasDiv&&unit.diversionActive){
      addEvent(s,"divert",`${uid} DIVERSION triggered`);
      s.surgeLog.push({
        time:s.simTimeHours, day:+(s.simTimeHours/24).toFixed(2),
        unitId:uid, unitName:cfg.name, type:"DIVERSION_TRIGGERED",
        census:unit.census, licensed:cfg.licensed, surgeCapacity:cfg.surge,
        pctLicensed:Math.round(occ*100), pctSurge:Math.round(surgeOcc*100),
        note:`Diversion active — all surge beds full, rerouting non-critical patients`,
      });
    }
    if(wasDiv&&!unit.diversionActive){
      addEvent(s,"clear",`${uid} diversion cleared`);
      s.surgeLog.push({
        time:s.simTimeHours, day:+(s.simTimeHours/24).toFixed(2),
        unitId:uid, unitName:cfg.name, type:"DIVERSION_CLEARED",
        census:unit.census, licensed:cfg.licensed, surgeCapacity:cfg.surge,
        pctLicensed:Math.round(occ*100), pctSurge:Math.round(surgeOcc*100),
        note:"Diversion cleared — capacity restored",
      });
    }
  });

  // Check if we need a growth/expansion recommendation
  const highPressureUnits=Object.values(s.units).filter(u=>!u.config.isMorgue&&u.diversionActive);
  if(highPressureUnits.length>=2){
    const last=s.surgeLog[s.surgeLog.length-1];
    if(!last||last.type!=="GROWTH_RECOMMENDED"||s.simTimeHours-last.time>24){
      s.surgeLog.push({
        time:s.simTimeHours,day:+(s.simTimeHours/24).toFixed(2),
        unitId:"SYSTEM",unitName:"System",type:"GROWTH_RECOMMENDED",
        census:null,licensed:null,surgeCapacity:null,
        pctLicensed:null,pctSurge:null,
        note:`${highPressureUnits.length} units at diversion simultaneously — permanent capacity expansion recommended`,
      });
    }
  }

  if(s.events.length>80)s.events=s.events.slice(-80);
  if(s.surgeLog.length>200)s.surgeLog=s.surgeLog.slice(-200);
  return s;
}

function admitPatient(s,pid,surgeTrig,divTrig,offloadEn,offloadRate){
  const p=s.patients[pid];if(!p)return;
  const unit=s.units[p.currentUnit];if(!unit)return;
  const cfg=unit.config,effectiveCap=unit.surgeActive?cfg.surge:cfg.licensed;
  if(unit.diversionActive&&p.acuity!=="critical"){
    if(offloadEn&&s.dailyOffloaded<offloadRate){s.dailyOffloaded++;addEvent(s,"offload",`P${pid} offloaded from ${p.currentUnit}`);delete s.patients[pid];return;}
    unit.waiting++;p.state="waiting";return;
  }
  if(unit.census<effectiveCap){
    const freeBed=unit.beds.find(b=>!b.occupied);
    if(freeBed){freeBed.occupied=true;freeBed.patientId=pid;freeBed.acuity=p.acuity;}
    unit.census++;p.state="inBed";s.dailyAdmitted++;
    addEvent(s,"admit",`P${pid} (${p.acuity}) → ${p.currentUnit}`);
  }else{unit.waiting++;p.state="waiting";}
}

function releaseBed(unit,pid){
  const bed=unit.beds.find(b=>b.patientId===pid);
  if(bed){bed.occupied=false;bed.patientId=null;bed.acuity=null;}
  unit.census=Math.max(0,unit.census-1);
  unit.waiting=Math.max(0,unit.waiting-1);
}

function addEvent(s,type,msg){s.events.push({type,msg,time:s.simTimeHours});}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const mono = "'Space Mono', monospace";
const condensed = "'Barlow Condensed', sans-serif";
const inputSt = {background:"#020617",border:"1px solid #334155",borderRadius:4,color:"#38bdf8",fontFamily:"'Space Mono',monospace",fontSize:11,padding:"5px 8px",outline:"none"};
const labelSt = {fontSize:9,color:"#475569",letterSpacing:1,marginBottom:3,display:"block",textTransform:"uppercase"};

// ─────────────────────────────────────────────────────────────────────────────
// SURGE CAPABILITY LOG PANEL
// ─────────────────────────────────────────────────────────────────────────────
const SURGE_TYPE_CONFIG = {
  SURGE_ACTIVATED:     { color:"#f59e0b", bg:"#1a1000", icon:"⚡", label:"Surge Beds Activated" },
  SURGE_CLEARED:       { color:"#22c55e", bg:"#001a00", icon:"✓",  label:"Surge Cleared" },
  DIVERSION_TRIGGERED: { color:"#ef4444", bg:"#1a0000", icon:"⛔", label:"Diversion Triggered" },
  DIVERSION_CLEARED:   { color:"#22c55e", bg:"#001a00", icon:"✓",  label:"Diversion Cleared" },
  GROWTH_RECOMMENDED:  { color:"#a78bfa", bg:"#0d0020", icon:"📈", label:"Growth Recommended" },
};

function SurgeCapabilityPanel({ surgeLog, totalDeaths, unitDefs, simState }) {
  const [filter, setFilter] = useState("ALL");
  const [tab, setTab] = useState("log");

  const filters = ["ALL","SURGE_ACTIVATED","DIVERSION_TRIGGERED","GROWTH_RECOMMENDED"];
  const filtered = filter==="ALL" ? surgeLog : surgeLog.filter(e=>e.type===filter);

  // Per-unit surge stats
  const unitStats = {};
  unitDefs.filter(u=>!u.isMorgue).forEach(u=>{
    unitStats[u.id]={
      name:u.name, color:u.color,
      surgeCount:   surgeLog.filter(e=>e.unitId===u.id&&e.type==="SURGE_ACTIVATED").length,
      divCount:     surgeLog.filter(e=>e.unitId===u.id&&e.type==="DIVERSION_TRIGGERED").length,
      peakPct:      Math.max(0,...surgeLog.filter(e=>e.unitId===u.id).map(e=>e.pctSurge||0)),
    };
  });

  // Capacity status per unit
  const capacityStatus = unitDefs.filter(u=>!u.isMorgue).map(u=>{
    const us=simState.units[u.id];if(!us)return null;
    const pctLic=us.census/u.licensed;
    const pctSurge=us.census/u.surge;
    let status="NORMAL", color="#22c55e";
    let recommendation="Operating within licensed capacity.";
    if(pctSurge>=0.90){status="DIVERSION";color="#ef4444";recommendation="⛔ At or above diversion threshold. Immediate capacity expansion or patient transfer required.";}
    else if(pctSurge>=0.75){status="SURGE";color="#f59e0b";recommendation="⚡ Surge beds active. Monitor closely. Begin expansion planning.";}
    else if(pctLic>=0.85){status="APPROACHING";color="#fbbf24";recommendation="⚠ Approaching surge threshold. Pre-position additional staff and supplies.";}
    return {id:u.id,name:u.name,color:u.color,census:us.census,licensed:u.licensed,surge:u.surge,pctLic,pctSurge,status,statusColor:color,recommendation};
  }).filter(Boolean);

  return (
    <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,overflow:"hidden"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:"1px solid #1e293b",background:"#020617"}}>
        <div>
          <div style={{fontFamily:condensed,fontSize:15,fontWeight:700,letterSpacing:2,color:"#f1f5f9",textTransform:"uppercase"}}>
            📋 Surge Capability Tracking
          </div>
          <div style={{fontSize:9,color:"#475569",marginTop:2}}>
            {surgeLog.length} events · {totalDeaths} total deaths · {surgeLog.filter(e=>e.type==="DIVERSION_TRIGGERED").length} diversion events
          </div>
        </div>
        <div style={{display:"flex",gap:4}}>
          {["log","capacity","summary"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{
              background:tab===t?"#0c1f3a":"none",
              border:`1px solid ${tab===t?"#38bdf8":"#334155"}`,
              borderRadius:3,color:tab===t?"#38bdf8":"#475569",
              fontFamily:mono,fontSize:9,padding:"4px 10px",cursor:"pointer",textTransform:"uppercase",letterSpacing:1,
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* ── LOG TAB ── */}
      {tab==="log" && (
        <div>
          {/* Filter bar */}
          <div style={{display:"flex",gap:6,padding:"10px 16px",borderBottom:"1px solid #1e293b",flexWrap:"wrap"}}>
            {filters.map(f=>{
              const tc=SURGE_TYPE_CONFIG[f];
              return (
                <button key={f} onClick={()=>setFilter(f)} style={{
                  background:filter===f?(tc?.bg||"#0c1f3a"):"none",
                  border:`1px solid ${filter===f?(tc?.color||"#38bdf8"):"#334155"}`,
                  borderRadius:3,color:filter===f?(tc?.color||"#38bdf8"):"#475569",
                  fontFamily:mono,fontSize:8,padding:"3px 8px",cursor:"pointer",letterSpacing:1,
                }}>{f==="ALL"?"ALL EVENTS":(tc?.icon+" "+tc?.label)}</button>
              );
            })}
          </div>

          {/* Event list */}
          <div style={{maxHeight:280,overflowY:"auto",scrollbarWidth:"thin",scrollbarColor:"#1e293b transparent"}}>
            {filtered.length===0 ? (
              <div style={{padding:24,textAlign:"center",color:"#334155",fontFamily:mono,fontSize:10}}>No events recorded yet</div>
            ) : [...filtered].reverse().map((e,i)=>{
              const tc=SURGE_TYPE_CONFIG[e.type]??{color:"#64748b",bg:"#0f172a",icon:"·",label:e.type};
              return (
                <div key={i} style={{
                  display:"grid",gridTemplateColumns:"80px 100px 1fr",gap:8,alignItems:"start",
                  padding:"8px 16px",borderBottom:"1px solid #0f172a",
                  background:i%2===0?"#020617":"transparent",
                }}>
                  <div style={{fontFamily:mono,fontSize:9,color:"#475569"}}>D{e.day?.toFixed(1)}</div>
                  <div style={{
                    display:"inline-flex",alignItems:"center",gap:4,
                    fontFamily:mono,fontSize:8,color:tc.color,
                    background:tc.bg,padding:"2px 6px",borderRadius:3,border:`1px solid ${tc.color}44`,
                    whiteSpace:"nowrap",
                  }}>
                    <span>{tc.icon}</span>
                    <span style={{letterSpacing:0.5}}>{e.unitId==="SYSTEM"?"SYSTEM":e.unitName}</span>
                  </div>
                  <div style={{fontSize:9,color:"#94a3b8",lineHeight:1.5}}>
                    {e.note}
                    {e.census!=null && <span style={{color:"#475569"}}> · {e.census}/{e.surgeCapacity} beds ({e.pctSurge}% surge)</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── CAPACITY STATUS TAB ── */}
      {tab==="capacity" && (
        <div style={{padding:16}}>
          <div style={{fontSize:9,color:"#475569",letterSpacing:1,marginBottom:12}}>REAL-TIME CAPACITY STATUS & RECOMMENDATIONS</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {capacityStatus.map(cs=>(
              <div key={cs.id} style={{
                display:"grid",gridTemplateColumns:"130px 60px 60px 80px 1fr",gap:8,alignItems:"center",
                padding:"8px 12px",borderRadius:4,background:"#020617",
                border:`1px solid ${cs.statusColor}33`,
              }}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{width:8,height:8,borderRadius:2,background:cs.color,display:"inline-block",flexShrink:0}}/>
                  <span style={{fontFamily:mono,fontSize:9,color:"#94a3b8"}}>{cs.name}</span>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#f1f5f9",fontFamily:mono}}>{cs.census}/{cs.licensed}</div>
                  <div style={{fontSize:7,color:"#475569"}}>licensed</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:11,fontWeight:700,color:cs.statusColor,fontFamily:mono}}>{Math.round(cs.pctSurge*100)}%</div>
                  <div style={{fontSize:7,color:"#475569"}}>of surge</div>
                </div>
                <div style={{
                  fontFamily:mono,fontSize:8,color:cs.statusColor,
                  background:`${cs.statusColor}18`,padding:"2px 6px",borderRadius:3,
                  border:`1px solid ${cs.statusColor}44`,textAlign:"center",
                }}>
                  {cs.status}
                </div>
                <div style={{fontSize:8,color:"#64748b",lineHeight:1.5}}>{cs.recommendation}</div>
              </div>
            ))}
          </div>

          {/* Morgue status */}
          {simState.units["Morgue"] && (
            <div style={{marginTop:12,padding:"10px 12px",borderRadius:4,background:"#020617",border:"1px solid #1e293b"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontFamily:mono,fontSize:9,color:"#475569"}}>⬛ Morgue</span>
                <span style={{fontFamily:mono,fontSize:11,color:"#64748b"}}>{simState.units["Morgue"].census} / {DEFAULT_UNITS.find(u=>u.id==="Morgue")?.surge} capacity</span>
                <span style={{fontFamily:mono,fontSize:9,color:"#475569"}}>Total deaths: <span style={{color:"#ef4444"}}>{totalDeaths}</span></span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SUMMARY TAB ── */}
      {tab==="summary" && (
        <div style={{padding:16}}>
          <div style={{fontSize:9,color:"#475569",letterSpacing:1,marginBottom:12}}>SURGE EVENT SUMMARY BY UNIT</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>
            {Object.values(unitStats).map(us=>(
              <div key={us.name} style={{padding:"10px 12px",background:"#020617",borderRadius:4,border:"1px solid #1e293b"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                  <span style={{width:8,height:8,borderRadius:2,background:us.color,display:"inline-block"}}/>
                  <span style={{fontFamily:mono,fontSize:9,color:"#94a3b8",textTransform:"uppercase"}}>{us.name}</span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                  {[
                    ["Surge Events", us.surgeCount, "#f59e0b"],
                    ["Diversions",   us.divCount,   "#ef4444"],
                    ["Peak %",       us.peakPct>0?us.peakPct+"%":"—", us.peakPct>=90?"#ef4444":us.peakPct>=75?"#f59e0b":"#475569"],
                  ].map(([lbl,val,col])=>(
                    <div key={lbl} style={{textAlign:"center"}}>
                      <div style={{fontSize:13,fontWeight:700,color:col,fontFamily:mono}}>{val}</div>
                      <div style={{fontSize:7,color:"#475569",marginTop:2}}>{lbl}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Overall growth recommendation */}
          {surgeLog.some(e=>e.type==="GROWTH_RECOMMENDED") && (
            <div style={{marginTop:12,padding:"12px 14px",background:"#0d0020",border:"1px solid #a78bfa44",borderRadius:4}}>
              <div style={{fontFamily:mono,fontSize:10,color:"#a78bfa",marginBottom:6}}>📈 CAPACITY GROWTH INDICATORS</div>
              <div style={{fontSize:9,color:"#94a3b8",lineHeight:1.7}}>
                System has experienced {surgeLog.filter(e=>e.type==="GROWTH_RECOMMENDED").length} multi-unit simultaneous diversion events.
                This pattern indicates structural capacity insufficiency — surge measures are being used as routine operations rather than emergency buffers.
                <br/><strong style={{color:"#a78bfa"}}>Recommended action:</strong> Initiate permanent bed expansion planning, staffing model review, or patient volume reduction strategy.
              </div>
            </div>
          )}

          {/* Deaths summary */}
          <div style={{marginTop:12,display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
            {[
              ["Total Deaths",     totalDeaths,                                    "#ef4444"],
              ["Surge Events",     surgeLog.filter(e=>e.type==="SURGE_ACTIVATED").length,     "#f59e0b"],
              ["Diversions",       surgeLog.filter(e=>e.type==="DIVERSION_TRIGGERED").length, "#ef4444"],
              ["Growth Alerts",    surgeLog.filter(e=>e.type==="GROWTH_RECOMMENDED").length,  "#a78bfa"],
            ].map(([lbl,val,col])=>(
              <div key={lbl} style={{textAlign:"center",padding:"10px 8px",background:"#020617",borderRadius:4,border:"1px solid #1e293b"}}>
                <div style={{fontSize:20,fontWeight:700,color:col,fontFamily:mono}}>{val}</div>
                <div style={{fontSize:8,color:"#475569",marginTop:4,letterSpacing:1}}>{lbl}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS MODAL
// ─────────────────────────────────────────────────────────────────────────────
function Field({ label, value, onChange, min, max, step, suffix, width=80 }) {
  return (
    <div>
      <label style={labelSt}>{label}</label>
      <div style={{display:"flex",alignItems:"center",gap:4}}>
        <input type="number" min={min} max={max} step={step} value={value}
          onChange={e=>onChange(e.target.value)}
          style={{...inputSt,width}}/>
        {suffix && <span style={{color:"#475569",fontSize:10}}>{suffix}</span>}
      </div>
    </div>
  );
}

function SettingsModal({ unitDefs, arrivalDefs, policy, onSave, onClose }) {
  const [tab,      setTab]      = useState("units");
  const [units,    setUnits]    = useState(unitDefs.map(u=>({...u})));
  const [arrivals, setArrivals] = useState(arrivalDefs.map(a=>({...a})));
  const [pol,      setPol]      = useState({...policy});

  const setUnit=(idx,field,raw)=>{
    const v=["name"].includes(field)?raw:(parseFloat(raw)||0);
    setUnits(prev=>prev.map((u,i)=>i===idx?{...u,[field]:v}:u));
  };
  const setArrival=(idx,field,raw)=>setArrivals(prev=>prev.map((a,i)=>i===idx?{...a,[field]:parseFloat(raw)||0}:a));

  const acuityWarnings=arrivals.map(a=>{
    const sum=+(a.fracCrit+a.fracHigh+a.fracMod).toFixed(3);
    return sum>1.001?`${a.name}: fractions sum to ${(sum*100).toFixed(0)}% (must be ≤ 100%)`:null;
  }).filter(Boolean);

  const tabs=[{id:"units",label:"Unit Beds & LOS"},{id:"arrivals",label:"Arrival Channels"},{id:"policy",label:"Policy Thresholds"}];

  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(2,6,23,0.93)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,width:"min(900px,96vw)",maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 30px 70px rgba(0,0,0,0.9)"}}>

        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px",borderBottom:"1px solid #1e293b",flexShrink:0}}>
          <div>
            <div style={{fontFamily:condensed,fontSize:20,fontWeight:800,letterSpacing:3,color:"#f1f5f9",textTransform:"uppercase"}}>⚙ Configuration Settings</div>
            <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginTop:2}}>Changes take effect on Save & Restart — simulation resets</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:22,lineHeight:1,padding:4}}>✕</button>
        </div>

        <div style={{display:"flex",borderBottom:"1px solid #1e293b",padding:"0 20px",flexShrink:0}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              background:"none",border:"none",cursor:"pointer",fontFamily:mono,fontSize:10,
              letterSpacing:1,textTransform:"uppercase",padding:"10px 16px",marginBottom:-1,
              color:tab===t.id?"#38bdf8":"#475569",
              borderBottom:`2px solid ${tab===t.id?"#38bdf8":"transparent"}`,
              transition:"all 0.15s",
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{flex:1,overflowY:"auto",padding:20,scrollbarWidth:"thin",scrollbarColor:"#1e293b transparent"}}>

          {/* ── UNITS TAB ── */}
          {tab==="units" && (
            <div>
              <p style={{fontSize:10,color:"#64748b",marginBottom:16,lineHeight:1.7}}>
                Military-calibrated defaults based on OIF/OEF literature (2005–2015). Burn Center LOS derived from multiple scholarly sources (range 77–490 hrs / 3.2–20.4 days). Morgue LOS represents average body hold time before release.
              </p>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead>
                    <tr style={{borderBottom:"1px solid #1e293b"}}>
                      {["Unit","Licensed Beds","Surge Beds","Avg LOS (hrs)","Baseline Occ %","Mortality %","Notes"].map(h=>(
                        <th key={h} style={{textAlign:"left",padding:"6px 8px",fontFamily:mono,fontSize:8,color:"#475569",letterSpacing:1,fontWeight:"normal",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {units.map((u,idx)=>(
                      <tr key={u.id} style={{borderBottom:"1px solid #0f172a",background:u.isMorgue?"#0a0a0a":"transparent"}}>
                        <td style={{padding:"8px",whiteSpace:"nowrap"}}>
                          <span style={{display:"inline-block",width:8,height:8,borderRadius:2,background:u.color,marginRight:8}}/>
                          <span style={{color:u.isMorgue?"#475569":"#94a3b8",fontFamily:mono,fontSize:10}}>{u.name}</span>
                          {u.isMorgue && <span style={{marginLeft:6,fontSize:8,color:"#334155"}}>(tracking only)</span>}
                        </td>
                        <td style={{padding:"4px 6px"}}><input type="number" min={1} max={500} step={1} value={u.licensed} onChange={e=>setUnit(idx,"licensed",e.target.value)} style={{...inputSt,width:65}}/></td>
                        <td style={{padding:"4px 6px"}}><input type="number" min={1} max={600} step={1} value={u.surge}    onChange={e=>setUnit(idx,"surge",e.target.value)}    style={{...inputSt,width:65}}/></td>
                        <td style={{padding:"4px 6px"}}><input type="number" min={0.5} max={2000} step={0.5} value={u.losHours} onChange={e=>setUnit(idx,"losHours",e.target.value)} style={{...inputSt,width:70}}/></td>
                        <td style={{padding:"4px 6px"}}>
                          {!u.isMorgue ? (
                            <div style={{display:"flex",alignItems:"center",gap:3}}>
                              <input type="number" min={0} max={100} step={1} value={Math.round(u.baseOcc*100)} onChange={e=>setUnit(idx,"baseOcc",(parseFloat(e.target.value)||0)/100)} style={{...inputSt,width:55}}/>
                              <span style={{color:"#334155",fontSize:10}}>%</span>
                            </div>
                          ) : <span style={{color:"#334155",fontSize:10,fontFamily:mono}}>N/A</span>}
                        </td>
                        <td style={{padding:"4px 6px"}}>
                          {!u.isMorgue ? (
                            <div style={{display:"flex",alignItems:"center",gap:3}}>
                              <input type="number" min={0} max={50} step={0.1} value={(u.mortalityRate*100).toFixed(1)} onChange={e=>setUnit(idx,"mortalityRate",(parseFloat(e.target.value)||0)/100)} style={{...inputSt,width:55}}/>
                              <span style={{color:"#334155",fontSize:10}}>%</span>
                            </div>
                          ) : <span style={{color:"#334155",fontSize:10,fontFamily:mono}}>N/A</span>}
                        </td>
                        <td style={{padding:"4px 8px",fontSize:8,color:"#334155"}}>
                          {u.id==="ICU"&&"OIF/OEF avg 5d"}{u.id==="Ward"&&"combat 5-7d"}{u.id==="Burn"&&"77-490h lit."}{u.id==="AirField"&&"Role 3 ≤72h"}{u.id==="Morgue"&&"avg hold time"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{marginTop:14,padding:12,background:"#020617",borderRadius:4,border:"1px solid #1e293b"}}>
                <div style={{fontSize:9,color:"#475569",letterSpacing:1,marginBottom:6}}>LOS QUICK REFERENCE</div>
                <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                  {[["4h","Air Field Hold / OR"],["8h","ED admit"],["72h","Step-Down"],["96h","Civ ICU avg"],["120h","Mil ICU (OIF/OEF)"],["168h","1 week"],["400h","~16.7d Burn avg"]].map(([h,l])=>(
                    <span key={h} style={{fontSize:9,color:"#334155"}}><span style={{color:"#38bdf8"}}>{h}</span> = {l}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── ARRIVALS TAB ── */}
          {tab==="arrivals" && (
            <div>
              <p style={{fontSize:10,color:"#64748b",marginBottom:16,lineHeight:1.7}}>
                Daily arrival volumes and acuity mix. Critical+High+Moderate must sum to ≤ 100%.
              </p>
              {acuityWarnings.length>0 && (
                <div style={{marginBottom:12,padding:"8px 12px",background:"#1a0000",border:"1px solid #ef444455",borderRadius:4}}>
                  {acuityWarnings.map((w,i)=><div key={i} style={{fontSize:10,color:"#ef4444"}}>⚠ {w}</div>)}
                </div>
              )}
              {arrivals.map((a,idx)=>(
                <div key={a.id} style={{marginBottom:16,padding:14,background:"#020617",borderRadius:6,border:"1px solid #1e293b"}}>
                  <div style={{fontFamily:condensed,fontSize:14,fontWeight:600,color:"#94a3b8",letterSpacing:2,marginBottom:12,textTransform:"uppercase"}}>{a.name}</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))",gap:12}}>
                    <Field label="Arrivals/day" value={a.basePerDay} min={0} max={1000} step={1} onChange={v=>setArrival(idx,"basePerDay",v)} width={75}/>
                    <Field label="Admit Rate" value={Math.round(a.admitRate*100)} min={0} max={100} step={1} suffix="%" onChange={v=>setArrival(idx,"admitRate",(parseFloat(v)||0)/100)} width={55}/>
                    <Field label="% Critical" value={Math.round(a.fracCrit*100)} min={0} max={100} step={1} suffix="%" onChange={v=>setArrival(idx,"fracCrit",(parseFloat(v)||0)/100)} width={55}/>
                    <Field label="% High"     value={Math.round(a.fracHigh*100)} min={0} max={100} step={1} suffix="%" onChange={v=>setArrival(idx,"fracHigh",(parseFloat(v)||0)/100)} width={55}/>
                    <Field label="% Moderate" value={Math.round(a.fracMod*100)}  min={0} max={100} step={1} suffix="%" onChange={v=>setArrival(idx,"fracMod",(parseFloat(v)||0)/100)} width={55}/>
                    <div>
                      <label style={labelSt}>% Low (auto)</label>
                      <div style={{padding:"5px 8px",background:"#0f172a",borderRadius:4,border:"1px solid #1e293b",fontFamily:mono,fontSize:11,color:"#22c55e"}}>
                        {Math.max(0,Math.round((1-a.fracCrit-a.fracHigh-a.fracMod)*100))}%
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── POLICY TAB ── */}
          {tab==="policy" && (
            <div>
              <p style={{fontSize:10,color:"#64748b",marginBottom:20,lineHeight:1.7}}>
                System-wide thresholds controlling surge and diversion.
              </p>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
                {[
                  {field:"surgeTrigger",     label:"Surge Bed Trigger",         pct:true,  min:50,max:100,hint:"Open surge beds when licensed occupancy exceeds this %"},
                  {field:"divTrigger",       label:"Diversion Trigger",          pct:true,  min:50,max:100,hint:"Trigger diversion when surge occupancy exceeds this %"},
                  {field:"offloadRatePerDay",label:"Max Offload / Day",          pct:false, min:0, max:200,hint:"Max patients transferred to partner hospitals per day"},
                  {field:"partnerCapacity",  label:"Partner Hospital Capacity",  pct:false, min:0, max:1000,hint:"Total partner hospital beds available for offload"},
                ].map(({field,label,pct,min,max,hint})=>(
                  <div key={field} style={{padding:14,background:"#020617",borderRadius:6,border:"1px solid #1e293b"}}>
                    <label style={{...labelSt,fontSize:10,color:"#94a3b8",marginBottom:8}}>{label}</label>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                      <input type="number" min={min} max={max} step={1}
                        value={pct?Math.round(pol[field]*100):pol[field]}
                        onChange={e=>{let v=parseFloat(e.target.value)||0;if(pct)v=v/100;setPol(p=>({...p,[field]:v}));}}
                        style={{...inputSt,width:80}}/>
                      {pct&&<span style={{color:"#475569",fontSize:11}}>%</span>}
                    </div>
                    {pct&&<div style={{height:4,background:"#1e293b",borderRadius:2,marginBottom:8,overflow:"hidden"}}><div style={{height:"100%",width:`${pol[field]*100}%`,borderRadius:2,background:field==="divTrigger"?"#ef4444":"#f59e0b",transition:"width 0.2s"}}/></div>}
                    <p style={{fontSize:9,color:"#334155",lineHeight:1.6}}>{hint}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",borderTop:"1px solid #1e293b",flexShrink:0}}>
          <button onClick={()=>{setUnits(DEFAULT_UNITS.map(u=>({...u})));setArrivals(DEFAULT_ARRIVALS.map(a=>({...a})));setPol({...DEFAULT_POLICY});}}
            style={{background:"none",border:"1px solid #334155",borderRadius:4,color:"#475569",fontFamily:mono,fontSize:10,padding:"7px 14px",cursor:"pointer"}}>
            ↺ Reset to Defaults
          </button>
          <div style={{display:"flex",gap:8}}>
            <button onClick={onClose} style={{background:"none",border:"1px solid #334155",borderRadius:4,color:"#475569",fontFamily:mono,fontSize:10,padding:"7px 14px",cursor:"pointer"}}>Cancel</button>
            <button onClick={()=>{if(!acuityWarnings.length)onSave(units,arrivals,pol);}} disabled={acuityWarnings.length>0}
              style={{background:acuityWarnings.length?"#1e293b":"#0c1f3a",border:`1px solid ${acuityWarnings.length?"#334155":"#38bdf8"}`,borderRadius:4,color:acuityWarnings.length?"#475569":"#38bdf8",fontFamily:mono,fontSize:10,padding:"7px 22px",cursor:acuityWarnings.length?"not-allowed":"pointer",fontWeight:700}}>
              ✓ Save & Restart
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIT VISUALIZATION COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function BedGrid({ unit, config }) {
  const cols=Math.min(Math.ceil(Math.sqrt(config.surge)),15);
  return (
    <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:2,padding:4}}>
      {unit.beds.map((bed,i)=>{
        const isLicensed=i<config.licensed;
        const ac=bed.acuity==="critical"?"#ef4444":bed.acuity==="high"?"#f97316":bed.acuity==="moderate"?"#eab308":"#22c55e";
        const morgueColor="#475569";
        return <div key={bed.id} style={{width:9,height:9,borderRadius:2,
          background:bed.occupied?(config.isMorgue?morgueColor:ac):isLicensed?"#1e293b":"#0f172a",
          border:`1px solid ${isLicensed?"#334155":"#1e293b"}`,
          transition:"background 0.3s",
          boxShadow:bed.occupied&&bed.acuity==="critical"&&!config.isMorgue?`0 0 3px ${ac}88`:"none"}}/>;
      })}
    </div>
  );
}

function UnitCard({ unitState }) {
  const cfg=unitState.config;
  const surgeOcc=cfg.surge>0?unitState.census/cfg.surge:0;
  const occ=cfg.licensed>0?unitState.census/cfg.licensed:0;
  const status=cfg.isMorgue?"MORGUE":unitState.diversionActive?"DIVERT":unitState.surgeActive?"SURGE":"NORMAL";
  const sc={DIVERT:"#ef4444",SURGE:"#f59e0b",NORMAL:"#22c55e",MORGUE:"#475569"}[status];
  const bc=cfg.isMorgue?"#475569":surgeOcc>0.9?"#ef4444":surgeOcc>0.7?"#f59e0b":"#22c55e";
  return (
    <div style={{
      background:"#0f172a",
      border:`1px solid ${unitState.diversionActive&&!cfg.isMorgue?"#ef444444":"#1e293b"}`,
      borderLeft:`3px solid ${cfg.color}`,borderRadius:6,padding:"10px 12px",
      transition:"border-color 0.4s",
      boxShadow:unitState.diversionActive&&!cfg.isMorgue?"0 0 20px #ef444422":"none",
      opacity:cfg.isMorgue?0.75:1,
    }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <span style={{fontFamily:mono,fontSize:10,color:cfg.isMorgue?"#475569":"#94a3b8",letterSpacing:1,textTransform:"uppercase"}}>{cfg.name}</span>
        <span style={{fontSize:8,fontFamily:mono,letterSpacing:1,color:sc,background:`${sc}18`,padding:"2px 6px",borderRadius:3,border:`1px solid ${sc}44`,animation:status==="DIVERT"?"pulse 1s infinite":"none"}}>{status}</span>
      </div>
      <div style={{display:"flex",gap:16,marginBottom:8,alignItems:"baseline"}}>
        <div>
          <span style={{fontFamily:mono,fontSize:22,fontWeight:700,color:cfg.isMorgue?"#64748b":"#f1f5f9"}}>{unitState.census}</span>
          <span style={{fontFamily:mono,fontSize:11,color:"#475569",marginLeft:2}}>/{cfg.surge}</span>
        </div>
        <div style={{fontSize:10}}>
          <div style={{color:"#64748b"}}>Licensed: {cfg.licensed}</div>
          {unitState.waiting>0&&!cfg.isMorgue&&<div style={{color:"#f59e0b"}}>Queue: {unitState.waiting}</div>}
        </div>
      </div>
      {!cfg.isMorgue && (
        <div style={{height:4,background:"#1e293b",borderRadius:2,marginBottom:8,overflow:"hidden"}}>
          <div style={{height:"100%",borderRadius:2,width:`${Math.min(100,surgeOcc*100)}%`,background:bc,transition:"width 0.5s,background 0.3s",boxShadow:surgeOcc>0.9?`0 0 6px ${bc}`:"none"}}/>
        </div>
      )}
      <BedGrid unit={unitState} config={cfg}/>
    </div>
  );
}

function EventLog({ events }) {
  const ref=useRef(null);
  useEffect(()=>{if(ref.current)ref.current.scrollTop=ref.current.scrollHeight;},[events]);
  const colors={surge:"#f59e0b",divert:"#ef4444",clear:"#22c55e",admit:"#64748b",discharge:"#22c55e",offload:"#a78bfa",death:"#dc2626"};
  return (
    <div ref={ref} style={{height:140,overflowY:"auto",fontFamily:mono,fontSize:9,color:"#64748b",lineHeight:1.8,scrollbarWidth:"thin",scrollbarColor:"#1e293b transparent"}}>
      {events.slice(-40).map((e,i)=>(
        <div key={i} style={{color:colors[e.type]??"#64748b"}}>
          <span style={{color:"#334155"}}>[{(e.time/24).toFixed(2)}d] </span>{e.msg}
        </div>
      ))}
    </div>
  );
}

function ChartTooltip({ active, payload }) {
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:"#0f172a",border:"1px solid #1e293b",padding:"8px 12px",borderRadius:4,fontFamily:mono,fontSize:10}}>
      {payload.map(p=><div key={p.dataKey} style={{color:p.color}}>{p.dataKey}: {p.value}</div>)}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────
const SCENARIOS=[
  {label:"Baseline",     surgeMultiplier:1.0,airEvacPerDay:0, offloadEnabled:true},
  {label:"Minor MCI",    surgeMultiplier:1.5,airEvacPerDay:4, offloadEnabled:true},
  {label:"Moderate MCI", surgeMultiplier:2.5,airEvacPerDay:10,offloadEnabled:true},
  {label:"Major MCI",    surgeMultiplier:4.0,airEvacPerDay:20,offloadEnabled:true},
  {label:"Catastrophic", surgeMultiplier:6.0,airEvacPerDay:40,offloadEnabled:true},
];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function HospitalSurgeSim() {
  const [unitDefs,     setUnitDefs]     = useState(DEFAULT_UNITS.map(u=>({...u})));
  const [arrivalDefs,  setArrivalDefs]  = useState(DEFAULT_ARRIVALS.map(a=>({...a})));
  const [policy,       setPolicy]       = useState({...DEFAULT_POLICY});
  const [showSettings, setShowSettings] = useState(false);
  const [selScenario,  setSelScenario]  = useState(0);
  const [running,      setRunning]      = useState(false);
  const [speed,        setSpeed]        = useState(12);
  const [customMult,   setCustomMult]   = useState(1.0);
  const [customAirEvac,setCustomAirEvac]= useState(0);
  const [chartData,    setChartData]    = useState([]);
  const [simState,     setSimState]     = useState(()=>createSimState({...SCENARIOS[0],...DEFAULT_POLICY,seed:42},DEFAULT_UNITS));

  const stateRef=useRef(simState); stateRef.current=simState;
  const rafRef=useRef(null),lastTimeRef=useRef(null);
  const arrivalRef=useRef(arrivalDefs); arrivalRef.current=arrivalDefs;

  const buildSc=useCallback((sc,pol)=>({...sc,...pol}),[]);

  const reset=useCallback((sc,uDefs)=>{
    const ns=createSimState({...sc,seed:Math.floor(Math.random()*99999)},uDefs);
    setSimState(ns);stateRef.current=ns;setChartData([]);setRunning(false);lastTimeRef.current=null;
  },[]);

  const loadScenario=useCallback((idx,pol,uDefs)=>{
    setSelScenario(idx);
    const sc=buildSc(SCENARIOS[idx],pol??DEFAULT_POLICY);
    setCustomMult(SCENARIOS[idx].surgeMultiplier);
    setCustomAirEvac(SCENARIOS[idx].airEvacPerDay);
    reset(sc,uDefs??DEFAULT_UNITS);
  },[buildSc,reset]);

  const handleSave=useCallback((newUnits,newArrivals,newPolicy)=>{
    setUnitDefs(newUnits);setArrivalDefs(newArrivals);setPolicy(newPolicy);
    setShowSettings(false);
    reset(buildSc(SCENARIOS[selScenario],newPolicy),newUnits);
  },[selScenario,buildSc,reset]);

  useEffect(()=>{
    if(!running){cancelAnimationFrame(rafRef.current);return;}
    const tick=(ts)=>{
      if(lastTimeRef.current===null)lastTimeRef.current=ts;
      const rd=Math.min((ts-lastTimeRef.current)/1000,0.1);lastTimeRef.current=ts;
      const dh=rd*speed;
      const next=tickSim(
        {...stateRef.current,units:JSON.parse(JSON.stringify(stateRef.current.units)),patients:{...stateRef.current.patients},events:[...stateRef.current.events],surgeLog:[...stateRef.current.surgeLog]},
        dh,arrivalRef.current
      );
      stateRef.current=next;setSimState({...next});
      setChartData(prev=>{
        const last=prev[prev.length-1];
        if(last&&Math.abs(last.day-next.simTimeHours/24)<0.04)return prev;
        return [...prev.slice(-200),{
          day:parseFloat((next.simTimeHours/24).toFixed(2)),
          ED:next.units.ED?.census??0,ICU:next.units.ICU?.census??0,
          Ward:next.units.Ward?.census??0,OR:next.units.OR?.census??0,
          Burn:next.units.Burn?.census??0,
          Total:Object.values(next.units).filter(u=>!u.config.isMorgue).reduce((s,u)=>s+u.census,0),
        }];
      });
      rafRef.current=requestAnimationFrame(tick);
    };
    rafRef.current=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(rafRef.current);
  },[running,speed]);

  const clinicalUnits=unitDefs.filter(u=>!u.isMorgue);
  const totalLicensed=clinicalUnits.reduce((s,u)=>s+u.licensed,0);
  const totalSurge=clinicalUnits.reduce((s,u)=>s+u.surge,0);
  const totalCensus=Object.values(simState.units).filter(u=>!u.config.isMorgue).reduce((s,u)=>s+u.census,0);
  const anyDiv=clinicalUnits.some(u=>simState.units[u.id]?.diversionActive);
  const anySurge=clinicalUnits.some(u=>simState.units[u.id]?.surgeActive);
  const sysStatus=anyDiv?"DIVERSION ACTIVE":anySurge?"SURGE ACTIVE":"NORMAL OPS";
  const sysColor=anyDiv?"#ef4444":anySurge?"#f59e0b":"#22c55e";

  return (
    <div style={{minHeight:"100vh",background:"#020617",fontFamily:mono,color:"#e2e8f0"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Barlow+Condensed:wght@300;600;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px;}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
        input[type=range]{-webkit-appearance:none;appearance:none;height:3px;border-radius:2px;background:#1e293b;outline:none;}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;border-radius:50%;background:#38bdf8;cursor:pointer;}
        input[type=number]{-moz-appearance:textfield;}
        input[type=number]::-webkit-inner-spin-button{opacity:0.3;}
      `}</style>

      {showSettings && <SettingsModal unitDefs={unitDefs} arrivalDefs={arrivalDefs} policy={policy} onSave={handleSave} onClose={()=>setShowSettings(false)}/>}

      {/* Header */}
      <div style={{borderBottom:"1px solid #1e293b",padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",background:anyDiv?"#1a0000":"#020617",transition:"background 1s"}}>
        <div>
          <div style={{fontFamily:condensed,fontSize:22,fontWeight:800,letterSpacing:3,color:"#f1f5f9",textTransform:"uppercase"}}>Hospital Surge Command</div>
          <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginTop:1}}>CAPACITY MANAGEMENT SIMULATION SYSTEM · MILITARY CALIBRATED</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <button onClick={()=>{setRunning(false);setShowSettings(true);}}
            style={{background:"#0f172a",border:"1px solid #334155",borderRadius:4,color:"#94a3b8",fontFamily:mono,fontSize:10,padding:"7px 14px",cursor:"pointer",letterSpacing:1,display:"flex",alignItems:"center",gap:6}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="#38bdf8";e.currentTarget.style.color="#38bdf8";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="#334155";e.currentTarget.style.color="#94a3b8";}}>
            ⚙ SETTINGS
          </button>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:2}}>SYSTEM STATUS</div>
            <div style={{fontFamily:condensed,fontSize:18,fontWeight:600,color:sysColor,letterSpacing:2,animation:anyDiv?"pulse 1s infinite":"none"}}>{sysStatus}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:2}}>SIM TIME</div>
            <div style={{fontFamily:mono,fontSize:15,color:"#38bdf8"}}>D{Math.floor(simState.simTimeHours/24).toString().padStart(2,"0")} · {String(Math.floor(simState.simTimeHours%24)).padStart(2,"0")}:{String(Math.floor((simState.simTimeHours%1)*60)).padStart(2,"0")}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:2}}>CENSUS / DEATHS</div>
            <div style={{fontSize:18,fontWeight:700,color:totalCensus>totalSurge*0.9?"#ef4444":"#f1f5f9",fontFamily:mono}}>
              {totalCensus}<span style={{fontSize:11,color:"#475569"}}>/{totalSurge}</span>
              <span style={{fontSize:11,color:"#ef4444",marginLeft:8}}>☩{simState.totalDeaths}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"250px 1fr",gap:0,height:"calc(100vh - 61px)"}}>

        {/* Left panel */}
        <div style={{borderRight:"1px solid #1e293b",padding:14,overflowY:"auto",display:"flex",flexDirection:"column",gap:14,background:"#020617"}}>
          <div>
            <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:8}}>SCENARIO PRESETS</div>
            {SCENARIOS.map((sc,i)=>(
              <button key={i} onClick={()=>loadScenario(i,policy,unitDefs)} style={{display:"block",width:"100%",textAlign:"left",padding:"7px 10px",marginBottom:3,borderRadius:4,background:selScenario===i?"#0f2744":"transparent",border:`1px solid ${selScenario===i?"#38bdf8":"#1e293b"}`,color:selScenario===i?"#38bdf8":"#64748b",fontFamily:mono,fontSize:10,cursor:"pointer",transition:"all 0.2s"}}>
                <span style={{marginRight:6}}>{["●","◆","▲","★","⚠"][i]}</span>{sc.label}<span style={{float:"right",color:"#334155"}}>{sc.surgeMultiplier}x</span>
              </button>
            ))}
          </div>

          <div style={{borderTop:"1px solid #1e293b",paddingTop:12}}>
            <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:10}}>CUSTOM CONTROLS</div>
            <div style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                <span style={{fontSize:10,color:"#94a3b8"}}>Surge Multiplier</span>
                <span style={{fontSize:12,color:"#38bdf8",fontWeight:700}}>{customMult.toFixed(1)}×</span>
              </div>
              <input type="range" min={0.5} max={8} step={0.1} value={customMult}
                onChange={e=>{const v=parseFloat(e.target.value);setCustomMult(v);setSimState(s=>({...s,scenario:{...s.scenario,surgeMultiplier:v}}));}} style={{width:"100%"}}/>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#334155",marginTop:2}}><span>0.5×</span><span>Normal</span><span>8×</span></div>
            </div>
            <div style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                <span style={{fontSize:10,color:"#94a3b8"}}>Air Field / day</span>
                <span style={{fontSize:12,color:"#06b6d4",fontWeight:700}}>{customAirEvac}</span>
              </div>
              <input type="range" min={0} max={60} step={1} value={customAirEvac}
                onChange={e=>{const v=parseInt(e.target.value);setCustomAirEvac(v);setSimState(s=>({...s,scenario:{...s.scenario,airEvacPerDay:v}}));}} style={{width:"100%"}}/>
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <span style={{fontSize:10,color:"#94a3b8"}}>Offload Enabled</span>
              <button onClick={()=>setSimState(s=>({...s,scenario:{...s.scenario,offloadEnabled:!s.scenario.offloadEnabled}}))}
                style={{padding:"3px 10px",borderRadius:3,fontSize:10,cursor:"pointer",fontFamily:mono,background:simState.scenario.offloadEnabled?"#064e3b":"#1e293b",border:`1px solid ${simState.scenario.offloadEnabled?"#22c55e":"#334155"}`,color:simState.scenario.offloadEnabled?"#22c55e":"#475569"}}>
                {simState.scenario.offloadEnabled?"ON":"OFF"}
              </button>
            </div>
          </div>

          <div style={{borderTop:"1px solid #1e293b",paddingTop:12}}>
            <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:8}}>SIMULATION</div>
            <div style={{display:"flex",gap:6,marginBottom:10}}>
              <button onClick={()=>{lastTimeRef.current=null;setRunning(r=>!r);}} style={{flex:1,padding:"9px 0",borderRadius:4,cursor:"pointer",background:running?"#1a0a0a":"#0c1f3a",border:`1px solid ${running?"#ef4444":"#38bdf8"}`,color:running?"#ef4444":"#38bdf8",fontFamily:mono,fontSize:11}}>
                {running?"⏸ PAUSE":"▶ RUN"}
              </button>
              <button onClick={()=>reset(simState.scenario,unitDefs)} style={{padding:"9px 12px",borderRadius:4,cursor:"pointer",background:"#0f172a",border:"1px solid #1e293b",color:"#475569",fontFamily:mono,fontSize:11}}>↺</button>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
              <span style={{fontSize:10,color:"#94a3b8"}}>Speed</span>
              <span style={{fontSize:10,color:"#38bdf8"}}>{speed}h/s</span>
            </div>
            <input type="range" min={1} max={96} step={1} value={speed} onChange={e=>setSpeed(parseInt(e.target.value))} style={{width:"100%"}}/>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#334155",marginTop:2}}><span>1h/s</span><span>1d/s</span><span>4d/s</span></div>
          </div>

          <div style={{borderTop:"1px solid #1e293b",paddingTop:12}}>
            <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:8}}>TODAY</div>
            {[["Admitted",simState.dailyAdmitted,"#38bdf8"],["Discharged",simState.dailyDischarged,"#22c55e"],["Offloaded",simState.dailyOffloaded,"#a78bfa"],["Total Deaths",simState.totalDeaths,"#ef4444"]].map(([l,v,c])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                <span style={{fontSize:10,color:"#475569"}}>{l}</span>
                <span style={{fontSize:13,fontWeight:700,color:c}}>{v}</span>
              </div>
            ))}
          </div>

          <div style={{borderTop:"1px solid #1e293b",paddingTop:12,flex:1}}>
            <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:6}}>EVENT LOG</div>
            <EventLog events={simState.events}/>
          </div>
        </div>

        {/* Right panel */}
        <div style={{overflowY:"auto",padding:14,display:"flex",flexDirection:"column",gap:14}}>

          {/* Unit cards — clinical units first, then morgue */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:10}}>
            {unitDefs.filter(u=>!u.isMorgue).map(cfg=>simState.units[cfg.id]&&<UnitCard key={cfg.id} unitState={simState.units[cfg.id]}/>)}
          </div>

          {/* Morgue card — separate row, smaller */}
          {simState.units["Morgue"] && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:10}}>
              <UnitCard unitState={simState.units["Morgue"]}/>
            </div>
          )}

          {/* Surge Capability Tracking Panel */}
          <SurgeCapabilityPanel
            surgeLog={simState.surgeLog}
            totalDeaths={simState.totalDeaths}
            unitDefs={unitDefs}
            simState={simState}
          />

          {/* Census chart */}
          <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:14}}>
            <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:10}}>CENSUS OVER TIME</div>
            <div style={{display:"flex",gap:14,marginBottom:8,flexWrap:"wrap"}}>
              {[["ED","#f59e0b"],["ICU","#ef4444"],["Ward","#22c55e"],["OR","#6366f1"],["Burn","#fb923c"],["Total","#38bdf8"]].map(([k,c])=>(
                <span key={k} style={{fontSize:9,color:c}}><span style={{display:"inline-block",width:10,height:2,background:c,marginRight:4,verticalAlign:"middle"}}/>{k}</span>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={chartData} margin={{top:4,right:8,bottom:4,left:0}}>
                <XAxis dataKey="day" stroke="#1e293b" tick={{fill:"#334155",fontSize:9,fontFamily:"Space Mono"}} tickFormatter={v=>`D${v.toFixed(0)}`}/>
                <YAxis stroke="#1e293b" tick={{fill:"#334155",fontSize:9,fontFamily:"Space Mono"}}/>
                <Tooltip content={<ChartTooltip/>}/>
                <ReferenceLine y={totalLicensed} stroke="#334155" strokeDasharray="4 2" label={{value:"Licensed",fill:"#334155",fontSize:8}}/>
                <ReferenceLine y={totalSurge}    stroke="#475569" strokeDasharray="4 2" label={{value:"Surge Cap",fill:"#475569",fontSize:8}}/>
                <Line dataKey="ED"    stroke="#f59e0b" dot={false} strokeWidth={1.5} isAnimationActive={false}/>
                <Line dataKey="ICU"   stroke="#ef4444" dot={false} strokeWidth={1.5} isAnimationActive={false}/>
                <Line dataKey="Ward"  stroke="#22c55e" dot={false} strokeWidth={1.5} isAnimationActive={false}/>
                <Line dataKey="OR"    stroke="#6366f1" dot={false} strokeWidth={1}   isAnimationActive={false}/>
                <Line dataKey="Burn"  stroke="#fb923c" dot={false} strokeWidth={1}   isAnimationActive={false}/>
                <Line dataKey="Total" stroke="#38bdf8" dot={false} strokeWidth={2}   isAnimationActive={false} strokeDasharray="6 2"/>
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Occupancy bars */}
          <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:14}}>
            <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:10}}>SURGE OCCUPANCY BY UNIT</div>
            {unitDefs.filter(u=>!u.isMorgue).map(cfg=>{
              const u=simState.units[cfg.id];if(!u)return null;
              const pct=u.census/cfg.surge,licPct=cfg.licensed/cfg.surge;
              const bc=u.diversionActive?"#ef4444":u.surgeActive?"#f59e0b":"#22c55e";
              return (
                <div key={cfg.id} style={{marginBottom:8,display:"grid",gridTemplateColumns:"130px 1fr 55px",gap:8,alignItems:"center"}}>
                  <span style={{fontSize:9,color:"#64748b"}}>{cfg.name}</span>
                  <div style={{height:7,background:"#1e293b",borderRadius:4,position:"relative",overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${Math.min(100,pct*100)}%`,background:bc,borderRadius:4,transition:"width 0.5s,background 0.3s",boxShadow:pct>0.9?`0 0 5px ${bc}`:"none"}}/>
                    <div style={{position:"absolute",top:0,left:`${licPct*100}%`,width:2,height:"100%",background:"#475569"}}/>
                  </div>
                  <span style={{fontSize:10,color:bc,textAlign:"right",fontWeight:700}}>{Math.round(pct*100)}%</span>
                </div>
              );
            })}
          </div>

          {/* Tipping point */}
          <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:14}}>
            <div style={{fontSize:9,color:"#475569",letterSpacing:2,marginBottom:8}}>TIPPING POINT ANALYSIS — Current Run</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:6}}>
              {unitDefs.filter(u=>!u.isMorgue).map(cfg=>{
                const u=simState.units[cfg.id];if(!u)return null;
                const remaining=cfg.surge-u.census;
                return (
                  <div key={cfg.id} style={{padding:"7px 10px",borderRadius:4,background:"#020617",border:`1px solid ${u.diversionActive?"#ef444444":"#0f172a"}`}}>
                    <div style={{fontSize:8,color:"#475569",marginBottom:3}}>{cfg.name}</div>
                    <div style={{fontSize:10,color:u.diversionActive?"#ef4444":u.surgeActive?"#f59e0b":"#475569"}}>
                      {u.diversionActive?"⛔ AT CAPACITY":u.surgeActive?`${remaining} beds left`:`${remaining} beds free`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
