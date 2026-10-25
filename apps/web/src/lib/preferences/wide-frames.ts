import { readString, writeString } from '../storage';

/** 16:9 frames for portrait pages are a per-browser preference, like the box mode. */
const STORAGE_KEY = 'slider.wideFrames';

/** Off by default: every slide shows whole, in its own shape. */
export function loadStoredWideFrames(): boolean {
  return readString(STORAGE_KEY) === 'on';
}

/** Private mode or blocked storage: the choice just isn't remembered. */
export function storeWideFrames(on: boolean): void {
  writeString(STORAGE_KEY, on ? 'on' : 'off');
}
