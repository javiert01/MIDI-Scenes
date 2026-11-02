import { describe, expect, it } from 'vitest';
import { describeDeviceChange, describeDeviceStatus, type DeviceState } from '@/deviceStatus';

const roland = { id: 'r', label: 'Roland FP-30' };
const yamaha = { id: 'y', label: 'Yamaha P-125' };

function state(overrides: Partial<DeviceState> = {}): DeviceState {
  return {
    midiStatus: 'ready',
    devices: [],
    activeDeviceId: null,
    savedDeviceName: null,
    virtualInputEnabled: false,
    ...overrides,
  };
}

describe('describeDeviceStatus', () => {
  it('asks for permission while MIDI access is pending', () => {
    const status = describeDeviceStatus(state({ midiStatus: 'connecting' }));

    expect(status.tone).toBe('waiting');
    expect(status.detail).toContain('Allow MIDI access');
    expect(status.offerVirtualInput).toBe(false);
  });

  it('separates MIDI being unavailable from no keyboard being plugged in', () => {
    const unavailable = describeDeviceStatus(state({ midiStatus: 'unavailable' }));
    const unplugged = describeDeviceStatus(state());

    expect(unavailable.tone).toBe('warning');
    expect(unavailable.title).not.toBe(unplugged.title);
    expect(unavailable.offerVirtualInput).toBe(true);
  });

  it('names the active Device', () => {
    const status = describeDeviceStatus(state({ devices: [roland], activeDeviceId: 'r' }));

    expect(status.tone).toBe('connected');
    expect(status.title).toBe('Roland FP-30');
    expect(status.offerVirtualInput).toBe(false);
  });

  it('explains a stand-in Device while the saved one is away', () => {
    const status = describeDeviceStatus(
      state({ devices: [roland], activeDeviceId: 'r', savedDeviceName: 'Yamaha P-125' }),
    );

    expect(status.title).toBe('Roland FP-30');
    expect(status.detail).toContain("Yamaha P-125 isn't connected");
  });

  it('offers the Virtual Input when nothing is connected', () => {
    const status = describeDeviceStatus(state());

    expect(status.tone).toBe('idle');
    expect(status.offerVirtualInput).toBe(true);
    expect(status.detail).toBe('Plug one in and it connects automatically.');
  });

  it('names the saved Device it is waiting for', () => {
    const status = describeDeviceStatus(state({ savedDeviceName: 'Yamaha P-125' }));

    expect(status.detail).toBe('Plug in Yamaha P-125 and it connects automatically.');
  });

  it('shows how to play, not an offer, once the Virtual Input is on', () => {
    const status = describeDeviceStatus(state({ virtualInputEnabled: true }));

    expect(status.offerVirtualInput).toBe(false);
    expect(status.detail).toContain('press A S D F G H J K');
  });
});

describe('describeDeviceChange', () => {
  it('stays quiet for the first listing at startup', () => {
    const previous = state({ midiStatus: 'connecting' });
    const next = state({ devices: [roland], activeDeviceId: 'r' });

    expect(describeDeviceChange(previous, next)).toBeNull();
  });

  it('stays quiet when no Device came or went', () => {
    const previous = state({ devices: [roland, yamaha], activeDeviceId: 'r' });
    const next = state({ devices: [roland, yamaha], activeDeviceId: 'y' });

    expect(describeDeviceChange(previous, next)).toBeNull();
  });

  it('announces a connection that becomes active', () => {
    const next = state({ devices: [roland], activeDeviceId: 'r' });

    expect(describeDeviceChange(state(), next)).toBe('Roland FP-30 connected.');
  });

  it('announces a connection that leaves the active Device in place', () => {
    const previous = state({ devices: [roland], activeDeviceId: 'r' });
    const next = state({ devices: [roland, yamaha], activeDeviceId: 'r' });

    expect(describeDeviceChange(previous, next)).toBe('Yamaha P-125 connected.');
  });

  it('announces a disconnect with nothing left', () => {
    const previous = state({ devices: [roland], activeDeviceId: 'r' });

    expect(describeDeviceChange(previous, state())).toBe('Roland FP-30 disconnected.');
  });

  it('announces a disconnect and the fallback it caused', () => {
    const previous = state({ devices: [roland, yamaha], activeDeviceId: 'r' });
    const next = state({ devices: [yamaha], activeDeviceId: 'y' });

    expect(describeDeviceChange(previous, next)).toBe(
      'Roland FP-30 disconnected. Now using Yamaha P-125.',
    );
  });
});
