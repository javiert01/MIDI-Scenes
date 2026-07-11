class Fish {
  constructor(x, y, fishType) {
    this.x = x;
    this.y = y;
    this.movementPattern = fishType;
    this.fishSize = random(8, 15);
    this.speed = random(1, 2.5);
    this.direction = random(TWO_PI);
    this.frequency = random(0.5, 1.5);
    this.amplitude = random(10, 30);

    // Color based on fish type (HSB mode)
    switch (fishType) {
      case 'traveling':
        this.hue = random(160, 190); // Cyan-blue range
        break;
      case 'circling':
        this.hue = random(190, 220); // Deep blue range
        break;
      case 'wandering':
        this.hue = random(140, 160); // Green-cyan range
        break;
    }
    this.saturation = 200;
    this.brightness = 180;

    // Velocity response properties
    this.baseSpeed = this.speed;
    this.baseFishSize = this.fishSize;
    this.baseBrightness = this.brightness;

    this.velocityMultiplier = 1.0;
    this.sizeMultiplier = 1.0;
    this.brightnessBoost = 0;

    this.velocityDecay = 0.95;

    // For circling pattern
    if (fishType === 'circling') {
      this.centerX = x;
      this.centerY = y;
      this.radiusX = random(100, 250);
      this.radiusY = random(80, 200);
    }
  }

  update() {
    // Apply velocity effects with decay
    this.speed = this.baseSpeed * this.velocityMultiplier;
    this.fishSize = this.baseFishSize * this.sizeMultiplier;
    this.brightness = this.baseBrightness + this.brightnessBoost;

    // Decay effects over time
    this.velocityMultiplier = lerp(this.velocityMultiplier, 1.0, 1 - this.velocityDecay);
    this.sizeMultiplier = lerp(this.sizeMultiplier, 1.0, 1 - this.velocityDecay);
    this.brightnessBoost = lerp(this.brightnessBoost, 0, 1 - this.velocityDecay);

    this.applyMovement();
    this.wrapAround();
  }

  applyVelocity(velocity) {
    // velocity is 0-127, map to useful ranges
    let normalizedVelocity = map(velocity, 0, 127, 0, 1);

    // Speed burst: 1x to 3x speed
    this.velocityMultiplier = 1.0 + normalizedVelocity * 2.0;

    // Size scaling: 1x to 1.5x size
    this.sizeMultiplier = 1.0 + normalizedVelocity * 0.5;

    // Brightness boost: +0 to +50 brightness
    this.brightnessBoost = normalizedVelocity * 50;
  }

  applyMovement() {
    switch (this.movementPattern) {
      case 'traveling':
        this.applyMovement_Traveling();
        break;
      case 'circling':
        this.applyMovement_Circling();
        break;
      case 'wandering':
        this.applyMovement_Wandering();
        break;
    }
  }

  applyMovement_Traveling() {
    let time = frameCount * 0.02;
    let xVel = this.speed * cos(time * this.frequency);
    let yVel = this.amplitude * 0.1 * sin(time * 0.5);

    this.x += xVel;
    this.y += yVel;
    this.direction = atan2(yVel, xVel);
  }

  applyMovement_Circling() {
    let time = frameCount * 0.015;
    this.x = this.centerX + cos(time * this.frequency) * this.radiusX;
    this.y = this.centerY + sin(time * this.frequency) * this.radiusY;
    this.direction = time * this.frequency + HALF_PI;
  }

  applyMovement_Wandering() {
    if (frameCount % 180 === 0) {
      this.direction += random(-PI / 4, PI / 4);
    }
    this.x += this.speed * cos(this.direction);
    this.y += this.speed * sin(this.direction);
  }

  wrapAround() {
    // Only wrap for non-circling fish
    if (this.movementPattern === 'circling') {
      return;
    }

    // Constrain to visualization area (top 2/3 of canvas)
    let visualHeight = height * (2 / 3);

    if (this.x < -this.fishSize) {
      this.x = width + this.fishSize;
    } else if (this.x > width + this.fishSize) {
      this.x = -this.fishSize;
    }

    if (this.y < -this.fishSize) {
      this.y = visualHeight + this.fishSize;
    } else if (this.y > visualHeight + this.fishSize) {
      this.y = -this.fishSize;
    }
  }

  show() {
    colorMode(HSB);
    push();
    translate(this.x, this.y);
    rotate(this.direction);

    let bodyLength = this.fishSize * 2;
    let bodyWidth = this.fishSize * 0.8;

    // Draw tail fin (forked)
    fill(this.hue, this.saturation, this.brightness - 20);
    stroke(this.hue, this.saturation, this.brightness - 40);
    strokeWeight(1);
    beginShape();
    vertex(-bodyLength * 0.6, 0);
    vertex(-bodyLength * 0.95, -bodyWidth * 0.6);
    vertex(-bodyLength * 0.8, 0);
    vertex(-bodyLength * 0.95, bodyWidth * 0.6);
    endShape(CLOSE);

    // Draw main body (ellipse for smooth body)
    fill(this.hue, this.saturation, this.brightness);
    stroke(this.hue, this.saturation, this.brightness - 30);
    strokeWeight(1.5);
    ellipse(0, 0, bodyLength, bodyWidth);

    // Draw body shading (darker on top for depth)
    noStroke();
    fill(this.hue, this.saturation + 20, this.brightness - 40, 100);
    ellipse(0, -bodyWidth * 0.15, bodyLength * 0.9, bodyWidth * 0.4);

    // Draw dorsal fin (top fin)
    fill(this.hue, this.saturation, this.brightness - 15);
    stroke(this.hue, this.saturation, this.brightness - 40);
    strokeWeight(0.8);
    beginShape();
    vertex(-bodyLength * 0.15, -bodyWidth * 0.4);
    vertex(bodyLength * 0.05, -bodyWidth * 0.9);
    vertex(bodyLength * 0.2, -bodyWidth * 0.35);
    endShape(CLOSE);

    // Draw pectoral fins (side fins)
    fill(this.hue, this.saturation - 30, this.brightness - 10, 200);
    noStroke();
    // Left fin
    push();
    translate(bodyLength * 0.1, bodyWidth * 0.3);
    rotate(-PI / 6);
    ellipse(0, 0, bodyLength * 0.35, bodyWidth * 0.25);
    pop();
    // Right fin (mirrored)
    push();
    translate(bodyLength * 0.1, -bodyWidth * 0.3);
    rotate(PI / 6);
    ellipse(0, 0, bodyLength * 0.35, bodyWidth * 0.25);
    pop();

    // Draw eye
    fill(255, 255, 255);
    noStroke();
    let eyeSize = this.fishSize * 0.25;
    ellipse(bodyLength * 0.25, 0, eyeSize, eyeSize);

    // Draw pupil
    fill(0, 0, 0);
    ellipse(bodyLength * 0.27, 0, eyeSize * 0.5, eyeSize * 0.5);

    // Draw eye highlight
    fill(255, 255, 255);
    ellipse(bodyLength * 0.29, -eyeSize * 0.15, eyeSize * 0.25, eyeSize * 0.25);

    // Draw scale pattern (subtle lines)
    /* stroke(this.hue, this.saturation, this.brightness - 50, 80);
    strokeWeight(0.5);
    for (let i = -3; i <= 3; i++) {
      let xPos = bodyLength * 0.15 * i;
      arc(xPos, 0, bodyWidth * 0.6, bodyWidth * 0.6, -PI / 3, PI / 3);
    } */

    pop();
  }
}
