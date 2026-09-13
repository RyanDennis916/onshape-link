const API_BASE = 'https://cad.onshape.com/api';
const REQUEST_TIMEOUT_MS = 15_000;

export interface OnshapeDocumentSummary {
  id: string;
  name: string;
  modifiedAt: number;
  workspaceId: string | null;
  href: string;
}

export interface OnshapeElementSummary {
  id: string;
  name: string;
  elementType: string;
}

export class OnshapeRateLimitError extends Error {
  constructor(public readonly retryAfterSec: number) {
    super('Onshape API rate limited');
  }
}

export class OnshapeClient {
  constructor(private readonly getAccessToken: () => Promise<string | null>) {}

  public async getMostRecentDocument(): Promise<OnshapeDocumentSummary | null> {
    // filter=5 ("recent") returns documents ordered by when the current user last
    // opened them, unlike sortColumn=modifiedAt which reflects edits by anyone
    // with access and misses documents that are open but haven't been changed.
    const payload = await this.request<{ items: RawDocument[] }>('/documents?filter=5&limit=1');
    const doc = payload.items?.[0];
    if (!doc) {
      return null;
    }

    return {
      id: doc.id,
      name: doc.name,
      modifiedAt: Date.parse(doc.modifiedAt),
      workspaceId: doc.defaultWorkspace?.id ?? null,
      href: `https://cad.onshape.com/documents/${doc.id}`
    };
  }

  public async getFirstElement(documentId: string, workspaceId: string): Promise<OnshapeElementSummary | null> {
    const items = await this.request<RawElement[]>(`/documents/d/${documentId}/w/${workspaceId}/elements`);
    const usable = items.find((item) => item.elementType !== 'BLOB' && item.elementType !== 'APPLICATION');
    const element = usable ?? items[0];

    if (!element) {
      return null;
    }

    return { id: element.id, name: element.name, elementType: element.elementType };
  }

  private async request<T>(path: string): Promise<T> {
    const token = await this.getAccessToken();
    if (!token) {
      throw new Error('Not signed in to Onshape');
    }

    const response = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (response.status === 429) {
      const retryAfter = Number.parseInt(response.headers.get('Retry-After') ?? '5', 10);
      throw new OnshapeRateLimitError(Number.isFinite(retryAfter) ? retryAfter : 5);
    }

    if (!response.ok) {
      throw new Error(`Onshape API request failed (${response.status}): ${path}`);
    }

    return (await response.json()) as T;
  }
}

interface RawDocument {
  id: string;
  name: string;
  modifiedAt: string;
  defaultWorkspace?: { id: string };
}

interface RawElement {
  id: string;
  name: string;
  elementType: string;
}
