class Piano {
  numberOfWhiteKeys;
  numberOfBlackKeys;
  initialKeyId;
  keys = {};

  constructor(numberOfWhiteKeys, numberOfBlackKeys, initialKeyId) {
    this.OCTAVE = 7;
    this.numberOfWhiteKeys = numberOfWhiteKeys;
    this.numberOfBlackKeys = numberOfBlackKeys;
    this.initialKeyId = initialKeyId;
    this.initializeKeysPiano();
  }

  initializeKeysByOctave(initialId, initialX) {
    for (let i = 0; i < this.OCTAVE; i++) {
      let initialKeyPosition = initialX + whiteKeyWidth * i;
      this.keys[initialId] = new Key(initialId, true, initialKeyPosition, 80);
      initialId++;
      if (i != 2 && i != this.OCTAVE - 1) {
        this.keys[initialId] = new Key(
          initialId,
          false,
          (2 * whiteKeyWidth) / 3 + initialKeyPosition,
          50
        );
        initialId++;
      }
    }
  }

  initializeKeysPiano() {
    for (
      let i = this.initialKeyId, j = 0;
      i < this.initialKeyId + numberOfWhiteKeys + numberOfBlackKeys;
      i += 12
    ) {
      this.initializeKeysByOctave(i, j);
      line(j, 0, j, width);
      j += whiteKeyWidth * this.OCTAVE;
    }
  }

  show() {
    for (
      let i = this.initialKeyId, j = 0;
      i < this.initialKeyId + numberOfWhiteKeys + numberOfBlackKeys;
      i += 12
    ) {
      line(j, 0, j, width);
      j += whiteKeyWidth * this.OCTAVE;
    }
    Object.values(this.keys).forEach((value) => {
      if (value.isWhite) {
        value.show();
      }
    });
    Object.values(this.keys).forEach((value) => {
        if (!value.isWhite) {
          value.show();
        }
      });
  }

  printKeys() {
    console.log("The keys are: ", this.keys.length);
    Object.values(this.keys).forEach((value) => {
      console.log(value, " ", value.isWhite);
    });
  }
}
