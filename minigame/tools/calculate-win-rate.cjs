const fs = require('node:fs');
const { calculate } = require('./lib/win-probability.cjs');
const file = process.argv[2];
if (!file) {
  console.log('Usage: node tools/calculate-win-rate.cjs input.json [output.json]');
  process.exitCode = 1;
} else {
  const spec = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const result = calculate(spec, spec.options || {});
  const text = JSON.stringify(result, null, 2);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], text);
  console.log(text);
}
