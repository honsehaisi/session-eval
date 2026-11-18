// 分层抽样：宽词表(L)里抽 30 条人工核对
const L=require('./out-L.json'); const S=require('./out-S.json');
const sSet=new Set(S.map(x=>x.sess+'#'+x.turn+'#'+x.word));
const only=L.filter(x=>!sSet.has(x.sess+'#'+x.turn+'#'+x.word)); // 泛词独有
function pick(arr,n,seed){const r=[];let x=seed;const c=[...arr];
  while(r.length<n&&c.length){x=(x*1103515245+12345)%2147483648;r.push(c.splice(x%c.length,1)[0])}return r}
const A=pick(S,14,7), B=pick(only,16,11);
const all=[...A.map(x=>({...x,grp:'严词'})),...B.map(x=>({...x,grp:'泛词'}))];
all.forEach((x,i)=>console.log(`#${i+1} [${x.grp}] ${x.origin==='subagent'?'子':'主'} ${x.sess.slice(-6)} t${x.turn} "${x.word}" 回查=${x.w?'有':'无'}\n   ${x.sent.replace(/\s+/g,' ')}`));
