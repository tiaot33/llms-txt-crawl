export interface CrawlOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  onProgress?: (event: CrawlProgressEvent) => void;
  onDocument?: (event: CrawlDocumentEvent) => void | Promise<void>;
}

export interface CrawlDocumentEvent {
  url: string;
  sourceUrl?: string;
  content: string;
  contentType?: string;
}

export type CrawlProgressEvent =
  | {
    type: "start";
    inputUrl: string;
  }
  | {
    type: "probe";
    url: string;
  }
  | {
    type: "crawl";
    url: string;
    sourceUrl?: string;
  }
  | {
    type: "retry";
    url: string;
    statusCode: number;
    nextDelayMs: number;
    attempt: number;
  }
  | {
    type: "complete";
    summary: CrawlSummary;
  };

export type ProbeType = "direct-seed" | "candidate";
export type DocumentStatus = "success" | "failed" | "skipped";

export interface ProbeResult {
  url: string;
  probeType: ProbeType;
  candidateName?: "llms.txt" | "llms-full.txt" | "llms-small.txt";
  statusCode?: number;
  hit: boolean;
  skipped: boolean;
  attempts: number;
  retries: number;
  error?: string;
}

export interface LinkEdge {
  from: string;
  to: string;
}

export interface DocumentNode {
  url: string;
  sourceUrl?: string;
  status: DocumentStatus;
  statusCode?: number;
  attempts: number;
  retries: number;
  error?: string;
  skippedReason?: string;
  discoveredLinks: string[];
}

export interface CrawlSummary {
  seedsCount: number;
  probesTotal: number;
  probesHit: number;
  documentsTotal: number;
  documentsSucceeded: number;
  documentsFailed: number;
  documentsSkipped: number;
  restrictedRetries: number;
}

export interface CrawlResult {
  inputUrl: string;
  settings: {
    maxRetries: number;
    baseDelayMs: number;
    timeoutMs: number;
  };
  probes: ProbeResult[];
  documents: DocumentNode[];
  edges: LinkEdge[];
  summary: CrawlSummary;
}
