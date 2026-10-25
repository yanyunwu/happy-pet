const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../output/difficulty');
const data=JSON.parse(fs.readFileSync(path.join(root,'results.json'),'utf8'));
const remainder=JSON.parse(fs.readFileSync(path.join(root,'fun-remainders.json'),'utf8'));
const metrics=require('./difficulty-metrics.cjs');
const names={classic:'经典三消',quartet:'极限四消',fun:'趣味规则消'},toolNames={undo:'撤回',shovel:'铲出',hint:'提示',shuffle:'重排'};
const f=(v,d=1)=>Number(v).toFixed(d),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function csv(file,headers,rows){fs.writeFileSync(path.join(root,file),'\uFEFF'+[headers,...rows].map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n'));}
csv('全部难度指标.csv',['编号','类别','指标','类型','定义与计算口径','通常影响','当前版本或本次结果','获取方式','优先级'],metrics.map(m=>[m.id,m.category,m.name,m.type,m.definition,m.effect,m.current,m.method,m.priority]));
csv('六关模拟结果.csv',['玩法','关卡','策略','样本数','胜局数','通关率%','通关率95%区间下限','通关率95%区间上限','平均选牌次数','平均消除完成度%','高压步骤占比%','末尾散牌失败次数'],data.results.map(r=>[names[r.mode],r.level,data.policies.find(p=>p.id===r.policy).name,r.n,r.wins,f(r.winRate),f(r.win95[0],2),f(r.win95[1],2),f(r.meanPicks,2),f(r.meanClearedPct,2),f(r.meanDangerPct,2),r.leftoverLosses]));
csv('道具逐项禁用对照.csv',['玩法','禁用道具','样本数','完整道具通过率%','禁用后通过率%','差值_百分点','消除完成度差值_百分点'],data.ablations.map(r=>[names[r.mode],toolNames[r.removed],r.n,f(r.baselineAllTools.winRate),f(r.winRate),f(r.winRateDifference),f(r.clearPctDifference,2)]));
const get=(mode,level,policy)=>data.results.find(r=>r.mode===mode&&r.level===level&&r.policy===policy);
const table=(headers,rows)=>'<div class="table-wrap"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const winRows=[];for(const mode of Object.keys(names))for(const level of [1,2])winRows.push([esc(names[mode]),'第 '+level+' 关',...['random','greedy','planner','tools'].map(p=>{const r=get(mode,level,p);return `<strong>${f(r.winRate)}%</strong><small>${r.wins}/${r.n}</small>`;})]);
const hardRows=Object.keys(names).map(mode=>{const r=get(mode,2,'planner'),s=data.structures.find(x=>x.mode===mode&&x.level===2);return[names[mode],f(s.openingMatchRate)+'%',f(r.meanPicks,1),f(r.meanClearedPct)+'%',f(r.meanDangerPct)+'%',`${1000-r.wins-r.leftoverLosses} / ${r.leftoverLosses}`];});
const structureRows=data.structures.map(s=>[names[s.mode],'第 '+s.level+' 关',String(s.tiles),String(s.kinds),String(s.layers),String(s.openingChoices),f(s.blockedPct)+'%',f(s.openingMatchRate)+'%']);
const ablationRows=data.ablations.map(r=>[names[r.mode],toolNames[r.removed],String(r.n),f(r.baselineAllTools.winRate)+'%',f(r.winRate)+'%',(r.winRateDifference>=0?'+':'')+f(r.winRateDifference)+' 个百分点']);
const metricRows=metrics.map(m=>`<tr data-category="${esc(m.category)}" data-priority="${m.priority}"><td class="id">${m.id}<small>${m.priority}</small></td><td><strong>${esc(m.name)}</strong><small>${esc(m.category)} · ${esc(m.type)}</small></td><td>${esc(m.definition)}</td><td>${esc(m.effect)}</td><td>${esc(m.current)}<small>${esc(m.method)}</small></td></tr>`).join('');
const events=[
 ['run_start','run_id、玩法、版本、随机种子','一次从第一关开始的完整挑战'],
 ['level_start','attempt_id、run_id、关卡、发牌版本、初始数量/种类/层数、免费道具/背包库存','进入规则页与开始有效计时需分开'],
 ['tile_pick','牌来源、种类、选牌序号、主槽前后计数、暂存数量、可选数、是否成组','记录真实点击序号；撤回不倒减分析序号'],
 ['tool_use','道具、免费或背包、使用前后状态、成功/未生效','区分剩余次数不足和数量不可重排'],
 ['level_end','胜负/主动退出/技术失败、消除数、选牌数、用时、失败原因、剩余数量向量','技术失败与未完成样本单列'],
 ['run_end / resume','完整两关是否通关、重试次数、退出位置、回访','用于整轮挑战成本及留存'],
];
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>快乐萌宠消 · 难度量化与指标</title>
<style>
:root{color-scheme:light;--ink:#183442;--muted:#627681;--line:#dce6eb;--blue:#126e94;--soft:#eef6f9}*{box-sizing:border-box}body{margin:0;background:#f5f8fa;color:var(--ink);font:15px/1.7 'Microsoft YaHei',system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:42px 30px 80px}h1{font-size:32px;margin:0 0 12px}h2{font-size:23px;margin:38px 0 12px}h3{font-size:18px;margin:26px 0 8px}p{max-width:1040px}small{display:block;color:var(--muted);font-size:12px}a{color:var(--blue)}.eyebrow{letter-spacing:.12em;font-size:12px;color:var(--muted)}.summary{display:flex;gap:30px;flex-wrap:wrap;padding:20px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin:24px 0}.summary strong{font-size:27px;color:var(--blue)}.callout{background:var(--soft);padding:18px 22px;border-radius:10px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;background:white}th,td{padding:12px 14px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}th{font-weight:600;background:var(--soft);white-space:nowrap}td strong{font-weight:600}td.id{white-space:nowrap;color:var(--muted)}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:16px 0}input,select{border:1px solid #b8cbd5;border-radius:6px;padding:10px;font:inherit;background:white;color:inherit}input{min-width:240px;flex:1}select{min-width:150px}.dictionary{min-width:1040px}.dictionary td:nth-child(1){width:65px}.dictionary td:nth-child(2){width:180px}.dictionary td:nth-child(3){width:270px}.dictionary td:nth-child(4){width:250px}.dictionary td:nth-child(5){width:300px}.note{color:var(--muted)}li{margin:8px 0}code{overflow-wrap:anywhere;font-size:12px}footer{margin-top:40px;color:var(--muted);font-size:12px}@media(max-width:700px){main{padding:24px 14px}h1{font-size:25px}.summary{gap:18px}th,td{padding:9px}.controls>*{width:100%}input{min-width:0}}
</style></head><body><main>
<div class="eyebrow">快乐萌宠消 / 当前规则审计</div><h1>难度量化与影响指标</h1>
<p>难度应同时观察<strong>牌局约束、选择容错、道具效果、失败方式和真人体验</strong>。这里给出当前代码的实测结果，并将可调整的参数与用于验收的结果指标分开。</p>
<div class="summary"><div><strong>${data.rollouts.toLocaleString()}</strong><small>次策略模拟运行</small></div><div><strong>${data.runsPerCell.toLocaleString()}</strong><small>每个关卡 × 策略的样本数</small></div><div><strong>${metrics.length}</strong><small>项指标，分为 10 类</small></div><div><strong>6,000</strong><small>条生成解法通过验证</small></div></div>
<p class="callout"><strong>这些是机器人结果，不是真人通关率。</strong>规划机器人使用当前可选动物的种类，并读取完整的遮挡几何关系；不读取被遮住的动物种类，不使用生成器保存的解法。道具策略只有每关免费额度，额外背包库存为 0。</p>
<h2>当前六关：策略变强后，难度表现很不一样</h2>
${table(['玩法','关卡','随机合法选牌','简单凑同类','明牌局部规划','规划＋免费道具'],winRows)}
<p class="note">每格 1,000 次策略运行。第一关趣味模式的牌面固定，样本变化来自选牌随机性。0/1000 仅表示本次未观察到成功；按二项抽样模型，其单侧 95% 上限约为 0.30%，不能据此称关卡“无解”。</p>
<h2>三个最需要关注的结论</h2><ol>
<li><strong>经典第二关的道具影响非常大。</strong>局部规划无道具通过率为 43.2%，允许当前免费道具后为 98.4%。它的难度不能只按“15 种动物＋5 层”判断。</li>
<li><strong>四消存在明显的槽位压力。</strong>同样策略无道具只有 2.8% 通关，允许免费道具后为 57.1%；主槽只有 7 格，凑四张需要保留更多同类。</li>
<li><strong>趣味模式的主要风险是余牌数量死局。</strong>局部规划约消掉 93% 的方块，却只有 3.0% 通关。在 1,000 个样本中，970 局进入过余牌无法分组成合法组合的状态；首次出现的中位位置是第 40 次选牌，平均只消除了约 38.2% 的牌。扩大暂存空间并不能修复已经形成的数量问题。</li>
</ol>
<p>数量死局结论的范围：<strong>在不回滚此前消除、不改变各类剩余数量的前提下无法清空</strong>。及时撤回造成死局的那一步仍可能恢复；本次策略到出现眼前危机才用撤回，未能恢复这些样本。数量可分组只是必要条件，不证明遮挡牌局一定可解。</p>
<h2>第二关难在哪里：不能只看通关率</h2>
${table(['玩法','开局明牌能直接成组','平均选牌次数','平均消除完成度','高压步骤占比','满槽失败 / 末尾散牌失败'],hardRows)}
<p class="note">表中后四项使用无道具规划策略，均包含胜局与败局。高压定义为一次选牌消除后主槽仍占用 ≥5 格。选牌次数独立累计，撤回不会把已经发生的点击抹掉。</p>
<h2>第一关也要单独检查规则理解</h2>
<p>经典第一关只有 3 类动物，每类最多暂留 2 张，稳定槽占用至多 6；四消第一关只有 2 类，每类最多暂留 3 张，也至多 6。结合每类数量可整除与无循环遮挡，这两关在持续合法选牌下不会因满槽失败。</p>
<p>趣味第一关是 AAA＋BBCC。完全随机选牌的精确成功率为 <strong>${data.funTutorialExact.wins}/${data.funTutorialExact.total}＝${f(data.funTutorialExact.rate,2)}%</strong>。它有 210 种等概率类型顺序，其中 78 种能清空。先消 AABB 会留下 A＋CC；先消 AAA 或 BBCC 则可继续完成。教学高亮先做 AAA 很重要，不能把“只有 7 张牌”等同于“随便点都能过”。</p>
<h2>道具逐项禁用：重排是当前最强的降难因素</h2>
${table(['玩法','禁用道具','配对种子数','完整免费道具','禁用后','完整−禁用'],ablationRows)}
<p class="note">此表固定种子 1—500，比较同一策略去掉一种道具后的结果；基准因此与上表的 1,000 局结果略有不同。差值单位是百分点。它表示该策略下的干预效果，不是道具固有价值；小差值可能受随机并列选择与策略交互影响。</p>
<p>重排将所有剩余牌重新构造成有解的连续配组序列，且不重复初始的“拒绝容易被贪心解出”筛选。禁用重排后，经典通过率减少约 25.4 个百分点，四消减少约 48.4 个百分点。趣味在该策略下到了使用重排的时机，数量已经不可分组，因此重排基本没有救场空间。</p>
<h2>当前关卡结构</h2>
${table(['玩法','关卡','方块数','种类数','层数','开局可点','开局遮挡率','开局直接成组率'],structureRows)}
<h2>全部 ${metrics.length} 项指标</h2>
<p>“可调参数”直接改变规则或资源；“过程/结果指标”用于衡量；“体验/治理指标”用于校准与排除混杂。它们不是 ${metrics.length} 个相互独立的原因，不宜直接按权重相加。P0 为优先用于当前版本判断的指标。</p>
<div class="controls"><input id="query" aria-label="搜索指标" placeholder="搜索：槽位、死局、道具、误触…"><select id="category" aria-label="指标类别"><option value="">全部类别</option>${Array.from(new Set(metrics.map(m=>m.category))).map(c=>`<option>${esc(c)}</option>`).join('')}</select><select id="priority" aria-label="优先级"><option value="">全部优先级</option><option value="P0">P0 · 优先关注</option><option value="P1">P1 · 配套分析</option></select><span id="count" aria-live="polite"></span></div>
<div class="table-wrap"><table class="dictionary" id="metrics"><thead><tr><th>编号</th><th>指标</th><th>定义与计算口径</th><th>通常影响</th><th>当前版本 / 获取方式</th></tr></thead><tbody>${metricRows}</tbody></table></div>
<h2>怎样把它变成长期可用的数据</h2>
${table(['事件','最小记录字段','口径'],events.map(row=>row.map(esc)))}
<p>每次调整用同一个种子池先跑模拟，再用新玩家与熟练玩家分层试玩。分别看无道具和有道具的数据。将加载失败、崩溃、掉帧等技术故障单列，避免把兼容性问题算成关卡难度。实际游玩时长、误触、继续率和公平感目前都没有真人数据。</p>
<h2>测算口径与可复现数据</h2>
<ul><li>随机策略：等概率选择当前合法牌。简单策略：优先立即消除，再优先槽中同类。</li><li>局部规划：在当前可选牌中优先能完成组合的种类，并利用完整遮挡几何估计解锁数量；没有全局最优搜索。</li><li>免费道具策略：每关撤回 1、铲出 1、提示 3、重排 1；高占槽时取提示，眼前无安全选择时依次尝试撤回、铲出、重排。</li><li>生成器本身用简单贪心筛选第二关，因此同类贪心评测存在选择偏向。本次加入新的局部规划策略后，经典第二关的结果明显不同。</li><li>另对 2,000 次趣味策略运行复跑数量死局审计；这是原样本的审计，不是新增独立样本。生成解法仅用于验证有解，机器人不读取解法。</li><li>95% Wilson 区间、每局原始记录和源代码哈希保存在附带文件中。</li></ul>
<p><a href="全部难度指标.csv">全部指标 CSV</a> · <a href="六关模拟结果.csv">六关结果 CSV</a> · <a href="道具逐项禁用对照.csv">道具对照 CSV</a> · <a href="results.json">完整汇总 JSON</a> · <a href="rollouts.csv">30,000 次运行明细</a> · <a href="fun-remainders.json">趣味余牌审计</a></p>
<footer>测算对象：${esc(data.source)}<br>源码 SHA-256：<code>${esc(data.sha256)}</code><br>本报告分析当前版本，未改变玩法和难度参数。</footer>
</main><script>
const query=document.getElementById('query'),category=document.getElementById('category'),priority=document.getElementById('priority'),rows=Array.from(document.querySelectorAll('#metrics tbody tr'));
function filter(){let n=0;const q=query.value.trim().toLowerCase();for(const row of rows){const show=(!q||row.textContent.toLowerCase().includes(q))&&(!category.value||row.dataset.category===category.value)&&(!priority.value||row.dataset.priority===priority.value);row.hidden=!show;if(show)n++;}document.getElementById('count').textContent=n+' / '+rows.length+' 项';}
query.addEventListener('input',filter);category.addEventListener('change',filter);priority.addEventListener('change',filter);filter();
</script></body></html>`;
fs.writeFileSync(path.join(root,'难度量化与指标.html'),html);
fs.writeFileSync(path.join(root,'metrics.json'),JSON.stringify(metrics,null,2));
console.log(`Saved difficulty report and CSV files; ${metrics.length} metrics across ${new Set(metrics.map(m=>m.category)).size} groups.`);
