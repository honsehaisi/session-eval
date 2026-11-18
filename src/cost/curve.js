const fs=require('fs');
const sess=JSON.parse(fs.readFileSync('sess.json','utf8')).filter(s=>s.origin!=='subagent');
const q=(a,p)=>{a=[...a].sort((x,y)=>x-y);return a.length?a[Math.min(a.length-1,Math.floor(p*(a.length-1)))]:0};
const buckets=[[1,5],[6,15],[16,40],[41,100],[101,1000]];
console.log('轮次区间 | 会话数 | 中位花费$ | 超¥0.5占比 | 中位步数 | 占总花费');
const total=sess.reduce((a,s)=>a+s.low,0);
for(const [lo,hi] of buckets){
  const g=sess.filter(s=>s.turns>=lo&&s.turns<=hi);
  if(!g.length)continue;
  const costs=g.map(s=>s.low);
  console.log(`${lo}-${hi} | ${g.length} | ${q(costs,.5).toFixed(4)} | ${(100*costs.filter(c=>c>0.5/7.1).length/g.length).toFixed(0)}% | ${q(g.map(s=>s.steps),.5)} | ${(100*costs.reduce((a,b)=>a+b,0)/total).toFixed(0)}%`);
}
// 超线门槛：最小轮次
const over=sess.filter(s=>s.low>0.5/7.1), under=sess.filter(s=>s.low<=0.5/7.1);
console.log('\n超线会话 轮次 p10/p50:',q(over.map(s=>s.turns),.1),q(over.map(s=>s.turns),.5));
console.log('未超线会话 轮次 p50/p90:',q(under.map(s=>s.turns),.5),q(under.map(s=>s.turns),.9));
// 边际成本：每加一轮
const sorted=[...sess].sort((a,b)=>a.turns-b.turns);
console.log('\n轮次每翻倍，单会话花费约 ×', );
const groups=[[1,10],[11,20],[21,40],[41,80],[81,160],[161,400]];
for(const [a,b] of groups){const g=sorted.filter(s=>s.turns>=a&&s.turns<=b);if(g.length)console.log(` ${a}-${b} 轮: 中位 $${q(g.map(s=>s.low),.5).toFixed(4)} (${g.length}个) 中位步${q(g.map(s=>s.steps),.5)} 中位缓存读/步 ${(q(g.flatMap(s=>[s.tok.cr/s.steps]),.5)/1000).toFixed(0)}k`);}
// 顶层集中度
const costs=sorted.map(s=>s.low).sort((a,b)=>b-a);const N=costs.length;
const top10=costs.slice(0,Math.ceil(N*0.1)).reduce((a,b)=>a+b,0);
console.log(`\n最贵 10% 会话占 ${(100*top10/total).toFixed(0)}% 花费`);
