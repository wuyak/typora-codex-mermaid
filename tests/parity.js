window.runParity = async function () {
  const sources = await (await fetch('fixtures.json')).json();
  const report = [];
  for (const dark of [false, true]) {
    for (let index = 0; index < sources.length; index += 1) {
      const id = `parity-${dark}-${index}`;
      const tokens = CodexMermaidRenderer.theme(dark);
      const original = await codexReferenceRender({
        sanitizedSource: sources[index],
        themeVariables: structuredClone(tokens),
        isDarkMode: dark,
        diagramId: id,
      });
      const actual = (await CodexMermaidRenderer.render(id, sources[index], {
        dark,
        themeVariables: structuredClone(tokens),
      })).svg;
      const project = raw => {
        const template = document.createElement('template');
        template.innerHTML = raw;
        const svg = template.content.querySelector('svg');
        const nodes = [...svg.querySelectorAll('.node')].map(node => ({
          id: node.id,
          transform: node.getAttribute('transform'),
          shapes: [...node.querySelectorAll(':scope > rect,:scope > path,:scope > polygon,:scope > circle,:scope > ellipse')].map(shape => shape.outerHTML),
          text: node.textContent,
        }));
        const edges = [...svg.querySelectorAll('.flowchart-link')].map(edge => ({
          d: edge.getAttribute('d'),
          style: edge.getAttribute('style'),
          start: edge.getAttribute('marker-start'),
          end: edge.getAttribute('marker-end'),
        }));
        const labels = [...svg.querySelectorAll('.edgeLabel')].map(label => label.outerHTML);
        return {viewBox: svg.getAttribute('viewBox'), nodes, edges, labels, css: svg.querySelector('style')?.textContent};
      };
      const expected = project(original);
      const actualProjection = project(actual);
      const differences = Object.keys(expected).filter(key => JSON.stringify(expected[key]) !== JSON.stringify(actualProjection[key]));
      report.push({diagram: index + 1, dark, match: differences.length === 0, differences, viewBox: expected.viewBox, nodes: expected.nodes.length, edges: expected.edges.length});
    }
  }
  window.parityReport = report;
  if (report.some(item => !item.match)) throw new Error(JSON.stringify(report));
  return report;
};
