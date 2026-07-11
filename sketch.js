let speed;
let numberOfBlackKeys = 25;
let numberOfWhiteKeys = 35;
let whiteKeyWidth = 0;
let blackKeyWidth = 0;
let numberOfStars = 200;
let keyCrystalIndex = 0;
let numberOfCrystals = 20;
let piano;
let midi;
let crMouse;
let particles;
let backgroundPhoto;
let leafColor;
let windForce;
// https://youtu.be/17WoOqgXsRM
let stars = [];
let speedStar = 8;
// fish and jellyfish
const fish = [];
const jellyfish = [];
// Canvas division for chroma key
let visualizationHeight;
let chromaKeyHeight;

function preload() {
  navigator.requestMIDIAccess().then(onMIDISuccess, onMIDIFailure);
}

function setup() {
  createCanvas(1600, 800);

  // Calculate canvas divisions: 2/3 visualization, 1/3 chroma key
  visualizationHeight = height * (2 / 3);
  chromaKeyHeight = height * (1 / 3);

  // load background photo
  whiteKeyWidth = width / numberOfWhiteKeys;
  blackKeyWidth = (2 * whiteKeyWidth) / 3;
  piano = new Piano(numberOfWhiteKeys, numberOfBlackKeys, 36);
  Object.values(piano.keys).forEach((value, index) => {
    let isFirstHalf = index < Object.values(piano.keys).length / 2;
    for (let i = 0; i < numberOfCrystals; i++) {
      value.crystals.push(new Crystal(0, 0, isFirstHalf));
    }
  });

  // Create 8-12 fish with random positions and types (constrained to visualization area)
  let fishCount = int(random(16, 24));
  let fishTypes = ['traveling', 'circling', 'wandering'];
  for (let i = 0; i < fishCount; i++) {
    let x = random(width);
    let y = random(visualizationHeight);
    let type = random(fishTypes);
    fish.push(new Fish(x, y, type));
  }

  // Create 3-5 jellyfish with random positions (constrained to visualization area)
  let jellyfishCount = int(random(9, 12));
  for (let i = 0; i < jellyfishCount; i++) {
    let x = random(width);
    let y = random(visualizationHeight);
    jellyfish.push(new Jellyfish(x, y));
  }
}

function draw() {
  colorMode(RGB);

  // Draw water background for top 2/3
  drawWaterBackground();

  // Draw chroma key green background for bottom 1/3
  drawChromaKeyBackground();

  // Constrain all rendering to visualization area
  push();

  //piano.show();
  strokeWeight(1);

  // Update and show jellyfish (behind fish)
  for (let i = 0; i < jellyfish.length; i++) {
    jellyfish[i].update();
    jellyfish[i].show();
  }

  // Update and show fish
  for (let i = 0; i < fish.length; i++) {
    fish[i].update();
    fish[i].show();
  }

  Object.values(piano.keys).forEach((value) => {
    for (let cr of value.crystals) {
      cr.update();
      cr.show();
    }
  });

  pop();
}

function drawWaterBackground() {
  // Gradient from lighter blue at top to darker at visualization bottom (2/3 of canvas)
  for (let y = 0; y < visualizationHeight; y++) {
    let inter = map(y, 0, visualizationHeight, 0, 1);
    let r = lerp(20, 5, inter);
    let g = lerp(85, 35, inter);
    let b = lerp(115, 55, inter);
    stroke(r, g, b);
    line(0, y, width, y);
  }
  noStroke();
}

function drawChromaKeyBackground() {
  // Chroma key green background (bottom 1/3 of canvas)
  // Standard chroma key green: RGB(0, 177, 64) or brighter green RGB(0, 255, 0)
  noStroke();
  fill(0, 177, 64); // Professional chroma key green
  rect(0, visualizationHeight, width, chromaKeyHeight);
}

function findNearestCreature(keyX, keyY) {
  let nearestFish = null;
  let nearestJellyfish = null;
  let minFishDist = Infinity;
  let minJellyfishDist = Infinity;

  // Find nearest fish
  for (let f of fish) {
    let d = dist(keyX, keyY, f.x, f.y);
    if (d < minFishDist) {
      minFishDist = d;
      nearestFish = f;
    }
  }

  // Find nearest jellyfish
  for (let j of jellyfish) {
    let d = dist(keyX, keyY, j.x, j.y);
    if (d < minJellyfishDist) {
      minJellyfishDist = d;
      nearestJellyfish = j;
    }
  }

  // Return the overall nearest creature
  if (minFishDist < minJellyfishDist) {
    return { type: 'fish', creature: nearestFish };
  } else {
    return { type: 'jellyfish', creature: nearestJellyfish };
  }
}

function getMIDIMessage(message) {
  const command = message.data[0];
  const note = message.data[1];
  const velocity = message.data.length > 2 ? message.data[2] : 0;
  // Note on
  if (command === 144 && velocity > 0) {
    const currentKey = piano.keys[note];
    if (currentKey.currentIndex >= numberOfCrystals) {
      currentKey.currentIndex = 0;
    }
    let cr = currentKey.crystals[currentKey.currentIndex];
    cr.setPosition(currentKey.xPosition, currentKey.yPosition)
    cr.crLength = 0.5;
    cr.canShow = true;
    cr.increaseLength = true;
    currentKey.showPosition = true;
    currentKey.currentIndex++;

    // Apply velocity to nearest creature
    let nearest = findNearestCreature(currentKey.xPosition, currentKey.yPosition);
    if (nearest.creature) {
      nearest.creature.applyVelocity(velocity);
    }
  }
  // Note off
  else if (command === 128 || (command === 144 && velocity === 0)) {
    const currentKey = piano.keys[note];
    currentKey.setCrystalLength(currentKey.currentIndex - 1, false);
    currentKey.showPosition = false;
  }

}


function branch(len, leafColor) {
  push();
  if (len > 10) {
    stroke(0);
    strokeWeight(map(len, 10, 100, 1, 15));
    line(0, 0, 0, -len);
    translate(0, -len);
    rotate(radians(30));
    branch(len * 0.8, leafColor);
    rotate(radians(-55));
    branch(len * 0.75, leafColor);
  } else {
    fill(leafColor);
    noStroke();
    ellipse(0, 0, 10, 10);
  }
  pop();
}



function onMIDISuccess(midiAccess) {
  console.log("MIDI ready!");
  for (var input of midiAccess.inputs.values()) {
    input.onmidimessage = getMIDIMessage;
  }
}

function onMIDIFailure(msg) {
  console.error(`Failed to get MIDI access - ${msg}`);
}
