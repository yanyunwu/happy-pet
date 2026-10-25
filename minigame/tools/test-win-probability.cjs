const assert=require('node:assert/strict'),{calculate,settle}=require('./lib/win-probability.cjs');
function exact(counts,rules,capacity=7){return calculate({counts,rules,capacity},{method:'exact',maxStates:1000000,maxMs:10000});}
const triple=exact([3,3,3,3],[[3]]);assert.deepEqual(triple.fraction,{numerator:'13',denominator:'22'});
const quartet=exact([4,4,4],[[4]]);assert.deepEqual(quartet.fraction,{numerator:'7',denominator:'33'});
const fun=exact([3,2,2],[[3],[2,2]]);assert.deepEqual(fun.fraction,{numerator:'13',denominator:'35'});
assert.equal(exact([6,6,6],[[3]]).probability,1);assert.equal(exact([8,8],[[4]]).probability,1);
assert.equal(exact([3,4],[[3]]).probability,0);assert.equal(exact([4],[[4]],3).probability,0);assert.equal(exact([4],[[4]],4).probability,1);
assert.equal(exact([2,2],[[3],[2,2]],4).probability,1);assert.equal(exact([2,2],[[3],[2,2]],3).probability,0);
// Independently enumerate all labelled permutations for small custom decks.
function enumerate(counts,rules,capacity){let wins=0,total=0;const deck=counts.flatMap((n,k)=>Array(n).fill(k)),used=Array(deck.length).fill(false);
 function next(h,depth,lost){if(depth===deck.length){total++;if(!lost&&h.every(n=>n===0))wins++;return;}for(let i=0;i<deck.length;i++)if(!used[i]){used[i]=true;const held=h.slice();if(!lost){held[deck[i]]++;settle(held,rules);}next(held,depth+1,lost||held.reduce((a,b)=>a+b,0)>=capacity);used[i]=false;}}
 next(Array(counts.length).fill(0),0,false);return wins/total;
}
for(const [counts,rules,capacity] of [[[3,2,2],[[3],[2,2]],7],[[3,3],[[3],[2,2]],7],[[2,2,2],[[2,1,1]],5],[[3,2,1],[[3],[2,1]],4],[[2,2,2],[[2]],3],[[4,2,2],[[3],[2,1,1]],7],[[2,4,2],[[3],[2,1,1]],7]])assert.ok(Math.abs(exact(counts,rules,capacity).probability-enumerate(counts,rules,capacity))<1e-12);
const sampled=calculate({counts:[3,3,3,3],mode:'classic',capacity:7},{method:'monte-carlo',trials:50000,seed:54});assert.ok(Math.abs(sampled.probability-13/22)<.012);
const fallback=calculate({counts:[3,3,3,3],mode:'classic'},{maxStates:1,trials:1000});assert.equal(fallback.method,'monte-carlo');assert.ok(fallback.fallbackReason);
assert.throws(()=>calculate({counts:[-1,3]}));assert.throws(()=>calculate({counts:[3],rules:[[0]]}));
console.log(JSON.stringify({success:true,examples:[triple,quartet,fun],checks:['known exact fractions','capacity and count feasibility','custom-rule exhaustive enumeration','Monte Carlo agreement','explicit budget fallback']},null,2));
