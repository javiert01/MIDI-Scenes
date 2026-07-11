import { WebMidi } from 'webmidi';
import type { MidiAccessLike, MidiFactory, MidiMessageHandler } from './midiTypes';

/** Default MidiFactory: wraps WEBMIDI.js to satisfy MidiAccessLike. */
export const defaultMidiFactory: MidiFactory = async () => {
  await WebMidi.enable();
  return webMidiAccess;
};

const webMidiAccess: MidiAccessLike = {
  get inputs() {
    return WebMidi.inputs.map((input) => ({ id: input.id, name: input.name }));
  },
  onMessage(inputId: string, handler: MidiMessageHandler) {
    const input = WebMidi.getInputById(inputId);
    if (!input) return () => {};
    const listener = (event: { data: Uint8Array }) => handler(Array.from(event.data));
    input.addListener('midimessage', listener);
    return () => input.removeListener('midimessage', listener);
  },
  onDeviceChange(handler: () => void) {
    const listener = () => handler();
    WebMidi.addListener('connected', listener);
    WebMidi.addListener('disconnected', listener);
    return () => {
      WebMidi.removeListener('connected', listener);
      WebMidi.removeListener('disconnected', listener);
    };
  },
};
