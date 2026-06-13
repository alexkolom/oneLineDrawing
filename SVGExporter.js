import { BezierPathBuilder } from './BezierPathBuilder.js';

export class SVGExporter {

    static export(points, width, height) {

        const d =
            BezierPathBuilder.build(points);

        return `
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${width} ${height}">

<path
    d="${d}"
    fill="none"
    stroke="black"
    stroke-width="1"
    stroke-linecap="round"
    stroke-linejoin="round"
/>

</svg>
`;
    }
}
