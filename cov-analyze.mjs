import fs from 'fs'
import path from 'path'
const tmpDir = './coverage/.tmp'
const files = fs.readdirSync(tmpDir)
const merged = {}
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(path.join(tmpDir, f), 'utf8'))
  for (const [k, v] of Object.entries(data)) {
    if (!merged[k]) { merged[k] = JSON.parse(JSON.stringify(v)) }
    else {
      for (const id of Object.keys(v.s || {})) merged[k].s[id] = (merged[k].s[id]||0) + v.s[id]
      for (const id of Object.keys(v.f || {})) merged[k].f[id] = (merged[k].f[id]||0) + v.f[id]
      for (const id of Object.keys(v.b || {})) {
        if (!merged[k].b[id]) merged[k].b[id] = v.b[id].map(()=>0)
        v.b[id].forEach((c,i) => { merged[k].b[id][i] = (merged[k].b[id][i]||0) + c })
      }
    }
  }
}
const rows = []
for (const [file, data] of Object.entries(merged)) {
  const sf = Object.values(data.s||{}); const ff = Object.values(data.f||{}); const bf = Object.values(data.b||{}).flat()
  const sp = sf.length ? +(sf.filter(x=>x>0).length/sf.length*100).toFixed(1) : 100
  const fp = ff.length ? +(ff.filter(x=>x>0).length/ff.length*100).toFixed(1) : 100
  const bp = bf.length ? +(bf.filter(x=>x>0).length/bf.length*100).toFixed(1) : 100
  const shortFile = file.replace(/.*\/src\//,'src/')
  rows.push({ shortFile, sp, fp, bp, min: Math.min(sp,fp,bp) })
}
rows.sort((a,b)=>a.min-b.min)
for (const r of rows) {
  if (r.min < 95) console.log(`${r.shortFile}\n  stmts:${r.sp}% funcs:${r.fp}% branches:${r.bp}%\n`)
}
console.log('--- All files ---')
for (const r of rows) {
  console.log(`${r.shortFile} | stmts:${r.sp}% funcs:${r.fp}% branches:${r.bp}%`)
}
