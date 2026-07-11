class Spring {
    constructor(x, y, hu) {
        this.hu = hu;
        this.spring = new Particle(x, y, this.hu, false);
        this.springFinished = false;
        this.springStarted = true;
        this.particles = [];
      }
    
      done() {
        return this.springFinished && this.particles.length === 0
      }
    
      update() {
        if (this.springStarted) {
            this.loadParticles();
            this.springStarted = false;
        }
        if (!this.springFinished) {
            for (let i = this.particles.length - 1; i >= 0; i--) {
                this.particles[i].applyForce(gravity);
                this.particles[i].update();
                if (this.particles[i].done()) {
                  this.particles.splice(i, 1);
                }
              }
    
          if (this.spring.pos.y >= height) {
            this.springFinished = true;
          }
        }
        this.spring.update();        
      }
    
      loadParticles() {
        for (let i = 0; i < 150; i++) {
          const p = new Particle(this.spring.pos.x, this.spring.pos.y, this.hu, false);
          this.particles.push(p);
        }
      }
    
      show() {
        if (this.springFinished) {
          return
        }
        for (var i = 0; i < this.particles.length; i++) {
          this.particles[i].show();
        }
      }
}