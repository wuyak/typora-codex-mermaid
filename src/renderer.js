/* Host adapter for the Codex 26.924.22138 Mermaid renderer.
 * Layout geometry and flowchart CSS are extracted unchanged from the installed app.
 * The engine is private: it never replaces Typora's global mermaid instance.
 */
(() => {
  const {mermaid, elk, flowchartLayout, flowchartCSS} = window.CodexMermaidEngine;
  let queue = Promise.resolve();
  const cache = new Map();
  function theme(dark,accent='blue',overrides={}) {
    // The host supplies Codex's visualization tokens; the exact extracted
    // Codex theme builder derives Mermaid colors, including the pale primary.
    return window.CodexMermaidEngine.buildTheme({
      '--font-sans':'-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      '--font-size-base':'14px',
      '--background':dark?'#212121':'#ffffff',
      '--secondary':dark?'rgba(54,54,54,0.96)':'rgba(255,255,255,0.96)',
      '--foreground':dark?'#ffffff':'#1a1c1f',
      '--muted-foreground':dark?'rgba(255,255,255,0.498)':'rgba(26,28,31,0.494)',
      '--border':dark?'rgba(255,255,255,0.082)':'rgba(26,28,31,0.08)',
      '--accent':dark?'#0d273f':'#e5f2ff',
      '--accent-foreground':dark?'#83c3ff':'#339cff',
      ...overrides,
    },dark,accent);
  }

  // Codex isolates layout measurement from the surrounding Markdown CSS.
  function isolatedLayout(layout) {
    return {...layout, loader:async()=>{
      const original=await layout.loader();
      return {render:async(data,svg,helpers,options,extra)=>{
        const node=svg.node();
        if(!node?.parentElement)throw new Error('Missing Mermaid render container');
        const host=node.ownerDocument.createElement('div');
        node.parentElement.append(host);
        const shadow=host.attachShadow({mode:'open'});
        shadow.append(node);
        try {
          await original.render(data,svg.selectAll(function(){return [this]}),{
            ...helpers,
            insertMarkers(...args){
              helpers.insertMarkers(...args);
              for(const marker of node.querySelectorAll('marker'))host.append(marker.cloneNode(true));
            },
            insertEdge(...args){
              const result=helpers.insertEdge(...args);
              for(const marker of host.querySelectorAll('marker'))if(!shadow.getElementById(marker.id))node.append(marker.cloneNode(true));
              return result;
            },
          },options,extra);
        } finally {host.before(node);host.remove();}
      }};
    }};
  }
  mermaid.registerLayoutLoaders([
    {name:'elk',algorithm:'elk.layered',loader:async()=>elk},
    ...['elk.stress','elk.force','elk.mrtree','elk.sporeOverlap'].map(name=>({name,algorithm:name,loader:async()=>elk})),
    flowchartLayout,
  ].map(isolatedLayout));

  function sanitize(source) {
    let forbidden=false;
    const text=source.replace(/%%\{[\s\S]*?\}%%/g,directive=>{
      if(/["']?securityLevel["']?\s*:/i.test(directive)){forbidden=true;return '';}
      const match=directive.match(/^%%\{\s*(?:init|initialize)\s*:\s*(\{[\s\S]*\})\s*\}%%$/i);
      if(match)try{
        const obj=JSON.parse(match[1].replaceAll("'",'"'));
        const tv=obj.themeVariables;
        if(Object.keys(obj).every(k=>['theme','themeVariables'].includes(k)) &&
          (obj.theme===undefined||obj.theme==='base') && tv &&
          Object.keys(tv).every(k=>k==='sequenceNumberColor') &&
          /^#(?:[a-f0-9]{3}|(?:[a-f0-9]{2}){2,4})$/i.test(tv.sequenceNumberColor))
          return `%%{init: ${JSON.stringify({theme:'base',themeVariables:{sequenceNumberColor:tv.sequenceNumberColor}})}}%%`;
      }catch{}
      return '';
    }).replace(/^\s*click\s+.*$/gim,'').trim();
    if(forbidden||!text)throw new Error('Invalid or unsupported diagram');
    return text;
  }
  function heal(source) {
    if(!/^\s*(?:flowchart|graph)\b/im.test(source))return source;
    const quote=(all,id,label,open,close)=>{
      if(!/[()|]/.test(label))return all;
      const lead=label.match(/^\s*/)?.[0]||'',trail=label.match(/\s*$/)?.[0]||'';
      const core=label.slice(lead.length,label.length-trail.length);
      return !core||core.startsWith('"')&&core.endsWith('"')?all:`${id}${open}${lead}"${core.replace(/"/g,'\\"')}"${trail}${close}`;
    };
    return source.replace(/(\b[A-Za-z0-9_][A-Za-z0-9_.:-]*)\[([^\]\n]*)\]/g,(a,b,c)=>quote(a,b,c,'[',']'))
      .replace(/(\b[A-Za-z0-9_][A-Za-z0-9_.:-]*)\{([^}\n]*)\}/g,(a,b,c)=>quote(a,b,c,'{','}'));
  }
  async function renderNow(id,source,{dark=false,themeVariables}={}) {
    const first=source.split(/\r?\n/).find(l=>l.trim()&&!l.trim().startsWith('%%'))||'';
    const flow=/^[\t ]*(?:flowchart|graph)\b/i.test(first);
    const tokens=themeVariables||theme(dark);
    const types=['flowchart','sequence','gantt','journey','class','state','er','pie','quadrantChart','xyChart','requirement','mindmap','kanban','timeline','gitGraph','c4','sankey','block','packet','architecture','radar'];
    mermaid.initialize({
      startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,theme:'base',themeVariables:tokens,
      layout:flow?'chatgpt-flowchart':'elk',...(flow?{themeCSS:flowchartCSS(tokens)}:{}),
      darkMode:dark,fontFamily:tokens.fontFamily,htmlLabels:false,
      ...Object.fromEntries(types.map(t=>[t,{useMaxWidth:false}])),
    });
    await document.fonts.ready;
    const host=document.createElement('div');
    host.inert=true;host.setAttribute('aria-hidden','true');
    Object.assign(host.style,{position:'fixed',inset:'0',visibility:'hidden',pointerEvents:'none'});
    document.body.append(host);
    const unique=document.getElementById(id)==null?id:`${id}-${crypto.randomUUID()}`;
    try {
      await new Promise(resolve=>{const timer=setTimeout(resolve,50);requestAnimationFrame(()=>{clearTimeout(timer);setTimeout(resolve,0)});});
      let result;
      try{result=await mermaid.render(unique,source,host);}catch(error){
        const healed=heal(source);if(healed===source)throw error;
        result=await mermaid.render(`${unique}-healed`,healed,host);
      }
      if(!result.svg)throw new Error('Invalid Mermaid SVG output');
      if(dark){
        const template=document.createElement('template');template.innerHTML=result.svg;
        for(const shape of template.content.querySelectorAll('.node > .label-container[style*="fill"], .node > .label-container.outer-path > path[style*="fill"]')){
          const fill=shape.style.getPropertyValue('fill');
          if(CSS.supports('color',fill)){
            if(fill.trim().toLowerCase()!=='transparent')shape.style.setProperty('fill',`color-mix(in oklab, ${fill} 22%, ${tokens.surfaceColor})`,'important');
            shape.closest('.node')?.querySelectorAll('text,tspan').forEach(el=>el.style.setProperty('fill',tokens.textColor,'important'));
          }
        }
        result.svg=template.innerHTML;
      }
      return result;
    } finally {host.remove();}
  }
  window.CodexMermaidRenderer={
    version:'26.924.22138',mermaidVersion:'11.16.0',theme,
    render(id,source,options={}){
      let clean;try{clean=sanitize(source);}catch(error){return Promise.reject(error);}
      const dark=options.dark??false;
      const themeVariables=options.themeVariables||theme(dark,options.accent||'blue',options.tokens||{});
      const key=`${id}:${JSON.stringify(themeVariables)}:${dark?'dark':'light'}:${clean}`;
      if(cache.has(key))return cache.get(key);
      const pending=queue.then(()=>renderNow(id,clean,{dark,themeVariables}));
      queue=pending.catch(()=>{});
      cache.set(key,pending);
      pending.catch(()=>cache.delete(key));
      while(cache.size>50)cache.delete(cache.keys().next().value);
      return pending;
    },
    clearCache(){cache.clear();},
  };
})();
