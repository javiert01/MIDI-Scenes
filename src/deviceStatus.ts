// Turns the engine's Device state into what the sidebar says about it. Pure, so
// every connect/disconnect wording can be tested without React or real hardware.

import type { DeviceDescriptor, MidiStatus } from '@/engine/VisualizerEngine';

export interface DeviceState {
  midiStatus: MidiStatus;
  devices: DeviceDescriptor[];
  activeDeviceId: string | null;
  savedDeviceName: string | null;
  virtualInputEnabled: boolean;
}

export type DeviceTone = 'connected' | 'waiting' | 'idle' | 'warning';

export interface DeviceStatus {
  tone: DeviceTone;
  title: string;
  detail: string;
  /** Whether to offer the Virtual Input as a way to play right now. */
  offerVirtualInput: boolean;
}

const VIRTUAL_INPUT_HINT = 'Virtual Input is on: press A S D F G H J K to play.';

function labelOf(devices: DeviceDescriptor[], id: string | null): string | undefined {
  return devices.find((device) => device.id === id)?.label;
}

export function describeDeviceStatus(state: DeviceState): DeviceStatus {
  const { midiStatus, devices, activeDeviceId, savedDeviceName, virtualInputEnabled } = state;

  if (midiStatus === 'connecting') {
    return {
      tone: 'waiting',
      title: 'Looking for MIDI keyboards',
      detail: 'Allow MIDI access if your browser asks.',
      offerVirtualInput: false,
    };
  }

  if (midiStatus === 'unavailable') {
    return {
      tone: 'warning',
      title: "MIDI isn't available",
      detail: virtualInputEnabled
        ? VIRTUAL_INPUT_HINT
        : 'Allow MIDI access, or use Chrome, Edge, or Opera. You can still play without a keyboard.',
      offerVirtualInput: !virtualInputEnabled,
    };
  }

  const activeLabel = labelOf(devices, activeDeviceId);
  if (activeLabel) {
    const savedIsAway = savedDeviceName !== null && savedDeviceName !== activeLabel;
    return {
      tone: 'connected',
      title: activeLabel,
      detail: savedIsAway
        ? `${savedDeviceName} isn't connected, so this one is standing in. It switches back when you plug that one in.`
        : 'Connected. The light flashes with each note.',
      offerVirtualInput: false,
    };
  }

  const reconnectHint = savedDeviceName
    ? `Plug in ${savedDeviceName} and it connects automatically.`
    : 'Plug one in and it connects automatically.';
  return {
    tone: 'idle',
    title: 'No MIDI keyboard connected',
    detail: virtualInputEnabled ? `${VIRTUAL_INPUT_HINT} ${reconnectHint}` : reconnectHint,
    offerVirtualInput: !virtualInputEnabled,
  };
}

/** One-off wording for a hot-plug between two states, or null if no Device came or went. */
export function describeDeviceChange(previous: DeviceState, next: DeviceState): string | null {
  // The first listing after access resolves is the app starting up, not a hot-plug.
  if (previous.midiStatus !== 'ready' || next.midiStatus !== 'ready') return null;

  const previousIds = new Set(previous.devices.map((device) => device.id));
  const nextIds = new Set(next.devices.map((device) => device.id));
  const removed = previous.devices.filter((device) => !nextIds.has(device.id));
  const added = next.devices.filter((device) => !previousIds.has(device.id));
  if (removed.length === 0 && added.length === 0) return null;

  const parts = [
    ...removed.map((device) => `${device.label} disconnected.`),
    ...added.map((device) => `${device.label} connected.`),
  ];
  // Only worth saying when the Device taking over isn't the one just announced as connected.
  const activeLabel = labelOf(next.devices, next.activeDeviceId);
  const isFallback = !added.some((device) => device.id === next.activeDeviceId);
  if (previous.activeDeviceId !== next.activeDeviceId && activeLabel && isFallback) {
    parts.push(`Now using ${activeLabel}.`);
  }
  return parts.join(' ');
}
