export type Warning = { code: string; message: string; messageId?: string };
export interface SourceManifest {
  version: 1; scope: 'file' | 'local-session';
  files: Array<{ uri: string; sha256: string; bytes: number; records: number }>;
  messageCounts: { user: number; assistant: number; tool: number };
  excludedContextRecords: number; deduplicatedMessages: number; retainedAmbiguousMessages: number;
}
export interface SourceOptions { codexHome?: string; claudeHome?: string }
export interface DiscoveredSession { channel: string; input: string; filename: string; session?: string; inputs?: string[]; segments?: number }
export type ContentPart =
  | { type: 'text'; text: string; format: 'plain' | 'markdown' }
  | { type: 'code'; text: string; language?: string }
  | { type: 'tool'; text: string; name?: string }
  | { type: 'image'; src: string; label?: string }
  | { type: 'unsupported'; label: string };
export interface SourceArtifactV1 {
  version: 1; kind: string; id: string; title: string;
  source: { channel: string; uri?: string; completeness?: 'complete' | 'partial' | 'unknown'; manifest?: SourceManifest };
  warnings?: Warning[];
}
export interface ConversationV1 extends SourceArtifactV1 {
  kind: 'conversation';
  messages: Array<{ id: string; role: 'user' | 'assistant' | 'tool'; content: ContentPart[]; timestamp?: string; turnId?: string; model?: string; modelSource?: 'message' | 'turn_context'; phase?: 'commentary' | 'final'; sourceRefs?: Array<{ uri: string; line: number }> }>;
  warnings?: Warning[];
}
export type DocumentNode =
  | { type: 'quote'; children: DocumentNode[]; sourceMessageId?: string }
  | { type: 'step'; label: string; children: DocumentNode[]; sourceMessageId?: string }
  | { type: 'heading'; level: number; text: string; role?: string; sourceMessageId?: string }
  | { type: 'paragraph' | 'markdown' | 'metadata'; text: string; sourceMessageId?: string }
  | { type: 'code'; text: string; language?: string; caption?: string; sourceMessageId?: string }
  | { type: 'image'; src: string; label: string; sourceMessageId?: string }
  | { type: 'divider' };
