class Star {
    constructor(angle, inner) {
        this.inner = inner;
        this.radius = this.inner ? 85 : 170;
        this.angle = angle;
    }
    update() {
        //this.angle += this.angleSpeed;
        this.x = cos(this.angle) * this.radius;
        this.y = sin(this.angle) * this.radius;
    }
    show() {
        //ellipse(this.x, this.y, 10,10);
    }

}