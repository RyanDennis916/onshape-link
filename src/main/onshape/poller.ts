import { isSamePresence } from '../discord/presenceMapper';
import { ElementType, PresenceState } from '../../shared/types';
import { OnshapeClient, OnshapeElementSummary, OnshapeRateLimitError } from './client';

const ELEMENT_TYPE_MAP: Record<string, ElementType> = {
  PARTSTUDIO: 'part-studio',
  ASSEMBLY: 'assembly',
  DRAWING: 'drawing'
};

export interface OnshapePollerOptions {
  client: OnshapeClient;
  pollIntervalSec: number;
  idleTimeoutMin: number;
  isSignedIn: () => boolean;
  onPresence: (presence: PresenceState) => void;
}

export class OnshapePoller {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastPresence: PresenceState | null = null;
  private backoffUntil = 0;

  constructor(private readonly options: OnshapePollerOptions) {}

  public start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    void this.tick();
  }

  public stop(): void {
    this.running = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) {
      return;
    }

    this.timer = setTimeout(() => void this.tick(), delayMs);

    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  private async tick(): Promise<void> {
    if (!this.options.isSignedIn()) {
      this.lastPresence = null;
      this.scheduleNext(this.options.pollIntervalSec * 1000);
      return;
    }

    const now = Date.now();
    if (now < this.backoffUntil) {
      this.scheduleNext(this.backoffUntil - now);
      return;
    }

    try {
      const presence = await this.computePresence();

      if (presence && !isSamePresence(this.lastPresence, presence)) {
        this.lastPresence = presence;
        this.options.onPresence(presence);
      }

      this.scheduleNext(this.options.pollIntervalSec * 1000);
    } catch (error) {
      if (error instanceof OnshapeRateLimitError) {
        this.backoffUntil = Date.now() + error.retryAfterSec * 1000;
        this.scheduleNext(error.retryAfterSec * 1000);
        return;
      }

      console.error('Onshape poll failed', error);
      this.scheduleNext(this.options.pollIntervalSec * 1000);
    }
  }

  private async computePresence(): Promise<PresenceState | null> {
    const doc = await this.options.client.getMostRecentDocument();
    if (!doc) {
      return null;
    }

    const idleMs = this.options.idleTimeoutMin * 60_000;
    const idle = Date.now() - doc.modifiedAt > idleMs;

    if (idle) {
      return {
        status: 'idle',
        details: doc.name,
        state: 'Idle in Onshape',
        elementType: 'unknown',
        documentUrl: doc.href,
        startedAt: doc.modifiedAt
      };
    }

    let element: OnshapeElementSummary | null = null;
    if (doc.workspaceId) {
      element = await this.options.client.getFirstElement(doc.id, doc.workspaceId);
    }

    const elementType = element ? ELEMENT_TYPE_MAP[element.elementType] ?? 'unknown' : 'unknown';

    return {
      status: 'connected',
      details: doc.name,
      state: element ? element.name : 'Working',
      elementType,
      documentUrl: doc.href,
      startedAt: doc.modifiedAt
    };
  }
}
