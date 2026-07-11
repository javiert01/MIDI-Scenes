/** The subset of an enumerated MIDI input the engine needs. */
export interface MidiInputLike {
  readonly id: string;
  readonly name: string;
}

export type MidiMessageHandler = (data: number[]) => void;

/**
 * The subset of WEBMIDI.js the engine depends on. Lets tests inject a fake,
 * mirroring the P5Factory/P5Like seam used for the p5 instance.
 */
export interface MidiAccessLike {
  readonly inputs: MidiInputLike[];
  /** Subscribes to raw MIDI messages from one input. Returns an unsubscribe function. */
  onMessage(inputId: string, handler: MidiMessageHandler): () => void;
  /** Subscribes to Device hot-plug (connected/disconnected). Returns an unsubscribe function. */
  onDeviceChange(handler: () => void): () => void;
}

export type MidiFactory = () => Promise<MidiAccessLike>;
