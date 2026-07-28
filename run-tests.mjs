import { execSync } from 'child_process'
import { writeFileSync } from 'fs'

try {
  const out = execSync(
    'npx vitest run --reporter=verbose 2>&1',
    { encoding: 'utf8', timeout: 180000, cwd: process.cwd() }
  )
  writeFileSync('test-results.txt', out)
  console.log('Written to test-results.txt')
} catch (e) {
  writeFileSync('test-results.txt', (e.stdout || '') + '\n' + (e.stderr || '') + '\n' + e.message)
  console.log('Error captured to test-results.txt')
}
