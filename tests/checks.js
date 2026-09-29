window.runChecks = async function () {
  const report = [];
  const check = (name, ok, details = {}) => {
    report.push({name, ok, details});
    if (!ok) throw new Error(`${name}: ${JSON.stringify(details)}`);
  };
  let serial = 0;
  const render = async (source, options = {}) => {
    const result = await CodexMermaidRenderer.render(`verify-${serial++}`, source, options);
    const template = document.createElement('template');
    template.innerHTML = result.svg;
    return {svg: template.content.querySelector('svg'), raw: result.svg};
  };
  const sources = await (await fetch('fixtures.json')).json();
  const expected = [{nodes: 7, edges: 7}, {nodes: 6, edges: 6}];
  check('fixture count', sources.length === expected.length, {actual: sources.length, expected: expected.length});
  for (let index = 0; index < sources.length; index += 1) {
    const {svg, raw} = await render(sources[index]);
    const nodes = svg.querySelectorAll('.node').length;
    const edges = svg.querySelectorAll('.flowchart-link').length;
    check(`fixture ${index + 1} shape counts`, nodes === expected[index].nodes && edges === expected[index].edges, {nodes, edges, expected: expected[index], viewBox: svg.getAttribute('viewBox')});
    check(`fixture ${index + 1} preserves class colors`, raw.includes('#fff0ee') || raw.includes('#edf5ff'), {});
    check(`fixture ${index + 1} open arrows`, Array.from(svg.querySelectorAll('marker path')).some(path => path.style.fill === 'none'), {});
    check(`fixture ${index + 1} pill labels`, Array.from(svg.querySelectorAll('.edgeLabel rect')).every(rect => Number(rect.getAttribute('height')) >= 26), {});
  }

  const cases = {
    sequence: 'sequenceDiagram\nA->>B: Hello',
    class: 'classDiagram\nAnimal <|-- Duck',
    state: 'stateDiagram-v2\n[*] --> Ready\nReady --> [*]',
    er: 'erDiagram\nUSER ||--o{ ITEM : owns',
    pie: 'pie title Example\n"A": 2\n"B": 3',
    gantt: 'gantt\ndateFormat YYYY-MM-DD\nsection Work\nTask :a1, 2026-01-01, 3d',
  };
  for (const [name, source] of Object.entries(cases)) {
    const {svg} = await render(source);
    check(`${name} renders`, !!svg?.getAttribute('viewBox'), {viewBox: svg?.getAttribute('viewBox')});
  }

  const dark = await render('flowchart TB\nA[中文] -->|说明| B[Done]\nstyle A fill:#ff0000', {dark: true});
  check('dark explicit color adaptation', dark.svg.querySelector('.node .label-container').style.fill.includes('color-mix'), {});
  const light = await render('flowchart TB\nA --> B');
  check('dark to light resets theme', light.raw.includes('rgb(229, 243, 255)') && !light.raw.includes('color-mix'), {});
  let failed = false;
  try { await render('flowchart TB\nA --> [broken'); } catch { failed = true; }
  check('invalid syntax rejects', failed, {});
  check('render recovers after invalid syntax', !!(await render('flowchart TB\nA --> B')).svg, {});
  const parallel = await Promise.all([
    render('flowchart TB\nA --> B'),
    render('flowchart TB\nC --> D'),
  ]);
  check('concurrent requests use different SVG IDs', parallel[0].svg.id !== parallel[1].svg.id, parallel.map(result => result.svg.id));
  check('no leaked hidden hosts', !document.querySelector('body > div[aria-hidden="true"]'), {});
  window.checkReport = report;
  return report;
};
