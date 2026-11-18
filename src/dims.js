// 维度注册表（唯一真源）：英文 id → 中文名 + 一句人话说明
// 报告渲染、建议引擎、下游消费方都从这里取名字和说明。
// 换一套系统复用时只改这个文件与 meta.weights，别在模板里再抄一份。
const DIMS = [
  ['safety', '安全', '会不会干出界的事；干出界了，事后收不收得回来'],
  ['stability', '稳定', '干活中途会不会崩、报错、半途撂挑子'],
  ['delivery', '交付', '开了会话有没有真做出东西，不是聊完就散'],
  ['honesty', '诚实', '说了结论，有没有回头核一遍再算数'],
  ['memory', '记忆', '该记住的记得住，该忘的能忘干净'],
  ['speed', '速度', '干同一类活要花多久'],
  ['cost', '成本', '一次会话花多少钱，会不会超预算'],
  ['consistency', '一致性', '同一个问题问两次，答案差不差'],
];

const LABEL = {};
const NOTE = {};
const ORDER = [];
DIMS.forEach(function (d) {
  LABEL[d[0]] = d[1];
  NOTE[d[0]] = d[2];
  ORDER.push(d[0]);
});

module.exports = { DIMS, LABEL, NOTE, ORDER };
