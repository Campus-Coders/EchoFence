import { execSync } from 'child_process';

const tests = [
  'test-step4.mjs',
  'test-step5.mjs',
  'test-step6.mjs',
  'test-step7.mjs',
  'test-step8.mjs',
  'test-step9.mjs',
  'test-step10.mjs',
  'test-step11.mjs',
  'test-step12.mjs',
  'test-step13.mjs',
  'test-step14.mjs',
  'test-step15.mjs',
  'test-step16.mjs',
  'test-step17.mjs',
  'test-step18.mjs',
];

let totalPassed = 0;
console.log('==================================================');
console.log(' RUNNING FULL REGRESSION SUITE (STEPS 4-18)');
console.log('==================================================');

for (const t of tests) {
  process.stdout.write(`Running ${t.padEnd(16)} `);
  try {
    const out = execSync(`"${process.execPath}" ${t}`, {
      stdio: 'pipe',
      maxBuffer: 50 * 1024 * 1024,
      timeout: 180000,
    }).toString();
    const passedMatch = out.match(/SUMMARY:\s*.*?(\d+)\s+PASSED/is) || out.match(/(\d+)\s+PASSED/i);
    const count = passedMatch ? parseInt(passedMatch[1], 10) : 0;
    totalPassed += count;
    console.log(`✓ PASS (${count > 0 ? count + ' assertions' : 'OK'})`);
  } catch (err) {
    console.log('✗ FAIL');
    if (err.stdout) console.error(err.stdout.toString());
    if (err.stderr) console.error(err.stderr.toString());
    console.error(err.message);
    process.exit(1);
  }
}

console.log('==================================================');
console.log(` ALL 15 TEST SUITES PASSED CLEANLY! Total: ${totalPassed} assertions`);
console.log('==================================================');
