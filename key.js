class Key {
    
    constructor(id, isWhite, xPosition, yPosition){
      this.id = id;
      this.isWhite = isWhite;
      this.xPosition = xPosition;
      this.yPosition = yPosition;
      this.showPosition = false;
      this.crystals = [];
      this.currentIndex = 0;
    }
    
    setCrystalLength(index, increaseLength) {
      this.crystals[index].setIncreaseLength(increaseLength);
    }
    
    show() {
      if(this.isWhite){
        fill(255);
        rect(this.xPosition,0,whiteKeyWidth,this.yPosition);  
      }else{
        fill(0);
        rect(this.xPosition,0,blackKeyWidth,this.yPosition);
      }
      if(this.showPosition){
        fill(0,255,0);
        circle(this.xPosition+whiteKeyWidth/2, this.yPosition/2, 30);
      }
    }
    
  }