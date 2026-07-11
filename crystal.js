class Crystal {

  constructor(xPosition, yPosition, isFirstHalf) {
    this.xPosition = xPosition;
    this.yPosition = yPosition;
    this.size = 20;
    this.crLength = 0.5;
    this.numberOfSides = 8;
    this.angle = TWO_PI / this.numberOfSides;
    this.canShow = false;
    this.increaseLength = false;
    this.isFirstHalf = isFirstHalf;

  }

  setPosition(xPosition, yPosition) {
    this.xPosition = xPosition;
    this.yPosition = yPosition;
  }

  setIncreaseLength(auxBool) {
    this.increaseLength = auxBool;
  }

  show() {
    if (!this.canShow) {
      return;
    }
    noStroke();
    if (this.isFirstHalf) {
      // Deep purple for a cosmic feel
      fill(138, 43, 226, 10); // Midnight blue with some transparency
    } else {
      // Bright Orange-Red for a more vibrant cosmic feel
      fill(255, 69, 0, 10); // Dark Red with some transparency
    }
    /* let centerX = this.xPosition + this.size/2;
    let centerY = this.yPosition + this.size; */
    rect(this.xPosition, this.yPosition, this.size, this.crLength);
    /* beginShape();
    for (let i = 0; i < this.numberOfSides; i++) {
      // Compute the x and y positions of each vertex using trigonometry
      let x = centerX + this.size * cos(i * this.angle + this.angle/2);
      let y = centerY + this.size * sin(i * this.angle + this.angle/2);
      if(i < 4) {
        y += this.crLength;
      }
      // Add the vertex to the shape
      vertex(x, y);
    }
    endShape(CLOSE); */
    //rect(xPosition,yPosition,whiteKeyWidth,crLength); 
  }

  update() {

    if (!this.canShow) {
      return;
    }
    if (this.yPosition > height + 20) {
      this.canShow = false;
      this.xPosition = 0;
      this.yPosition = 0;
      return;
    }
    if (this.increaseLength) {
      this.crLength += 6;
      return;
    }
    this.yPosition += 6;
  }
}