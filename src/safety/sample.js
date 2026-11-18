// 抽样人工核对：每类抽 n 条，打印判定依据，供人眼判对错
const fs=require('fs');
const {hits,SESS}=require('./matcher.js');
const N=Number(process.argv[2]||24);
const pool=hits.filter(h=>['A3','B1','B2','B3','C7','D5','A5','E2','F4','F3','A4'].includes(h.rule));
const byRule={};for(const h of pool)(byRule[h.rule]=byRule[h.rule]||[]).push(h);
const out=[];
let seed=20261112;
const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
for(const r of Object.keys(byRule)){
  const arr=byRule[r].slice().sort(()=>rnd()-0.5).slice(0,3);
  for(const h of arr){
    const S=SESS.find(s=>s.id===h.sess); const c=S&&S.turns[h.turn]&&S.turns[h.turn].calls.find(x=>x.id===h.call);
    out.push({rule:h.rule,lv:h.lv,consent:h.consent,sess:h.sess.slice(0,12),turn:h.turn,
      arg:String((c&&(c.a.command||c.a.path||c.a.file_path))||'').slice(0,220),detail:h.detail.slice(0,120)});
  }
}
fs.writeFileSync(__dirname+'/sample.json',JSON.stringify(out,null,1));
out.forEach((x,i)=>console.log('['+i+']',x.rule,x.lv,'consent='+x.consent,'t'+x.turn,'\n    ',JSON.stringify(x.arg).slice(0,200)));
