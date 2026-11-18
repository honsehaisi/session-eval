const fs=require('fs');
const all=JSON.parse(fs.readFileSync('sess.json','utf8'));
const main=all.filter(s=>s.origin!=='subagent');
const byStep={};
main.forEach(s=>{const k=s.steps===0?'0步':s.steps<=5?'1-5步':'6+步';byStep[k]=(byStep[k]||0)+1});
console.log('主会话按步数:',JSON.stringify(byStep));
const empty=main.filter(s=>s.steps===0);
console.log('0 步会话成本非零数:',empty.filter(s=>s.low>0).length);
const real=main.filter(s=>s.steps>0);
const over=real.filter(s=>s.low>0.0704).length;
console.log(`非空主会话 ${real.length}，超线 ${over} → ${(100*over/real.length).toFixed(1)}%`);
// 阈值敏感性
for(const r of [7.1]) for(const thr of [0.3,0.5,1,2]){
  const t=thr/r; console.log(`¥${thr} 阈值: 超线 ${(100*real.filter(s=>s.low>t).length/real.length).toFixed(0)}% (非空) / ${(100*main.filter(s=>s.low>t).length/main.length).toFixed(0)}% (含空)`);
}
