import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const cli = process.env.PLAYWRIGHT_CLI || path.join(root, 'node_modules', '.bin', 'playwright-cli');
const session = 'codex-mermaid-verification';
const outputPath = path.join(root, 'output', 'verification.json');
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function within(target, parent) {
  return target === parent || target.startsWith(`${parent}${path.sep}`);
}

function allowedFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/') || decoded.includes('\0')) return null;

  const relative = decoded.slice(1);
  const candidate = path.resolve(root, relative);
  const allowed = [
    path.join(root, 'tests'),
    path.join(root, 'dist'),
  ].some(directory => within(candidate, directory)) || candidate === path.join(root, 'evidence', 'reference.js');
  if (!allowed || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return null;

  // Resolve symlinks before serving. A symlink in an allowed directory must not
  // turn the small test server into a project-wide file server.
  const real = fs.realpathSync(candidate);
  const realAllowed = [
    fs.realpathSync(path.join(root, 'tests')),
    fs.realpathSync(path.join(root, 'dist')),
  ].some(directory => within(real, directory)) || real === fs.realpathSync(path.join(root, 'evidence', 'reference.js'));
  return realAllowed ? real : null;
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
  const file = allowedFile(requestUrl.pathname);
  if (!file) {
    res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('Not found');
    return;
  }
  res.writeHead(200, {'Content-Type': mime[path.extname(file)] || 'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});

const call = async (...args) => {
  const {stdout} = await run(cli, [`-s=${session}`, ...args], {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
};

function parseRunCode(stdout) {
  const match = stdout.match(/### Result\n([\s\S]*?)\n### Ran/);
  if (!match) throw new Error(`Playwright CLI did not return a run-code result:\n${stdout}`);
  return JSON.parse(match[1]);
}

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/tests/preview.html`;
let closeError;
let opened = false;

try {
  if (!fs.existsSync(cli)) {
    throw new Error(`Playwright CLI not found at ${cli}; run npm install or set PLAYWRIGHT_CLI.`);
  }

  await call('open', url);
  opened = true;
  const code = `async(page)=>{
    await page.waitForFunction(()=>window.results?.length===2||window.failure);
    const error=await page.evaluate(()=>window.failure);
    if(error)throw new Error(error);
    for(const name of ['checks','parity','viewer-checks']){
      await page.addScriptTag({url:new URL(name+'.js',page.url()).href});
    }
    await page.addScriptTag({url:new URL('../evidence/reference.js',page.url()).href});
    const baseline=await page.evaluate(async()=>({
      checks:await runChecks(),
      parity:await runParity(),
      viewer:await runViewerChecks(),
    }));
    await page.addInitScript(()=>{
      window.Node=class TestNode{};
      window.mermaidAPI=Object.freeze({render:async()=>({svg:'native'}),initialize:()=>{}});
      window.originalMermaidAPI=window.mermaidAPI;
      window.File={colorBrightness:1,editor:{diagrams:{refreshDiagram(){window.refreshCount=(window.refreshCount||0)+1;}}}};
    });
    await page.reload();
    await page.waitForFunction(()=>window.results?.length===2||window.failure);
    const collision=await page.evaluate(()=>({ok:!window.failure&&window.results?.length===2,error:window.failure}));
    if(!collision.ok)throw new Error('Typora Node collision: '+collision.error);
    await page.addScriptTag({type:'module',url:new URL('../dist/main.js',page.url()).href});
    await page.waitForFunction(()=>window.mermaidAPI!==window.originalMermaidAPI);
    await page.addScriptTag({url:new URL('word-export-checks.js',page.url()).href});
    const wordExport=await page.evaluate(()=>runWordExportChecks());
    const lifecycle=await page.evaluate(async()=>{
      const result=await mermaidAPI.render('live-test','flowchart LR\\nA[Before]-->B[After]');
      const preserved=mermaidAPI.initialize===originalMermaidAPI.initialize;
      window[Symbol.for('local.codex-mermaid.instance')].onunload();
      return {ok:result.svg.includes('After')&&preserved&&mermaidAPI===originalMermaidAPI,refreshed:refreshCount||0};
    });
    if(!lifecycle.ok)throw new Error('Typora integration lifecycle failed');
    return {...baseline,wordExport,host:{collision,lifecycle}};
  }`;
  const report = parseRunCode(await call('run-code', code));
  const failures = [
    ...report.checks.filter(item => !item.ok),
    ...report.parity.filter(item => !item.match),
    ...report.viewer.filter(item => !item.ok),
    ...report.wordExport.filter(item => !item.ok),
  ];
  if (failures.length || !report.host?.collision?.ok || !report.host?.lifecycle?.ok) {
    throw new Error(`Renderer verification failed: ${JSON.stringify(failures)}`);
  }
  fs.mkdirSync(path.dirname(outputPath), {recursive: true});
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Passed ${report.checks.length} behavior checks, ${report.parity.length} reference comparisons, ${report.viewer.length} viewer checks, and ${report.wordExport.length} Word export checks.`);
} finally {
  if (opened) {
    try {
      await call('close');
    } catch (error) {
      closeError = error;
    }
  }
  await new Promise(resolve => server.close(resolve));
  if (closeError) throw closeError;
}
