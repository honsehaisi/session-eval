const fs=require('fs');
const sess=JSON.parse(fs.readFileSync('sess.json','utf8')).filter(s=>s.origin!=='subagent'&&s.steps>0);
const overLow=sess.filter(s=>s.low>0.0704).length, overPeak=sess.filter(s=>s.peak>0.0704).length;
console.log(`低谷口径 ${overLow}/${sess.length}=${(100*overLow/sess.length).toFixed(1)}% | 峰谷混合口径 ${overPeak}/${sess.length}=${(100*overPeak/sess.length).toFixed(1)}%`);
const tot=sess.reduce((a,s)=>a+s.low,0), totP=sess.reduce((a,s)=>a+s.peak,0);
console.log(`总额 低谷 $${tot.toFixed(2)} / 峰谷混合 $${totP.toFixed(2)} (+${(100*(totP/tot-1)).toFixed(1)}%)`);
