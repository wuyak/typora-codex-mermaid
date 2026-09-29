/* View-only UI lives outside Typora's editable/exported document. */
export class DiagramViewer {
  constructor() {
    this.items = new Map();
    this.host = document.createElement('div');
    this.host.id = 'codex-mermaid-viewer';
    this.host.setAttribute('contenteditable', 'false');
    this.root = this.host.attachShadow({mode:'open'});
    this.root.innerHTML = `<style>
      :host{all:initial;position:fixed;inset:0;z-index:10001;pointer-events:none;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#263443}
      *{box-sizing:border-box}button{font:inherit;cursor:pointer;border:1px solid #d8e0e8;border-radius:7px;background:#fff;color:inherit;padding:6px 10px;white-space:nowrap}button:hover{background:#edf5ff}button:focus-visible{outline:2px solid #3684ce;outline-offset:2px}button:disabled{opacity:.4;cursor:default}
      .launch{position:fixed;pointer-events:auto;box-shadow:0 2px 8px #0000000d;font-size:12px;padding:5px 9px}
      .backdrop{position:fixed;inset:0;background:#0005;pointer-events:auto}.panel{position:fixed;left:5vw;right:5vw;top:6vh;bottom:6vh;display:flex;flex-direction:column;background:#fff;border:1px solid #d8e0e8;border-radius:14px;overflow:hidden;box-shadow:0 16px 70px #0004;pointer-events:auto}
      [hidden]{display:none!important}.bar{display:flex;gap:6px;align-items:center;padding:12px 14px;border-bottom:1px solid #e6ebef;flex-wrap:wrap}.title{font-weight:600;margin-right:auto}.percent{font-variant-numeric:tabular-nums;min-width:46px;text-align:center}.close{border:0;font-size:20px;padding:0 7px}
      .canvas{flex:1;min-height:0;overflow:hidden;position:relative;touch-action:none;cursor:grab;background:radial-gradient(#dce3ea 0.7px,transparent 0.7px) 0 0/18px 18px}.canvas:active{cursor:grabbing}.stage{position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none}.stage svg{display:block;max-width:none!important;overflow:visible}.hint{padding:10px 14px;color:#647383;border-top:1px solid #e6ebef;font-size:12px;line-height:1.5}
      .dark{color:#e5edf5;background:#212121;border-color:#4b535b}.dark button{background:#30343a;border-color:#4b535b}.dark button:hover{background:#394859}.dark .bar,.dark .hint{border-color:#41464d}.dark .hint{color:#b9c2ce}.dark .canvas{background-color:#212121;background-image:radial-gradient(#46505a 0.7px,transparent 0.7px)}
      @media print{:host{display:none!important}}
    </style><div class="backdrop" hidden></div><aside class="panel" hidden role="dialog" aria-modal="true" aria-label="图表预览"><div class="bar"><span class="title">图表</span><button data-action="out" aria-label="缩小图表">−</button><span class="percent">100%</span><button data-action="in" aria-label="放大图表">＋</button><button data-action="fit">适配</button><button data-action="actual">100%</button><button class="close" data-action="close" aria-label="关闭图表预览">×</button></div><div class="canvas" tabindex="0" aria-label="可拖动、缩放的图表"><div class="stage"></div></div><div class="hint">拖动移动 · 滚轮/双指滑动平移 · ⌘/Ctrl＋滚轮或捏合缩放 · Esc 或点击弹窗外关闭</div></aside>`;
    document.body.append(this.host);
    this.panel = this.root.querySelector('.panel');
    this.backdrop = this.root.querySelector('.backdrop');
    this.canvas = this.root.querySelector('.canvas');
    this.stage = this.root.querySelector('.stage');
    this.abort = new AbortController();
    const on = (target,type,fn,options={}) => target.addEventListener(type,fn,{...options,signal:this.abort.signal});
    const diagramAt = target => {
      const svg=target?.closest?.('svg.mermaid-svg');
      return svg?.closest('.md-diagram-panel-preview')?svg:null;
    };
    // Typora normally focuses CodeMirror when the preview is clicked. Reserve
    // primary clicks for viewing; the explicit edit control uses its native API.
    for(const type of ['pointerdown','mousedown'])on(document,type,e=>{
      if(e.button===0&&diagramAt(e.target)){e.preventDefault();e.stopImmediatePropagation();}
    },{capture:true});
    on(document,'click',e=>{
      const svg=diagramAt(e.target);
      if(e.button!==0||!svg)return;
      e.preventDefault();e.stopImmediatePropagation();this.show(svg);
    },{capture:true});
    on(this.backdrop,'click',()=>this.close());
    on(this.root,'click',e=>{
      const action=e.target.closest('[data-action]')?.dataset.action;
      if(action==='close')this.close();
      if(action==='fit')this.fit();
      if(action==='actual')this.zoomTo(1);
      if(action==='in')this.zoomTo(this.zoom*1.25);
      if(action==='out')this.zoomTo(this.zoom/1.25);
    });
    on(this.root,'keydown',e=>{
      if(this.panel.hidden)return;
      if(e.key==='+'||e.key==='='){e.preventDefault();this.zoomTo(this.zoom*1.25);}
      if(e.key==='-'){e.preventDefault();this.zoomTo(this.zoom/1.25);}
      if(e.key==='0'){e.preventDefault();this.fit();}
    });
    on(document,'keydown',e=>{
      if(this.panel.hidden)return;
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.close();}
      if(e.key==='Tab'){
        const focusable=[...this.panel.querySelectorAll('button,.canvas')];
        const at=focusable.indexOf(this.root.activeElement);
        const next=(at+(e.shiftKey?-1:1)+focusable.length)%focusable.length;
        e.preventDefault();e.stopPropagation();focusable[next].focus();
      }
    },{capture:true});
    on(this.canvas,'wheel',e=>{
      e.preventDefault();e.stopPropagation();
      if(e.ctrlKey||e.metaKey){const r=this.canvas.getBoundingClientRect();this.zoomTo(this.zoom*Math.exp(-e.deltaY*.008),e.clientX-r.left,e.clientY-r.top);}
      else{const multiplier=e.deltaMode===1?16:e.deltaMode===2?this.canvas.clientHeight:1;this.x-=e.deltaX*multiplier;this.y-=e.deltaY*multiplier;this.paint();}
    },{passive:false});
    on(this.canvas,'pointerdown',e=>{if(e.button!==0)return;e.preventDefault();this.canvas.focus();this.canvas.setPointerCapture(e.pointerId);this.drag={id:e.pointerId,x:e.clientX,y:e.clientY};});
    on(this.canvas,'pointermove',e=>{if(this.drag?.id!==e.pointerId)return;this.x+=e.clientX-this.drag.x;this.y+=e.clientY-this.drag.y;this.drag.x=e.clientX;this.drag.y=e.clientY;this.paint();});
    const end=e=>{if(this.drag?.id===e.pointerId)this.drag=null;};
    on(this.canvas,'pointerup',end);on(this.canvas,'pointercancel',end);on(this.canvas,'lostpointercapture',end);
    on(this.canvas,'gesturestart',e=>{e.preventDefault();this.gestureZoom=this.zoom;},{passive:false});
    on(this.canvas,'gesturechange',e=>{e.preventDefault();const r=this.canvas.getBoundingClientRect();this.zoomTo(this.gestureZoom*e.scale,e.clientX-r.left,e.clientY-r.top);},{passive:false});
    on(document,'scroll',()=>this.schedule(),{capture:true,passive:true});
    on(window,'resize',()=>{if(!this.panel.hidden)this.fit();this.schedule();});
    this.observer=new MutationObserver(()=>this.schedule());
    this.observer.observe(document.querySelector('#write')||document.body,{childList:true,subtree:true});
    this.schedule();
  }
  schedule(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=null;this.scan();});}
  scan(){
    const svgs=new Set(document.querySelectorAll('.md-diagram-panel-preview svg.mermaid-svg'));
    for(const [svg,button] of this.items)if(!svgs.has(svg)){button.remove();this.items.delete(svg);}
    if(this.current&&!this.current.isConnected){
      // A normal edit replaces the SVG. Retain the selected block when possible.
      const replacement=this.block?.querySelector('.md-diagram-panel-preview svg.mermaid-svg');
      if(replacement)this.show(replacement,false);else this.close(false);
    }
    const contentRect=document.querySelector('body > content')?.getBoundingClientRect();
    const docRight=contentRect?.right||innerWidth;
    const docTop=Math.max(12,(contentRect?.top||0)+8);
    for(const svg of svgs){
      let button=this.items.get(svg);
      if(!button){button=document.createElement('button');button.className='launch';button.textContent='编辑源码';button.title='编辑这张图的 Mermaid 源码';button.addEventListener('click',()=>this.edit(svg));this.root.append(button);this.items.set(svg,button);}
      const r=svg.getBoundingClientRect();
      button.hidden=!this.panel.hidden||r.bottom<docTop+40||r.top>innerHeight-45||r.width<20;
      button.style.left=`${Math.max(8,Math.min(r.right,docRight)-103)}px`;
      button.style.top=`${Math.max(docTop,r.top+8)}px`;
    }
  }
  edit(svg){
    const block=svg.closest('.md-fences, .md-diagram');
    const cm=block?.querySelector('.CodeMirror')?.CodeMirror ||
      (block?.getAttribute('cid') && window.File?.editor?.fences?.getCm(block.getAttribute('cid')));
    if(cm){cm.refresh();cm.focus();}
  }
  show(svg,focus=true){
    this.current=svg;this.block=svg.closest('.md-diagram')||svg.parentElement;
    if(this.panel.hidden){
      this.previousFocus=document.activeElement;
      this.panel.hidden=false;this.backdrop.hidden=false;
    }
    const dark=typeof window.File?.colorBrightness==='number'?window.File.colorBrightness<.5:matchMedia('(prefers-color-scheme: dark)').matches;
    this.panel.classList.toggle('dark',dark);
    const clone=svg.cloneNode(true);clone.removeAttribute('tabindex');
    const box=svg.viewBox.baseVal;this.svgWidth=box.width||svg.width.baseVal.value||800;this.svgHeight=box.height||svg.height.baseVal.value||600;
    clone.style.setProperty('width',`${this.svgWidth}px`,'important');clone.style.setProperty('height',`${this.svgHeight}px`,'important');
    this.stage.replaceChildren(clone);this.fit();if(focus)this.canvas.focus();this.schedule();
  }
  fit(){this.zoom=Math.min((this.canvas.clientWidth-48)/this.svgWidth,(this.canvas.clientHeight-48)/this.svgHeight,1);this.zoom=Math.max(.05,this.zoom);this.x=(this.canvas.clientWidth-this.svgWidth*this.zoom)/2;this.y=(this.canvas.clientHeight-this.svgHeight*this.zoom)/2;this.paint();}
  zoomTo(next,cx=this.canvas.clientWidth/2,cy=this.canvas.clientHeight/2){next=Math.max(.05,Math.min(8,next));const factor=next/this.zoom;this.x=cx-(cx-this.x)*factor;this.y=cy-(cy-this.y)*factor;this.zoom=next;this.paint();}
  paint(){this.stage.style.transform=`translate(${this.x}px,${this.y}px) scale(${this.zoom})`;this.root.querySelector('.percent').textContent=`${Math.round(this.zoom*100)}%`;}
  close(focus=true){
    const previous=this.current;this.panel.hidden=true;this.backdrop.hidden=true;this.stage.replaceChildren();this.current=null;this.block=null;
    if(focus){
      const target=this.items.get(previous);
      if(target){target.hidden=false;target.focus();}
      else if(this.previousFocus?.isConnected)this.previousFocus.focus();
    }
    this.previousFocus=null;this.schedule();
  }
  destroy(){this.close(false);this.observer.disconnect();this.abort.abort();if(this.frame)cancelAnimationFrame(this.frame);this.host.remove();this.items.clear();}
}
