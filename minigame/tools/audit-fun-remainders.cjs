const fs=require('node:fs');const {run,partitionForAudit}=require('./analyze-difficulty.cjs');
const output=[];
for(const policy of [{id:'planner'},{id:'tools',tools:['undo','shovel','hint','shuffle']}]){
 let entered=0,terminalDead=0,recovered=0;const firstPicks=[],firstClear=[];
 for(let seed=1;seed<=1000;seed++){
  let first=null,dead=false;
  const row=run(2,seed,'fun',policy,(g,{picks,result})=>{
   // Shuffling preserves counts and picks without a match do not change them.
   const counts=Array(g.level.kinds).fill(0);g.tiles.filter(t=>!t.removed||g.tray.includes(t.id)||g.reserve.includes(t.id)).forEach(t=>counts[t.kind]++);
   dead=partitionForAudit(counts,'fun')===null;
   if(dead&&!first)first={picks,cleared:g.cleared/g.level.total*100};
  });
  if(first){entered++;firstPicks.push(first.picks);firstClear.push(first.cleared);if(row.won)recovered++;}
  if(dead)terminalDead++;
 }
 const median=a=>{const s=a.slice().sort((a,b)=>a-b);return(s[Math.floor((s.length-1)/2)]+s[Math.ceil((s.length-1)/2)])/2;};
 output.push({policy:policy.id,n:1000,enteredCountDeadState:entered,terminalCountDeadState:terminalDead,recoveredToWin:recovered,medianFirstDeadPick:median(firstPicks),meanClearPctAtFirstDead:firstClear.reduce((a,b)=>a+b,0)/firstClear.length});
}
fs.writeFileSync('output/difficulty/fun-remainders.json',JSON.stringify({definition:'Tests whether all remaining counts can be partitioned into triples or distinct pairs. An impossible count partition proves the current remainder cannot clear without reverting a previous match. A possible partition does not prove the covered board is solvable.',results:output},null,2));console.log(JSON.stringify(output,null,2));
