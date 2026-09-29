// Exercise Typora macOS's SVG-to-PNG sizing contract for document export.
window.runWordExportChecks = async () => {
  const checks=[];
  const source='flowchart LR\nA[Left edge]-->B[Read request]-->C[Validate input]-->D[Process request]-->E[Persist result]-->F[Right edge]';
  for(const width of [640,320]) {
    const fixture=document.createElement('div');
    fixture.className='word-export-fixture';
    fixture.style.width=width+'px';
    fixture.innerHTML='<style>.word-export-fixture > svg{max-width:100%;height:auto}</style>';
    document.body.append(fixture);
    let frame;
    try {
      const result=await mermaidAPI.render('export-'+width,source);
      fixture.insertAdjacentHTML('beforeend',result.svg);
      const svg=fixture.querySelector('svg');
      const bounds=svg.getBoundingClientRect();
      // Typora copies selected computed styles, including margin, but not
      // width/height/max-width. It then changes only the clone's height and
      // captures an HTML viewport at the displayed SVG's size.
      const clone=svg.cloneNode(true);
      const copyStyles=(from,to)=>{
        const css=getComputedStyle(from);
        for(const key of ['backgroundColor','color','fill','stroke','strokeWidth','opacity','stroke-dasharray','fontSize','fontFamily','textAnchor','textSize','padding','margin'])to.style[key]=css[key];
        [...from.children].forEach((child,index)=>copyStyles(child,to.children[index]));
      };
      copyStyles(svg,clone);
      clone.setAttribute('height',bounds.height);
      frame=document.createElement('iframe');
      frame.style.cssText=`width:${bounds.width}px;height:${bounds.height}px;border:0;display:block`;
      document.body.append(frame);
      await new Promise(resolve=>{
        frame.onload=resolve;
        frame.srcdoc='<!doctype html><html style="margin:0;padding:0"><body style="margin:0;padding:0">'+clone.outerHTML+'</body></html>';
      });
      const exported=frame.contentDocument.querySelector('svg');
      const viewport=exported.getBoundingClientRect();
      const nodes=[...exported.querySelectorAll('.node')].map(node=>node.getBoundingClientRect());
      const rightmost=Math.max(...nodes.map(node=>node.right));
      const leftmost=Math.min(...nodes.map(node=>node.left));
      const ok=nodes.length===6&&Math.abs(viewport.width-bounds.width)<1&&leftmost>=-1&&rightmost<=bounds.width+1;
      checks.push({name:`Word PNG capture keeps both edges at ${width}px`,ok,displayWidth:bounds.width,exportWidth:viewport.width,leftmost,rightmost});
    }finally{frame?.remove();fixture.remove();}
  }
  return checks;
};