export interface DocumentV1 {
  version: 1; kind: 'document'; title: string; nodes: DocumentNode[];
  source: ConversationV1['source']; warnings: Warning[];
  coverage: { sourceMessages: number; publishedMessages: number; excludedToolItems: number; displayGroups?: number; mergedAssistantMessages?: number };
  unsupported: 'warn' | 'error';
}
export interface Adapter {
  id: string; version: 1;
  load(request: ExportRequest): Promise<SourceArtifactV1>;
}
export interface FormatProtocol {
  id: string; version: 1; inputKinds: string[];
  selectMessages?(model: SourceArtifactV1, options: Record<string, unknown>): ConversationV1['messages'];
  format(model: SourceArtifactV1, options: Record<string, unknown>, context?: { append?: boolean; groupOffset?: number }): DocumentV1;
}
export interface Artifact { format: string; extension: string; body: string; warnings: Warning[]; verificationText: string }
export interface Renderer {
  id: string; version: 1; outputFormat: string;
  render(document: DocumentV1): Artifact;
  preview?(title: string, artifact: Artifact): string;
}
export interface Target { backend: string; operation: string; parentToken?: string; documentId?: string; namespace?: string; params?: Record<string, unknown> }
export interface ExportOptions { protocol?: string; renderer?: string; format?: Record<string, unknown>; target?: Partial<Target> }
export interface Config {
  version?: 1; defaults?: ExportOptions; channels?: Record<string, ExportOptions>; profiles?: Record<string, ExportOptions>;
  backends?: Record<string, Record<string, unknown>>; stateDir?: string;
}
export interface ExportRequest { channel: string; input?: string; session?: string; title?: string; profile?: string; key?: string; overrides?: ExportOptions; sourceOptions?: SourceOptions }
export interface PublishPlan {
  version: 1; source: { channel: string; artifactId: string; completeness: string; manifest?: SourceManifest };
  protocol: { id: string; version: number; options: Record<string, unknown> }; renderer: { id: string; version: number };
  target: Target & { identityScope: string }; document: Pick<DocumentV1, 'title' | 'kind' | 'coverage'>;
  artifact: Artifact; fingerprint: string; exportKey: string; sync?: SessionCheckpoint;
}
export interface SessionCheckpoint {
  key: string; previousExportKey: string | null;
  messages: Array<{ id: string; hash: string }>; displayGroups: number; unchanged: boolean;
}
export interface RemoteReceipt { documentId: string; url?: string; warnings?: Warning[] }
export interface Verification {
  passed: boolean; method: string; expectedCharacters?: number; actualCharacters?: number; visualVerified: boolean;
  normalizations?: string[]; difference?: { kind: string; offset?: number; expected?: string; actual?: string };
}
export interface PublishReceipt {
  version: 1; exportKey: string; fingerprint: string; status: 'publishing' | 'written' | 'verified' | 'verification_failed' | 'uncertain';
  backend: string; operation: string; createdAt: string; remote?: RemoteReceipt; warnings: Warning[];
  verification?: Verification; errorCode?: string; reused?: boolean; sync?: SessionCheckpoint;
}
export interface Backend {
  id: string; version: 1; scope?: string;
  capabilities: { formats: string[]; operations: string[]; kinds: string[] };
  validateTarget?(target: Target): void;
  publish(plan: PublishPlan): Promise<RemoteReceipt>;
  verify(receipt: RemoteReceipt, plan: PublishPlan): Promise<Verification>;
}
export interface ReceiptStore {
  get(key: string): Promise<PublishReceipt | undefined>;
  put(key: string, receipt: PublishReceipt): Promise<void>;
  withLock<T>(key: string, action: () => Promise<T>): Promise<T>;
}
export class Registry<T extends { id: string; version: number }> {
  constructor(kind: string, entries?: T[]); add(entry: T): this; get(id: string): T; ids(): string[];
}
export class FileReceiptStore implements ReceiptStore {
  constructor(directory: string); directory: string; file(key: string): string;
  get(key: string): Promise<PublishReceipt | undefined>; put(key: string, receipt: PublishReceipt): Promise<void>;
  withLock<T>(key: string, action: () => Promise<T>): Promise<T>;
}
export class LarkCliBackend implements Backend {
  constructor(options?: { executable?: string; identity?: 'user' | 'bot'; timeoutMs?: number }, runner?: (executable: string, args: string[], options: { input?: string; timeoutMs: number }) => Promise<unknown>);
  id: string; version: 1; scope: string; capabilities: Backend['capabilities'];
  publish(plan: PublishPlan): Promise<RemoteReceipt>; verify(receipt: RemoteReceipt, plan: PublishPlan): Promise<Verification>;
}
export class ExportEngine {
  constructor(options: { adapters: Registry<Adapter>; protocols: Registry<FormatProtocol>; renderers: Registry<Renderer>; backends: Registry<Backend>; config: Config; store: ReceiptStore });
  adapters: Registry<Adapter>; protocols: Registry<FormatProtocol>; renderers: Registry<Renderer>; backends: Registry<Backend>; store: ReceiptStore;
  plan(request: ExportRequest): Promise<PublishPlan>;
  preview(plan: PublishPlan, directory: string): Promise<{ directory: string; artifact: string; html?: string; plan: string }>;
  publish(plan: PublishPlan): Promise<PublishReceipt>;
}
export function createLarkAnything(options?: { config?: Config; adapters?: Adapter[]; protocols?: FormatProtocol[]; renderers?: Renderer[]; backends?: Backend[]; store?: ReceiptStore }): ExportEngine;
export function validateConversation(value: unknown): ConversationV1;
export function validateSourceArtifact(value: unknown): SourceArtifactV1;
export function loadConfig(file?: string): Promise<Config>;
export function resolveOptions(config: Config, channel: string, profile?: string, overrides?: ExportOptions): Required<ExportOptions>;
export function discoverSessions(channel: string, options?: SourceOptions): Promise<DiscoveredSession[]>;
export function resolveSession(channel: string, id: string, options?: SourceOptions): Promise<string>;
export function resolveSessionSources(channel: string, id: string, options?: SourceOptions): Promise<string[]>;
export class LarkAnythingError extends Error { constructor(code: string, message: string, details?: Record<string, unknown>); code: string; details: Record<string, unknown> }
export const MODEL_VERSION: 1;
export const codexAdapter: Adapter, claudeCodeAdapter: Adapter, chatgptAdapter: Adapter, genericAdapter: Adapter;
export const transcriptProtocol: FormatProtocol, markdownRenderer: Renderer;
