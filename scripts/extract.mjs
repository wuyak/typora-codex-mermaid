// Build from a supported local Codex installation. The application is read only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';

const root = path.resolve(import.meta.dirname, '..');
const asarPath = process.argv[2] || '/Applications/ChatGPT.app/Contents/Resources/app.asar';
const buf = fs.readFileSync(asarPath);
const header = JSON.parse(buf.subarray(16, 16 + buf.readUInt32LE(12)));
const base = 8 + buf.readUInt32LE(4);
const pkgFile = header.files['package.json'];
const codexVersion = JSON.parse(buf.subarray(base + Number(pkgFile.offset), base + Number(pkgFile.offset) + pkgFile.size).toString()).version;
if (codexVersion !== '26.924.22138') {
  throw new Error(`Unsupported Codex version ${codexVersion}; this extractor is verified with 26.924.22138. No output was changed.`);
}
const noticePath = path.join(path.dirname(asarPath), 'THIRD_PARTY_NOTICES.txt');
const notices = fs.readFileSync(noticePath);
const files = header.files.webview.files.assets.files;
function read(name) {
  const f = files[name];
  if (!f || f.unpacked) throw new Error(`Missing packed module ${name}`);
  return buf.subarray(base + Number(f.offset), base + Number(f.offset) + f.size).toString();
}
const imageName = Object.keys(files).find(n => /^image-.*\.js$/.test(n) && read(n).includes('name:`chatgpt-flowchart`'));
if (!imageName) throw new Error('Codex flowchart implementation was not found; do not guess after an update.');
const image = read(imageName);
const sourceSHA256 = crypto.createHash('sha256').update(image).digest('hex');
if (sourceSHA256 !== '5e60df67a02540c734347d84a6d542b1db093adff650f5c2fb3b224b3158f32d') {
  throw new Error('Codex renderer fingerprint changed; review the extractor before using this build.');
}
fs.mkdirSync(path.join(root, 'evidence'), {recursive:true});
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), notices);
const coreName = image.match(/import\(`\.\/(mermaid\.core-[^`]+\.js)`\)/)?.[1];
const elkName = image.match(/import\(`\.\/(render-[^`]+\.js)`\)/)?.[1];
if (!coreName || !elkName) throw new Error('Codex dependency layout has changed.');
const out = path.join(root, 'vendor');
fs.mkdirSync(out, { recursive: true });
const seen = new Map(), pending = [coreName, elkName], sharedImports = new Set();
while (pending.length) {
  const n = pending.pop();
  if (seen.has(n)) continue;
  let s = read(n);
  for (const m of s.matchAll(/import\{([^}]+)\}from["'`]\.\/(app-shared-[^"'`]+\.js)["'`]/g)) {
    for (const name of m[1].split(',')) sharedImports.add(name.trim().split(/\s+as\s+/)[0]);
  }
  for (const [, dep] of s.matchAll(/["'`]\.\/([^"'`]+\.js)["'`]/g)) {
    if (dep.startsWith('app-')) continue;
    // ELK's bundled CommonJS source mentions these fallbacks but embeds its worker.
    if (!files[dep] && ['elk-worker.min.js', 'elk-api.js'].includes(dep)) continue;
    pending.push(dep);
  }
  s = s.replace(/\.\/app-shared-[^"'`]+\.js/g, './codex-shared.js');
  seen.set(n, s);
}

// Keep the exact marked and UUID helpers used by Mermaid, excluding the app UI.
// Resolve lexical references rather than copying the entire application bundle.
const sharedName = image.match(/from"\.\/(app-shared-[^"]+\.js)"/)[1];
const shared = read(sharedName);
const ast = parse(shared, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
const manager = analyze(ast, { ecmaVersion: 2024, sourceType: 'module', optimistic: true, ignoreEval: true });
const scope = manager.scopes.find(s => s.type === 'module');
const exports = new Map();
for (const s of ast.body) if (s.type === 'ExportNamedDeclaration')
  for (const e of s.specifiers) exports.set(e.exported.name, e.local.name);
const stmtAt = pos => {
  let lo = 0, hi = ast.body.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ast.body[mid].end <= pos) lo = mid + 1; else hi = mid; }
  return lo;
};
const graph = new Map();
for (const sc of manager.scopes) for (const r of sc.references) {
  if (r.resolved?.scope !== scope) continue;
  const from = stmtAt(r.identifier.start);
  for (const def of r.resolved.defs) {
    const to = stmtAt(def.name.start);
    if (from !== to) { if (!graph.has(from)) graph.set(from, new Set()); graph.get(from).add(to); }
  }
}
const wanted = new Set(), queue = [];
for (const exp of sharedImports) {
  if (['H1t', 'U1t'].includes(exp)) continue; // Vite preloading is a host concern.
  const variable = scope.set.get(exports.get(exp));
  if (!variable) throw new Error(`Unresolved shared export ${exp}`);
  for (const def of variable.defs) queue.push(stmtAt(def.name.start));
}
while (queue.length) { const i = queue.pop(); if (wanted.has(i)) continue; wanted.add(i); queue.push(...graph.get(i) || []); }
let subset = [...wanted].sort((a,b) => a-b).map(i => shared.slice(ast.body[i].start, ast.body[i].end)).join('\n');
const mappings = [...sharedImports].filter(x => !['H1t','U1t'].includes(x)).map(x => `${exports.get(x)} as ${x}`);
subset += '\nexport async function H1t(factory) { return factory(); }\nexport function U1t() {}\n';
subset += `export {${mappings.join(',')}};\n`;
seen.set('codex-shared.js', subset);
for (const [n,s] of seen) fs.writeFileSync(path.join(out,n),s);

// Keep the actual geometry and CSS functions, with their original dependencies named.
const imageAst = parse(image, { ecmaVersion: 'latest', sourceType: 'module' });
const getFunction = name => {
  const node = imageAst.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  if (!node) throw new Error(`Missing reference function ${name}`);
  return image.slice(node.start,node.end);
};
const geometry = [getFunction('ye'), getFunction('be')].join('\n');
// Function names are locked to this source snapshot. A changed Codex build fails closed.
fs.writeFileSync(path.join(out, 'codex-flowchart.js'), `import {n as e} from './rolldown-runtime-2d059c5e81f4.js';\nimport * as elk from './${elkName}';\nconst D=[{name:'elk',algorithm:'elk.layered',loader:async()=>elk}];\nfunction O() {}\nlet A;\n${geometry}\nye();\nexport {A as flowchartLayout, be as flowchartCSS};\n`);
const chartName=image.match(/from"\.\/(chart-colors-[^"]+\.js)"/)[1];
fs.writeFileSync(path.join(out,chartName),read(chartName));
const themeFunctions=['V','We','H','Ge','U','Ue'].map(getFunction).join('\n');
fs.writeFileSync(path.join(out,'codex-theme.js'),`import {n as e} from './rolldown-runtime-2d059c5e81f4.js';\nimport {n as initializeCharts,t as ge} from './${chartName}';\nlet activeTokens,He;\nconst W=12,G='--mermaid-node-color',K='--mermaid-node-border-color',Ke=Array.from({length:W},(_,i)=>'--mermaid-chart-color-'+(i+1));\nconst me=()=>activeTokens,ue=color=>color;\n${themeFunctions}\ninitializeCharts();Ue();\nexport function buildTheme(tokens,dark,accent='blue'){activeTokens=tokens;return V({chatTheme:accent,isDarkMode:dark});}\n`);
fs.writeFileSync(path.join(out, 'entry.js'), `export {default as mermaid} from './${coreName}';\nexport {flowchartLayout,flowchartCSS} from './codex-flowchart.js';\nexport {buildTheme} from './codex-theme.js';\nimport * as elk from './${elkName}';\nexport {elk};\n`);
fs.writeFileSync(path.join(root, 'evidence', 'source-renderer.js'), image);
// Independent reference harness: preserve the original app's render functions.
const referenceFunctions=['Me','I','Pe','je','xe','Se','Ce','we','Te','Ee','ke'].map(getFunction).join('\n');
fs.writeFileSync(path.join(root,'evidence','reference.js'),`(()=>{const L=async()=>window.CodexMermaidEngine.mermaid,A=window.CodexMermaidEngine.flowchartLayout,be=window.CodexMermaidEngine.flowchartCSS;const ze=/^[\\t ]*(?:flowchart|graph)\\b/i,De=/^\\s*(?:flowchart|graph)\\b/im,Oe=/(\\b[A-Za-z0-9_][A-Za-z0-9_.:-]*)\\[([^\\]\\n]*)\\]/g,j=/(\\b[A-Za-z0-9_][A-Za-z0-9_.:-]*)\\{([^}\\n]*)\\}/g,N=22;\n${referenceFunctions}\nwindow.codexReferenceRender=Pe;})();\n`);
fs.writeFileSync(path.join(root, 'evidence', 'extraction.json'), JSON.stringify({
  asarPath, codexVersion,
  imageName, coreName, elkName, sharedName, sourceSHA256,
  modules: seen.size, sharedExports:[...sharedImports], sharedBytes:subset.length,
  extractedAt:new Date().toISOString()
},null,2));
console.log(JSON.stringify({imageName,coreName,elkName,modules:seen.size,sharedBytes:subset.length}));
