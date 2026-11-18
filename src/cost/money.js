const fs=require('fs'),path=require('path');
const {loadCached}=require('../dataset.js');
const P={low:{hit:0.003,miss:0.15,out:0.60},peak:{hit:0.006,miss:0.30,out:1.20}};
function isPeak(ms){const d=new Date(ms+8*3600e3);const wd=d.getUTCDay();if(wd===0||wd===6)return false;
  const h=d.getUTCHours()+d.getUTCMinutes()/60;return (h>=9&&h<12)||(h>=14&&h<18);}
// P1: pure function for tests; judgment unchanged (strict greater-than)
function isOver(sessionCost, thr){ return sessionCost > thr; }
function main(){
const sess=[];
for(const S of loadCached().sessions){
  if(S.err)continue;
  const meta=S.meta||{};
  const ups=[];
  for(const e of S.events) if(e.type==='usage') ups.push({t:e.time,u:e.usage,turn:e.turn});
  let low=0,peak=0,byTurnLow=new Map();
  for(const x of ups){
    const u=x.u,cLow=(u.inputTokens+u.cacheWriteTokens)*P.low.miss/1e6+u.cacheReadTokens*P.low.hit/1e6+u.outputTokens*P.low.out/1e6;
    const cPeak=(u.inputTokens+u.cacheWriteTokens)*P.peak.miss/1e6+u.cacheReadTokens*P.peak.hit/1e6+u.outputTokens*P.peak.out/1e6;
    low+=cLow; peak+=isPeak(x.t)?cPeak:cLow;
    byTurnLow.set(x.turn,(byTurnLow.get(x.turn)||0)+cLow);
  }
  sess.push({id:S.id,dir:S.dir,origin:meta.origin||"main",created:meta.createdAt||0,steps:ups.length,
    turns:byTurnLow.size,low,peak,turnCosts:[...byTurnLow.values()],
    tok:ups.reduce((a,x)=>({inp:a.inp+x.u.inputTokens,outp:a.outp+x.u.outputTokens,cr:a.cr+x.u.cacheReadTokens,tot:a.tot+x.u.totalTokens}),{inp:0,outp:0,cr:0,tot:0})});
}
const q=(a,p)=>{a=[...a].sort((x,y)=>x-y);return a.length?a[Math.min(a.length-1,Math.floor(p*(a.length-1)))]:0};
const f=(x,d=4)=>x.toFixed(d);
for(const grp of ['main','sub']){
  const g=sess.filter(s=>s.origin===grp||(grp==='main'&&s.origin!=='subagent'));
  if(!g.length)continue;
  const lows=g.map(s=>s.low),peaks=g.map(s=>s.peak);
  console.log(`\n=== ${grp} sessions ${g.length} | steps ${g.reduce((a,s)=>a+s.steps,0)} | turns ${g.reduce((a,s)=>a+s.turns,0)}`);
  console.log('cost USD/session  p50',f(q(lows,.5)),' p90',f(q(lows,.9)),' p95',f(q(lows,.95)),' max',f(Math.max(...lows)),' total',f(lows.reduce((a,b)=>a+b,0),2));
  console.log('peak-aware total',f(peaks.reduce((a,b)=>a+b,0),3),' vs all-low',f(lows.reduce((a,b)=>a+b,0),3));
  for(const rate of [7.0,7.1,7.2]){
    const thr=0.5/rate;
    const over=g.filter(s=>isOver(s.low,thr)).length;
    console.log(` ¥0.5 @ ${rate} = $${f(thr)} → over: ${over}/${g.length} = ${f(100*over/g.length,1)}%`);
  }
  const tc=g.flatMap(s=>s.turnCosts);
  console.log('turn cost USD p50',f(q(tc,.5),5),'p95',f(q(tc,.95),5));
}
fs.writeFileSync('sess.json',JSON.stringify(sess.map(s=>({id:s.id,origin:s.origin,created:s.created,steps:s.steps,turns:s.turns,low:s.low,peak:s.peak,tok:s.tok}))));
}
if (require.main === module) main();
module.exports = { isPeak, isOver, P };
