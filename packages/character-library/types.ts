import type { AtlasInspection, AtlasProfile } from '../target-chatgpt/contract';

export const CHARACTER_LIBRARY_DEFAULT_DATABASE = 'oigptpet-library';
export const CHARACTER_LIBRARY_DATABASE_VERSION = 1;
export const CHARACTER_LIBRARY_MAX_ENTRIES = 12;
export const CHARACTER_LIBRARY_MAX_BYTES = 256 * 1024 * 1024;
export const CHARACTER_LIBRARY_MAX_NAME_LENGTH = 80;

export type CharacterKind = 'vrm' | 'sprite';

export type CharacterInput =
  | { kind: 'vrm'; blob: Blob; name?: string }
  | { kind: 'sprite'; blob: Blob; profile: AtlasProfile; name?: string };

export interface CharacterSummary {
  id: string;
  kind: CharacterKind;
  name: string;
  sha256: string;
  encodedBytes: number;
  createdAt: string;
  profile?: AtlasProfile;
}

export interface CharacterAsset {
  summary: CharacterSummary;
  blob: Blob;
}

export interface CharacterLibraryLimits {
  maxEntries: number;
  maxBytes: number;
}

export interface CharacterLibraryOptions {
  databaseName?: string;
  /**
   * Test / embedding hook. Each value is clamped to the production maximum;
   * production callers should omit this.
   */
  limits?: Partial<CharacterLibraryLimits>;
}

export type CharacterLibraryErrorCode =
  | 'invalid-input'
  | 'invalid-name'
  | 'entry-limit'
  | 'byte-limit'
  | 'not-found'
  | 'active-character'
  | 'incomplete-asset'
  | 'conflict'
  | 'storage'
  | 'quota'
  | 'blocked'
  | 'closed';

export interface CharacterLibraryErrorOptions {
  cause?: unknown;
  inspection?: AtlasInspection | null;
}

export class CharacterLibraryError extends Error {
  readonly code: CharacterLibraryErrorCode;
  readonly inspection: AtlasInspection | null;

  constructor(
    code: CharacterLibraryErrorCode,
    message: string,
    options: CharacterLibraryErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CharacterLibraryError';
    this.code = code;
    this.inspection = options.inspection ?? null;
  }
}

export interface CharacterLibrary {
  list(): Promise<CharacterSummary[]>;
  get(id: string): Promise<CharacterAsset | null>;
  add(input: CharacterInput, signal?: AbortSignal): Promise<CharacterSummary>;
  addAndActivate(input: CharacterInput, signal?: AbortSignal, beforeCommit?: () => void): Promise<CharacterSummary>;
  getActive(): Promise<CharacterAsset | null>;
  activate(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  migrateLegacyVrm(buffer: ArrayBuffer): Promise<CharacterSummary>;
  close(): void;
}

export interface PreparedCharacter {
  summary: CharacterSummary;
  blob: Blob;
}
