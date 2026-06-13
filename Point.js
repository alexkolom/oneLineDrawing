export class Point {

    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    distanceTo(p) {
        const dx = this.x - p.x;
        const dy = this.y - p.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
}
