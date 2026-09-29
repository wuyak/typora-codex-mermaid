import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..');
process.chdir(root);
if (!fs.existsSync('vendor/entry.js') || !fs.existsSync('THIRD_PARTY_NOTICES.txt')) {
  throw new Error('Missing local renderer assets. Run npm run extract with the supported Codex installation first.');
}
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
fs.mkdirSync('dist',{recursive:true});
await build({entryPoints:['vendor/entry.js'],bundle:true,format:'iife',globalName:'CodexMermaidEngine',outfile:'dist/engine.js',minify:true,target:'safari16',logLevel:'error',define:{'import.meta.url':'""'},plugins:[{name:'typora-native-node',setup(build){build.onLoad({filter:/chunk-WYO6CB5R-ff77854baf33\.js$/},async(args)=>{const source=fs.readFileSync(args.path,'utf8');const from='o=e.Node,s=e.Element';if(!source.includes(from))throw new Error('DOMPurify host adaptation needs review');return {contents:source.replace(from,'o=Object.getPrototypeOf(e.Element.prototype).constructor,s=e.Element'),loader:'js'};});}}]});
fs.copyFileSync('src/renderer.js','dist/renderer.js');
fs.copyFileSync('src/viewer.js','dist/viewer.js');
if(fs.existsSync('src/plugin.js'))fs.copyFileSync('src/plugin.js','dist/main.js');
fs.writeFileSync('dist/manifest.json',JSON.stringify({id:'local.codex-mermaid',name:'Codex Mermaid',description:'Codex Mermaid renderer, ELK layout, and native editing in Typora.',author:'local',version,minAppVersion:'1.13.4',platforms:['darwin']},null,2));
console.log('Built offline Codex Mermaid plugin.');

for(const name of ['NOTICE','THIRD_PARTY_NOTICES.txt'])fs.copyFileSync(name,'dist/'+name);
