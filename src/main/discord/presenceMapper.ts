import type { SetActivity } from '@xhayper/discord-rpc';
import { ElementType, PresenceState } from '../../shared/types';

const ONSHAPE_URL = 'https://app.onshape.com';
const MAX_FIELD_LENGTH = 128;

const SMALL_IMAGE_KEYS: Record<ElementType, string> = {
  'part-studio': 'part-studio',
  assembly: 'assembly',
  drawing: 'drawing',
  unknown: 'active'
};

const SMALL_IMAGE_LABELS: Record<ElementType, string> = {
  'part-studio': 'Part Studio',
  assembly: 'Assembly',
  drawing: 'Drawing',
  unknown: 'Onshape'
};

function clamp(value: string, fallback: string): string {
  const text = value.trim() || fallback;
  return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH - 1)}…` : text;
}

export function toActivity(state: PresenceState, startedAt: number): SetActivity {
  const elementType = state.elementType ?? 'unknown';
  const idle = state.status === 'idle';

  return {
    details: clamp(state.details, 'Onshape'),
    state: clamp(state.state, idle ? 'Idle' : 'Working'),
    largeImageKey: 'onshape',
    largeImageText: state.largeImageText ?? 'Onshape',
    smallImageKey: idle ? 'idle' : SMALL_IMAGE_KEYS[elementType],
    smallImageText: state.smallImageText ?? (idle ? 'Idle' : SMALL_IMAGE_LABELS[elementType]),
    startTimestamp: startedAt,
    buttons: [{ label: 'Open In Onshape', url: state.documentUrl ?? ONSHAPE_URL }]
  };
}

export function isSamePresence(a: PresenceState | null, b: PresenceState): boolean {
  if (!a) {
    return false;
  }

  return (
    a.status === b.status &&
    a.details === b.details &&
    a.state === b.state &&
    a.elementType === b.elementType &&
    a.documentUrl === b.documentUrl
  );
}
