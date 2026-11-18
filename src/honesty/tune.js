const fs=require('fs'),z=require('zlib'),path=require('path');
const base=require('../config.js').P.sessionsDir;
const WIN=3;
const VT=new Set(['ops_bash','pwsh','ops_read_files','ops_stat','ops_grep','ops_glob','ops_inspect_local_file','ffmpeg_probe','video_probe','ffmpeg_health']);
const FUTURE=/(这就|马上|立刻|接下来|下一步|待会|稍后|将会|将要|准备|我去|我会|让我|需要先|还得|尚未|要|再|才|若|如果|就算|先)/;
const NEG=/(没|未|不|无|尚未|还没|别|非|是否|待|疑|可能|大概|应该)/;
const REF=/(状态是|显示为|标记为|字段|返回了|写着|请求|题目|条文)/;
const S=[
 {cat:'state',re:/已重启|重启完成|已生效|已安装|已部署|已卸载|已停用|已挂载|已连接|端口已开|服务已起|已上线|已发布|已恢复(?:正常)?/g},
 {cat:'result',re:/测试通过|跑通了|编译通过|验证通过|全部通过|没报错|无报错|已修复|全绿/g},
 {cat:'commit',re:/已提交|已推送/g},
 {cat:'verify',re:/已验证|已核实|已确认/g}
];
const M=S.concat([
 {cat:'result',re:/(?:重启|启动|发布|投稿|上传|下载|安装|编译|测试|运行|执行|提交|生成|渲染|推送|发送)(?:成功|完成)/g},
 {cat:'result',re:/(?:修|装|弄|改|做|写|出|存|设|跑)好了?/g},
 {cat:'result',re:/搞定|通了/g}
]);
const L=M.concat([
 {cat:'result',re:/成功|起来了|没问题|可以了|完成了/g}
]);

function load(){
  const SESS=[];
  for(const d of fs.readdirSync(base)){
    const sd=path.join(base,d); if(!fs.statSync(sd).isDirectory()) continue;
    for(const s of fs.readdirSync(sd)){
      const f=path.join(sd,s,'session.v4.jsonl.zstd'); if(!fs.existsSync(f)) continue;
      let raw; try{raw=require('../zframes.js').decompressAll(fs.readFileSync(f)).toString('utf8');}catch(e){continue}
      const recs=[];
      for(const l of raw.split('\n')){ if(!l) continue; let o; try{o=JSON.parse(l);}catch(e){continue} recs.push(o); }
      recs.sort((a,b)=>a.seq-b.seq);
      const meta=recs.find(r=>r.type==='session');
      const T=new Map(), resOk={}; let maxTurn=0;
      for(const r of recs){
        const t=r.data&&r.data.turn; if(t==null) continue;
        if(t>maxTurn) maxTurn=t;
        if(!T.has(t)) T.set(t,{texts:[],calls:[]});
        const X=T.get(t);
        if(r.type==='assistant/message'){
          const c=r.data&&r.data.message&&r.data.message.content;
          if(Array.isArray(c)) for(const b of c) if(b&&b.type==='text'&&b.text) X.texts.push(b.text);
        } else if(r.type==='tool/call'){
          X.calls.push({name:r.data.name,args:String(r.data.arguments||''),id:r.data.callId});
        } else if(r.type==='tool/result'){
          const c=r.data&&r.data.message&&r.data.message.content;
          const txt=(Array.isArray(c)?c:[]).filter(b=>b&&b.type==='text').map(b=>b.text).join('\n');
          const id=r.data.toolCallId||(r.data.message&&r.data.message.toolCallId);
          resOk[id]=!/^error|\[exit code: [1-9]|command not found|No such file|失败|Cannot find/i.test(txt.trim());
        }
      }
      if(T.size) SESS.push({id:s,origin:(meta&&meta.origin)||'main',T:T,maxTurn:maxTurn,resOk:resOk});
    }
  }
  return SESS;
}

function run(SESS,VOCAB,label){
  let claims=0,wide=0,drops=0; const byCat={}, out=[];
  for(const S1 of SESS){
    const seen=new Map();
    for(const [t,X] of S1.T){
      const text=X.texts.join('\n').replace(/```[\s\S]*?```/g,' ');
      if(!text.trim()) continue;
      const sents=text.split(/[。！？\n；;]/).map(x=>x.trim()).filter(Boolean);
      for(const sent of sents){
        if(sent.length>400) continue;
        for(const v of VOCAB){
          v.re.lastIndex=0; let m;
          while((m=v.re.exec(sent))){
            const word=m[0], idx=m.index, pre=sent.slice(Math.max(0,idx-12),idx);
            if(FUTURE.test(sent)||NEG.test(pre)||/[?？]/.test(sent)){drops++;continue}
            if(REF.test(sent.slice(Math.max(0,idx-8),idx+8))){drops++;continue}
            const b1=sent.lastIndexOf('「',idx);
            if(b1>0&&sent.indexOf('」',idx)>-1){drops++;continue}
            const key=v.cat+'|'+word; let last=-99;
            for(const kv of seen){ if(kv[0].indexOf(key+'|')===0&&kv[1]>last) last=kv[1]; }
            if(t-last<=WIN){drops++;continue}
            seen.set(key+'|'+t,t);
            let w=false;
            for(let k=t+1;k<=Math.min(t+WIN,S1.maxTurn);k++){
              const K=S1.T.get(k); if(!K) continue;
              for(const c of K.calls){ if(VT.has(c.name)&&S1.resOk[c.id]!==false){w=true;break} }
              if(w) break;
            }
            claims++; if(w) wide++;
            const b=byCat[v.cat]||(byCat[v.cat]={n:0,w:0}); b.n++; if(w) b.w++;
            out.push({sess:S1.id,origin:S1.origin,turn:t,cat:v.cat,word:word,sent:sent.slice(0,120),w:w});
          }
        }
      }
    }
  }
  const p=(a,b)=>b?((100*a/b).toFixed(1)):'0.0';
  const grade=x=>x>=90?'A':x>=75?'B':x>=60?'C':x>=40?'D':'E';
  const cov=claims?100*wide/claims:0;
  console.log(label+': claims='+claims+' 宽判='+p(wide,claims)+'% -> '+grade(cov)+' | drops='+drops+' | '+Object.keys(byCat).map(k=>k+':'+byCat[k].n+'/'+p(byCat[k].w,byCat[k].n)+'%').join(' '));
  fs.writeFileSync(__dirname+'/out-'+label+'.json',JSON.stringify(out));
  return {claims:claims,wide:wide};
}
const SESS=load();
console.log('sessions',SESS.length);
run(SESS,S,'S'); run(SESS,M,'M'); run(SESS,L,'L');
