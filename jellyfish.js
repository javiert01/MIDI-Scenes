class Jellyfish {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.size = random(15, 30);
    this.speed = random(0.3, 0.8);
    this.direction = random(TWO_PI);

    // Pulsing animation
    this.pulsePhase = random(TWO_PI);
    this.pulseSpeed = random(0.05, 0.1);

    // Tentacles
    this.numTentacles = int(random(6, 12));
    this.tentacles = [];
    for (let i = 0; i < this.numTentacles; i++) {
      this.tentacles.push({
        angle: map(i, 0, this.numTentacles, 0, TWO_PI),
        length: random(this.size * 1.5, this.size * 3),
        segments: int(random(8, 15)),
        waveOffset: random(TWO_PI)
      });
    }

    // Color - jellyfish glow in bioluminescent colors
    this.hue = random([
      random(160, 200),  // Blue-cyan
      random(280, 320),  // Pink-purple
      random(100, 140)   // Green-cyan
    ]);
    this.saturation = random(150, 220);
    this.brightness = random(180, 230);

    // Velocity response properties
    this.basePulseSpeed = this.pulseSpeed;
    this.baseSize = this.size;
    this.baseBrightness = this.brightness;
    this.baseSaturation = this.saturation;

    this.pulseSpeedMultiplier = 1.0;
    this.sizeMultiplier = 1.0;
    this.glowIntensity = 0;
    this.tentacleWaveMultiplier = 1.0;

    this.velocityDecay = 0.93;

    // Floating motion
    this.bobOffset = random(TWO_PI);
    this.bobSpeed = random(0.02, 0.04);
  }

  update() {
    // Apply velocity effects with decay
    this.pulseSpeed = this.basePulseSpeed * this.pulseSpeedMultiplier;
    this.size = this.baseSize * this.sizeMultiplier;
    this.brightness = this.baseBrightness + this.glowIntensity * 60;
    this.saturation = this.baseSaturation + this.glowIntensity * 40;

    // Decay effects over time
    this.pulseSpeedMultiplier = lerp(this.pulseSpeedMultiplier, 1.0, 1 - this.velocityDecay);
    this.sizeMultiplier = lerp(this.sizeMultiplier, 1.0, 1 - this.velocityDecay);
    this.glowIntensity = lerp(this.glowIntensity, 0, 1 - this.velocityDecay);
    this.tentacleWaveMultiplier = lerp(this.tentacleWaveMultiplier, 1.0, 1 - this.velocityDecay);

    // Slow drifting motion
    this.x += cos(this.direction) * this.speed;
    this.y += sin(this.direction) * this.speed * 0.5;

    // Vertical bobbing motion
    this.y += sin(frameCount * this.bobSpeed + this.bobOffset) * 0.5;

    // Change direction occasionally
    if (frameCount % 200 === 0) {
      this.direction += random(-PI / 6, PI / 6);
    }

    // Pulse animation
    this.pulsePhase += this.pulseSpeed;

    // Wrap around screen
    this.wrapAround();
  }

  applyVelocity(velocity) {
    // velocity is 0-127, map to useful ranges
    let normalizedVelocity = map(velocity, 0, 127, 0, 1);

    // Pulse speed: 1x to 4x faster pulsing
    this.pulseSpeedMultiplier = 1.0 + normalizedVelocity * 3.0;

    // Size expansion: 1x to 1.6x size
    this.sizeMultiplier = 1.0 + normalizedVelocity * 0.6;

    // Glow intensity: +0 to +60 brightness, +0 to +40 saturation
    this.glowIntensity = normalizedVelocity;

    // Tentacle motion: 1x to 2.5x wave amplitude
    this.tentacleWaveMultiplier = 1.0 + normalizedVelocity * 1.5;
  }

  wrapAround() {
    // Constrain to visualization area (top 2/3 of canvas)
    let visualHeight = height * (2 / 3);

    // Wrap horizontally (allow seamless left-right wrapping)
    if (this.x < -this.size * 2) {
      this.x = width + this.size * 2;
    } else if (this.x > width + this.size * 2) {
      this.x = -this.size * 2;
    }

    // Constrain vertically (prevent going into green screen area)
    // Allow some margin for tentacles but keep body in bounds
    let maxY = visualHeight - this.size * 2;
    let minY = this.size * 2;

    if (this.y < minY) {
      this.y = minY;
      // Reverse vertical direction component when hitting top
      if (sin(this.direction) < 0) {
        this.direction = -this.direction;
      }
    } else if (this.y > maxY) {
      this.y = maxY;
      // Reverse vertical direction component when hitting bottom
      if (sin(this.direction) > 0) {
        this.direction = -this.direction;
      }
    }
  }

  show() {
    colorMode(HSB);
    push();
    translate(this.x, this.y);

    let pulse = sin(this.pulsePhase);
    let currentSize = this.size + pulse * this.size * 0.2;

    // Draw tentacles first (behind bell)
    this.drawTentacles(currentSize);

    // Draw bell (body)
    this.drawBell(currentSize, pulse);

    pop();
  }

  drawBell(currentSize, pulse) {
    // Main bell body with glow effect
    noStroke();

    // Outer glow
    fill(this.hue, this.saturation - 50, this.brightness, 50);
    ellipse(0, 0, currentSize * 1.8, currentSize * 1.6);

    // Middle layer
    fill(this.hue, this.saturation, this.brightness - 30, 120);
    ellipse(0, 0, currentSize * 1.4, currentSize * 1.2);

    // Main bell body (dome shaped)
    fill(this.hue, this.saturation, this.brightness, 180);
    arc(0, 0, currentSize * 1.2, currentSize * 1.3, 0, PI, CHORD);

    // Inner bell detail (darker)
    fill(this.hue, this.saturation + 30, this.brightness - 50, 150);
    arc(0, 0, currentSize * 0.7, currentSize * 0.8, 0, PI, CHORD);

    // Bell rim (brighter edge)
    stroke(this.hue, this.saturation, this.brightness + 20, 200);
    strokeWeight(2);
    noFill();
    arc(0, 0, currentSize * 1.2, currentSize * 1.3, 0, PI);

    // Pulsing spots on bell
    noStroke();
    fill(this.hue, this.saturation - 50, 255, 150 + pulse * 50);
    for (let i = 0; i < 4; i++) {
      let angle = map(i, 0, 4, 0, PI);
      let spotX = cos(angle + PI / 2) * currentSize * 0.35;
      let spotY = sin(angle + PI / 2) * currentSize * 0.35;
      ellipse(spotX, spotY, currentSize * 0.15, currentSize * 0.2);
    }
  }

  drawTentacles(currentSize) {
    for (let tentacle of this.tentacles) {
      stroke(this.hue, this.saturation, this.brightness - 40, 180);
      strokeWeight(1.5);
      noFill();

      beginShape();

      // Starting point at bottom of bell
      let startAngle = tentacle.angle;
      let startX = cos(startAngle) * currentSize * 0.5;
      let startY = sin(startAngle) * currentSize * 0.3 + currentSize * 0.3;

      vertex(startX, startY);

      // Draw wavy tentacle segments
      for (let i = 1; i <= tentacle.segments; i++) {
        let segmentRatio = i / tentacle.segments;
        let yPos = startY + segmentRatio * tentacle.length;

        // Wave motion with velocity multiplier
        let waveAmount = sin(frameCount * 0.05 + tentacle.waveOffset + i * 0.3) * this.size * 0.3 * this.tentacleWaveMultiplier;
        let xPos = startX + waveAmount * segmentRatio;

        // Tentacles get thinner towards end
        let thickness = map(segmentRatio, 0, 1, 1.5, 0.3);
        strokeWeight(thickness);

        vertex(xPos, yPos);
      }

      endShape();
    }

    // Draw thicker oral arms (4 main feeding tentacles)
    stroke(this.hue, this.saturation + 20, this.brightness - 20, 200);
    for (let i = 0; i < 4; i++) {
      let angle = map(i, 0, 4, PI / 4, PI - PI / 4);
      let armLength = currentSize * 1.2;

      strokeWeight(3);
      beginShape();
      vertex(0, currentSize * 0.4);

      for (let j = 1; j <= 6; j++) {
        let segmentRatio = j / 6;
        let yPos = currentSize * 0.4 + segmentRatio * armLength;
        let wave = sin(frameCount * 0.08 + i) * this.size * 0.2 * this.tentacleWaveMultiplier;
        let xPos = cos(angle) * this.size * 0.3 + wave * segmentRatio;

        let thickness = map(segmentRatio, 0, 1, 3, 0.5);
        strokeWeight(thickness);

        vertex(xPos, yPos);
      }
      endShape();
    }
  }
}
