// Render an example with the same engine that the Typora plugin uses.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const root=path.resolve(import.meta.dirname,'..');
const examples={
  'plugin-overview':{title:'Typora Codex Mermaid 的形成过程',nodes:17,edges:18},
  'publishing-workflow':{title:'内容发布流程',nodes:12,edges:14},
  'knowledge-search':{title:'知识检索与问答',nodes:12,edges:13},
};
const name=process.argv[2]||'plugin-overview';
const example=examples[name];
if(!example)throw new Error(`Unknown example: ${name}`);
const run=promisify(execFile);
const cli=path.join(root,'node_modules/.bin/playwright-cli');
const routes=new Map([
  ['/engine.js',['dist/engine.js','text/javascript']],
  ['/renderer.js',['dist/renderer.js','text/javascript']],
  ['/example.mmd',[`examples/${name}.mmd`,'text/plain; charset=utf-8']],
]);
for(const [file] of routes.values())if(!fs.existsSync(path.join(root,file)))throw new Error(`Missing ${file}; run npm run extract and npm run build first.`);
const server=http.createServer((req,res)=>{
  if(req.url==='/'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end('<!doctype html><meta charset="utf-8"><title>Mermaid example</title><script src="/engine.js"></script><script src="/renderer.js"></script>');
    return;
  }
  const route=routes.get(req.url);
  if(!route){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':route[1]});
  res.end(fs.readFileSync(path.join(root,route[0])));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const call=async(...args)=>(await run(cli,['-s=codex-mermaid-example',...args],{cwd:root,maxBuffer:16*1024*1024})).stdout;
try{
  await call('open',`http://127.0.0.1:${server.address().port}/`);
  const out=await call('run-code',`async(page)=>{
    await page.waitForFunction(()=>window.CodexMermaidRenderer);
    return await page.evaluate(async()=>{
      const source=await(await fetch('/example.mmd')).text();
      const result=await CodexMermaidRenderer.render(${JSON.stringify(name)},source,{dark:false});
      const template=document.createElement('template');template.innerHTML=result.svg;
      const svg=template.content.querySelector('svg');
      const dims=svg.getAttribute('viewBox').split(/\\s+/).map(Number);
      svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
      svg.setAttribute('width',Math.ceil(dims[2]));svg.setAttribute('height',Math.ceil(dims[3]));
      svg.style.backgroundColor='#ffffff';
      svg.setAttribute('role','img');svg.setAttribute('aria-label',${JSON.stringify(example.title)});
      const title=document.createElementNS('http://www.w3.org/2000/svg','title');
      title.textContent=${JSON.stringify(example.title)};svg.prepend(title);
      const text=new XMLSerializer().serializeToString(svg);
      const url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml;charset=utf-8'}));
      try{
        const image=new Image();image.src=url;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(dims[2]*2);canvas.height=Math.ceil(dims[3]*2);
        const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
        return {svg:text,png:canvas.toDataURL('image/png').split(',')[1],width:dims[2],height:dims[3],nodes:svg.querySelectorAll('.node').length,edges:svg.querySelectorAll('.flowchart-link').length};
      }finally{URL.revokeObjectURL(url);}
    });
  }`);
  const match=out.match(/### Result\n([\s\S]*?)\n### Ran/);
  if(!match)throw new Error(out);
  const result=JSON.parse(match[1]);
  if(result.nodes!==example.nodes||result.edges!==example.edges)throw new Error('Unexpected example structure');
  fs.mkdirSync(path.join(root,'output'),{recursive:true});
  fs.writeFileSync(path.join(root,`examples/${name}.svg`),result.svg+'\n');
  fs.writeFileSync(path.join(root,`output/${name}.png`),Buffer.from(result.png,'base64'));
  console.log(`Rendered examples/${name}.svg: ${Math.ceil(result.width)} × ${Math.ceil(result.height)}, ${result.nodes} nodes, ${result.edges} edges.`);
}finally{
  try{await call('close');}finally{server.close();}
}
