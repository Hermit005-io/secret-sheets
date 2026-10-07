// Drawing a sheet's QR code. The code is built by the qrcode-generator
// library; this turns its grid of dark squares into an SVG, which prints
// crisply at any size.

import qrcode from 'qrcode-generator';

const QUIET_ZONE = 4; // blank squares around the code, which scanners need

/** The grid of a QR code holding `text`: true where a square is dark. */
export function qrGrid(text: string): boolean[][] {
  // Level M survives about 15% of the code being damaged. The text is all
  // capitals and digits, which QR stores more compactly than arbitrary bytes.
  const code = qrcode(0, 'M');
  code.addData(text, 'Alphanumeric');
  code.make();
  const size = code.getModuleCount();
  return Array.from({length: size}, (_, row) =>
    Array.from({length: size}, (_, column) => code.isDark(row, column)),
  );
}

export function qrSvg(text: string, title: string): SVGSVGElement {
  const grid = qrGrid(text);
  const size = grid.length + 2 * QUIET_ZONE;

  // One path: for each row, a rectangle per run of dark squares.
  let path = '';
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      let run = 1;
      while (row[x + run]) run++;
      path += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h${run}v1h-${run}z`;
      x += run;
    }
  });

  const svgNamespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const background = document.createElementNS(svgNamespace, 'rect');
  background.setAttribute('width', String(size));
  background.setAttribute('height', String(size));
  background.setAttribute('fill', '#fff');
  const squares = document.createElementNS(svgNamespace, 'path');
  squares.setAttribute('d', path);
  squares.setAttribute('fill', '#000');
  svg.append(background, squares);
  return svg;
}
