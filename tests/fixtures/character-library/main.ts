import {
  ANIMATION_ROWS,
  CELL_HEIGHT,
  CELL_WIDTH,
  MAX_ENCODED_BYTES,
  atlasDimensions,
  type AtlasProfile,
} from '../../../packages/target-chatgpt/contract';
import {
  CHARACTER_LIBRARY_DATABASE_VERSION,
  CHARACTER_LIBRARY_DEFAULT_DATABASE,
  CHARACTER_LIBRARY_MAX_BYTES,
  CHARACTER_LIBRARY_MAX_ENTRIES,
  CHARACTER_LIBRARY_MAX_NAME_LENGTH,
  CharacterLibraryError,
  createCharacterLibrary,
  type CharacterLibrary,
  type CharacterLibraryLimits,
  type CharacterSummary,
} from '../../../packages/character-library/index.ts';
import { sha256Hex } from '../../../packages/atlas-preview/sha256.ts';
import { MAX_MODEL_BYTES } from '../../../packages/character-core/vrm-file.ts';

type ProfileParameter = AtlasProfile | null;

interface InspectionInfo {
  valid: boolean;
  profile: string;
  requiredFrames: number;
  codes: string[];
  rows: number[];
  frames: number[];
}

interface FixtureErrorInfo {
  name: string;
  message: string;
  code: string | null;
  inspection: InspectionInfo | null;
}

type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: FixtureErrorInfo };

interface StoredInfo {
  summary: CharacterSummary;
  sha256: string;
  size: number;
  type: string;
}

interface BlobKeyInfo {
  key: string;
  size: number;
  type: string;
  base64: string;
}

interface AtlasOptions {
  empty?: { row: number; frame: number };
}

interface VrmOptions {
  name?: string;
  external?: boolean;
  version?: string;
}

interface FixtureCreateOptions {
  databaseName?: string;
  limits?: Partial<CharacterLibraryLimits>;
}

interface AbortResult {
  outcome: Outcome<CharacterSummary>;
  elapsedMs: number;
  decodeStarted: boolean;
}

interface ConcurrentAddRequest {
  handle: string;
  key: string;
  kind: 'vrm' | 'sprite';
  profile: ProfileParameter;
  name: string | null;
}

interface DatabaseInfo {
  name: string;
  version: number;
}

interface RawDatabaseInfo {
  version: number;
  stores: string[];
  entries: CharacterSummary[];
  activeId: string | null;
  assetIds: string[];
}

interface CharacterLibraryFixture {
  constants: () => {
    defaultDatabase: string;
    databaseVersion: number;
    maxEntries: number;
    maxBytes: number;
    maxNameLength: number;
    maxModelBytes: number;
    maxAtlasBytes: number;
  };
  create: (handle: string, options?: FixtureCreateOptions) => Promise<Outcome<void>>;
  close: (handle: string) => Promise<Outcome<void>>;
  forget: (handle: string) => Promise<Outcome<void>>;
  list: (handle: string) => Promise<Outcome<CharacterSummary[]>>;
  stored: (handle: string, id: string) => Promise<Outcome<StoredInfo | null>>;
  active: (handle: string) => Promise<Outcome<StoredInfo | null>>;
  addKey: (
    handle: string,
    key: string,
    kind: 'vrm' | 'sprite',
    profile: ProfileParameter,
    name?: string,
  ) => Promise<Outcome<CharacterSummary>>;
  addUrl: (
    handle: string,
    kind: 'vrm' | 'sprite',
    url: string,
    profile: ProfileParameter,
    name?: string,
  ) => Promise<Outcome<CharacterSummary>>;
  addBase64: (
    handle: string,
    kind: 'vrm' | 'sprite',
    base64: string,
    mime: string,
    profile: ProfileParameter,
    name?: string,
  ) => Promise<Outcome<CharacterSummary>>;
  addConcurrent: (requests: ConcurrentAddRequest[]) => Promise<Outcome<CharacterSummary>[]>;
  removeAndActivate: (
    removeHandle: string,
    activateHandle: string,
    id: string,
  ) => Promise<{ remove: Outcome<void>; activate: Outcome<void> }>;
  addKeyWithAbort: (
    handle: string,
    key: string,
    kind: 'vrm' | 'sprite',
    profile: ProfileParameter,
    name: string | null,
    mode: 'immediate' | 'decode',
  ) => Promise<AbortResult>;
  addKeyThenCloseAtDecode: (
    handle: string,
    key: string,
    kind: 'vrm' | 'sprite',
    profile: ProfileParameter,
    name: string | null,
  ) => Promise<AbortResult>;
  migrateUrl: (handle: string, url: string) => Promise<Outcome<CharacterSummary>>;
  migrateBase64: (handle: string, base64: string) => Promise<Outcome<CharacterSummary>>;
  migrateKey: (handle: string, key: string) => Promise<Outcome<CharacterSummary>>;
  activate: (handle: string, id: string) => Promise<Outcome<void>>;
  rename: (handle: string, id: string, name: unknown) => Promise<Outcome<void>>;
  remove: (handle: string, id: string) => Promise<Outcome<void>>;
  makeAtlas: (
    profile: AtlasProfile,
    format?: 'png' | 'webp',
    options?: AtlasOptions,
  ) => Promise<BlobKeyInfo>;
  makeWebp: (key: string, quality?: number) => Promise<BlobKeyInfo>;
  makeVrm: (options?: VrmOptions) => BlobKeyInfo;
  makeGarbageVrm: () => BlobKeyInfo;
  makeTruncatedVrm: () => BlobKeyInfo;
  makeTextBlob: (text: string, mime: string) => BlobKeyInfo;
  rewrapKey: (key: string, mime: string) => Promise<Outcome<BlobKeyInfo>>;
  hashKey: (key: string) => Promise<string>;
  hashUrl: (url: string) => Promise<Outcome<{ sha256: string; size: number; type: string }>>;
  fetchKey: (url: string) => Promise<Outcome<BlobKeyInfo>>;
  setDecodeDelays: (delays: number[]) => void;
  bitmapStats: () => {
    openBitmaps: number;
    closedBitmaps: number;
    outstandingBitmaps: number;
    activeDecodes: number;
    decodeCount: number;
  };
  databases: () => Promise<Outcome<DatabaseInfo[]>>;
  inspectRaw: (databaseName: string) => Promise<Outcome<RawDatabaseInfo>>;
  corruptAsset: (databaseName: string, id: string) => Promise<Outcome<{ size: number }>>;
  upgradeDatabase: (
    databaseName: string,
    version: number,
  ) => Promise<Outcome<{ version: number; stores: string[] }>>;
  setStatus: (text: string) => void;
}

declare global {
  interface Window {
    __libraryFixture: CharacterLibraryFixture;
  }
}

const LOG = document.querySelector<HTMLElement>('#log');
const STATUS = document.querySelector<HTMLElement>('#status');

const libraries = new Map<string, CharacterLibrary>();
const blobs = new Map<string, Blob>();
let sequence = 0;

const probe = {
  activeDecodes: 0,
  openBitmaps: 0,
  closedBitmaps: 0,
  decodeCount: 0,
  decodeDelays: [] as number[],
};

const originalCreateImageBitmap = window.createImageBitmap.bind(window) as (
  image: ImageBitmapSource,
  ...args: unknown[]
) => Promise<ImageBitmap>;
async function patchedCreateImageBitmap(
  image: ImageBitmapSource,
  ...args: unknown[]
): Promise<ImageBitmap> {
  probe.decodeCount += 1;
  const delay = probe.decodeDelays.shift() ?? 0;
  probe.activeDecodes += 1;
  try {
    if (delay > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, delay);
      });
    }
    const bitmap = await originalCreateImageBitmap(image, ...args);
    probe.openBitmaps += 1;
    return bitmap;
  } finally {
    probe.activeDecodes -= 1;
  }
}
window.createImageBitmap = patchedCreateImageBitmap as typeof window.createImageBitmap;

const closedBitmaps = new WeakSet<ImageBitmap>();
const originalCloseBitmap = ImageBitmap.prototype.close;
ImageBitmap.prototype.close = function close(): void {
  if (!closedBitmaps.has(this)) {
    closedBitmaps.add(this);
    probe.closedBitmaps += 1;
  }
  originalCloseBitmap.call(this);
};

function log(message: string): void {
  if (!LOG) {
    return;
  }
  LOG.textContent = `${new Date().toISOString()} ${message}\n${LOG.textContent ?? ''}`;
}

function setStatus(text: string): void {
  if (STATUS) {
    STATUS.textContent = text;
  }
  log(text);
}

function inspectionInfo(value: unknown): InspectionInfo | null {
  if (
    value === null
    || typeof value !== 'object'
    || !Array.isArray((value as { errors?: unknown }).errors)
  ) {
    return null;
  }
  const inspection = value as {
    valid?: boolean;
    profile?: unknown;
    requiredFrames?: unknown;
    errors: { code: string; row?: number; frame?: number }[];
  };
  return {
    valid: inspection.valid === true,
    profile: String(inspection.profile),
    requiredFrames: Number(inspection.requiredFrames),
    codes: inspection.errors.map((issue) => issue.code),
    rows: inspection.errors
      .map((issue) => issue.row)
      .filter((row): row is number => typeof row === 'number'),
    frames: inspection.errors
      .map((issue) => issue.frame)
      .filter((frame): frame is number => typeof frame === 'number'),
  };
}

function errorInfo(error: unknown): FixtureErrorInfo {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  let code: string | null = null;
  let inspection: InspectionInfo | null = null;
  if (error instanceof CharacterLibraryError) {
    code = error.code;
    inspection = inspectionInfo(error.inspection);
  } else if (error !== null && typeof error === 'object') {
    const candidate = error as { code?: unknown; inspection?: unknown };
    code = typeof candidate.code === 'string' ? candidate.code : null;
    inspection = inspectionInfo(candidate.inspection);
  }
  return { name, message, code, inspection };
}

async function settle<T>(action: () => T | Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, error: errorInfo(error) };
  }
}

function requireLibrary(handle: string): CharacterLibrary {
  const library = libraries.get(handle);
  if (!library) {
    throw new Error(`未知的 fixture 句柄：${handle}`);
  }
  return library;
}

function requireBlob(key: string): Blob {
  const blob = blobs.get(key);
  if (!blob) {
    throw new Error(`未知的 fixture Blob：${key}`);
  }
  return blob;
}

function registerBlob(blob: Blob): string {
  sequence += 1;
  const key = `library-blob-${sequence}`;
  blobs.set(key, blob);
  return key;
}

function blobFromBase64(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function describeKey(key: string): Promise<BlobKeyInfo> {
  const blob = requireBlob(key);
  return {
    key,
    size: blob.size,
    type: blob.type,
    base64: await blobToBase64(blob),
  };
}

function createInput(
  kind: 'vrm' | 'sprite',
  blob: Blob,
  profile: ProfileParameter,
  name: string | null | undefined,
) {
  if (kind === 'vrm') {
    return name === undefined || name === null
      ? { kind: 'vrm' as const, blob }
      : { kind: 'vrm' as const, blob, name };
  }
  if (profile !== 'v1' && profile !== 'v2') {
    throw new Error(`精灵图需要 v1 或 v2 profile，收到 ${String(profile)}。`);
  }
  return name === undefined || name === null
    ? { kind: 'sprite' as const, blob, profile }
    : { kind: 'sprite' as const, blob, profile, name };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

async function waitForDecode(startedAt: number, isFinished: () => boolean): Promise<boolean> {
  while (probe.activeDecodes < 1 && !isFinished()) {
    if (performance.now() - startedAt > 10000) {
      return false;
    }
    await wait(5);
  }
  return probe.activeDecodes >= 1;
}

async function addKeyWithAbort(
  handle: string,
  key: string,
  kind: 'vrm' | 'sprite',
  profile: ProfileParameter,
  name: string | null,
  mode: 'immediate' | 'decode',
): Promise<AbortResult> {
  const library = requireLibrary(handle);
  const controller = new AbortController();
  const startedAt = performance.now();
  let finished = false;
  const pending = settle(() => library.add(createInput(kind, requireBlob(key), profile, name), controller.signal))
    .finally(() => {
      finished = true;
    });
  let decodeStarted = false;
  if (mode === 'immediate') {
    controller.abort();
  } else {
    decodeStarted = await waitForDecode(startedAt, () => finished);
    controller.abort();
  }
  const outcome = await pending;
  return {
    outcome,
    elapsedMs: performance.now() - startedAt,
    decodeStarted,
  };
}

async function addKeyThenCloseAtDecode(
  handle: string,
  key: string,
  kind: 'vrm' | 'sprite',
  profile: ProfileParameter,
  name: string | null,
): Promise<AbortResult> {
  const library = requireLibrary(handle);
  const startedAt = performance.now();
  let finished = false;
  const pending = settle(() => library.add(createInput(kind, requireBlob(key), profile, name)))
    .finally(() => {
      finished = true;
    });
  const decodeStarted = await waitForDecode(startedAt, () => finished);
  library.close();
  const outcome = await pending;
  return {
    outcome,
    elapsedMs: performance.now() - startedAt,
    decodeStarted,
  };
}

function glbBytes(document: unknown): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const length = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(new ArrayBuffer(20 + length));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20);
  bytes.set(json, 20);
  return bytes;
}

function makeVrmKey(options: VrmOptions = {}): BlobKeyInfo {
  const document: Record<string, unknown> = {
    extensions: {
      VRMC_vrm: {
        specVersion: options.version ?? '1.0',
        meta: {
          name: options.name ?? '合成角色',
          authors: ['Fixture'],
        },
      },
    },
  };
  if (options.external) {
    document.images = [{ uri: 'https://example.com/not-allowed.png' }];
  }
  const bytes = glbBytes(document);
  const key = registerBlob(new Blob([bytes], { type: 'model/gltf-binary' }));
  return {
    key,
    size: bytes.byteLength,
    type: 'model/gltf-binary',
    base64: btoa(String.fromCharCode(...bytes)),
  };
}

function makeTruncatedVrmKey(): BlobKeyInfo {
  const full = glbBytes({
    extensions: { VRMC_vrm: { specVersion: '1.0', meta: { name: '截断角色' } } },
  });
  const bytes = full.slice(0, full.byteLength - 4);
  const key = registerBlob(new Blob([bytes], { type: 'model/gltf-binary' }));
  return {
    key,
    size: bytes.byteLength,
    type: 'model/gltf-binary',
    base64: btoa(String.fromCharCode(...bytes)),
  };
}

function canvasToBlob(element: HTMLCanvasElement, format: 'png' | 'webp', quality = 1): Promise<Blob> {
  return new Promise((resolve, reject) => {
    element.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Canvas 无法编码图集。'));
          return;
        }
        if (blob.type !== `image/${format}`) {
          reject(new Error(`Canvas 编码类型为 ${blob.type || '空'}，预期 image/${format}。`));
          return;
        }
        resolve(blob);
      },
      `image/${format}`,
      quality,
    );
  });
}

function framesInRow(profile: AtlasProfile, row: number): number {
  if (row < ANIMATION_ROWS.length) {
    return ANIMATION_ROWS[row].frames;
  }
  return profile === 'v2' && row < 11 ? 8 : 0;
}

async function makeAtlas(
  profile: AtlasProfile,
  format: 'png' | 'webp' = 'png',
  options: AtlasOptions = {},
): Promise<BlobKeyInfo> {
  const { width, height } = atlasDimensions(profile);
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const context = element.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Fixture 无法创建 Canvas 2D 上下文。');
  }
  const rows = profile === 'v2' ? 11 : 9;
  for (let row = 0; row < rows; row += 1) {
    const frames = framesInRow(profile, row);
    for (let frame = 0; frame < frames; frame += 1) {
      if (options.empty?.row === row && options.empty.frame === frame) {
        continue;
      }
      context.fillStyle = '#f8fafc';
      context.fillRect(frame * CELL_WIDTH + 2, row * CELL_HEIGHT + 2, 6, 6);
    }
  }
  const blob = await canvasToBlob(element, format);
  const key = registerBlob(blob);
  return describeKey(key);
}

async function makeWebp(key: string, quality = 1): Promise<BlobKeyInfo> {
  const source = requireBlob(key);
  const bitmap = await createImageBitmap(source);
  try {
    const element = document.createElement('canvas');
    element.width = bitmap.width;
    element.height = bitmap.height;
    const context = element.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Fixture 无法创建 Canvas 2D 上下文。');
    }
    context.drawImage(bitmap, 0, 0);
    const blob = await canvasToBlob(element, 'webp', quality);
    const generated = registerBlob(blob);
    return describeKey(generated);
  } finally {
    bitmap.close();
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败。'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException('事务已中止。', 'AbortError'));
    tx.onerror = () => reject(tx.error ?? new Error('事务失败。'));
  });
}

function openRawDatabase(name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined
      ? indexedDB.open(name)
      : indexedDB.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开数据库。'));
    request.onblocked = () => reject(new DOMException('数据库打开被阻塞。', 'InvalidStateError'));
  });
}

async function inspectRaw(databaseName: string): Promise<RawDatabaseInfo> {
  const db = await openRawDatabase(databaseName);
  try {
    const stores = Array.from(db.objectStoreNames);
    const tx = db.transaction(['characters', 'assets', 'meta'], 'readonly');
    const entries = await requestResult<CharacterSummary[]>(
      tx.objectStore('characters').getAll(),
    );
    const assetIds = await requestResult<IDBValidKey[]>(
      tx.objectStore('assets').getAllKeys(),
    );
    const pointer = await requestResult<{ id?: unknown } | undefined>(
      tx.objectStore('meta').get('active'),
    );
    await transactionDone(tx);
    return {
      version: db.version,
      stores,
      entries,
      activeId: pointer && typeof pointer.id === 'string' ? pointer.id : null,
      assetIds: assetIds.map((value) => String(value)),
    };
  } finally {
    db.close();
  }
}

async function corruptAsset(databaseName: string, id: string): Promise<{ size: number }> {
  const db = await openRawDatabase(databaseName);
  try {
    const readTx = db.transaction('assets', 'readonly');
    const record = await requestResult<{ id: string; blob: Blob } | undefined>(
      readTx.objectStore('assets').get(id),
    );
    await transactionDone(readTx);
    if (!record || !(record.blob instanceof Blob)) {
      throw new Error(`未找到资产：${id}`);
    }
    const source = new Uint8Array(await record.blob.arrayBuffer());
    if (source.byteLength === 0) {
      throw new Error('资产为空，无法制造同长度损坏。');
    }
    const bytes = new Uint8Array(new ArrayBuffer(source.byteLength));
    bytes.set(source);
    bytes[bytes.byteLength - 1] ^= 0xff;
    const writeTx = db.transaction('assets', 'readwrite');
    await requestResult(writeTx.objectStore('assets').put({
      id,
      blob: new Blob([bytes], { type: record.blob.type }),
    }));
    await transactionDone(writeTx);
    return { size: bytes.byteLength };
  } finally {
    db.close();
  }
}

async function upgradeDatabase(
  databaseName: string,
  version: number,
): Promise<{ version: number; stores: string[] }> {
  const db = await openRawDatabase(databaseName, version);
  try {
    return { version: db.version, stores: Array.from(db.objectStoreNames) };
  } finally {
    db.close();
  }
}

async function listDatabases(): Promise<DatabaseInfo[]> {
  const databases = await indexedDB.databases();
  return databases
    .filter((entry): entry is { name: string; version?: number } => typeof entry.name === 'string')
    .map((entry) => ({ name: entry.name, version: entry.version ?? 0 }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

async function storedInfo(handle: string, id: string): Promise<StoredInfo | null> {
  const asset = await requireLibrary(handle).get(id);
  if (!asset) {
    return null;
  }
  const buffer = await asset.blob.arrayBuffer();
  return {
    summary: asset.summary,
    sha256: await sha256Hex(buffer),
    size: asset.blob.size,
    type: asset.blob.type,
  };
}

async function activeInfo(handle: string): Promise<StoredInfo | null> {
  const asset = await requireLibrary(handle).getActive();
  if (!asset) {
    return null;
  }
  const buffer = await asset.blob.arrayBuffer();
  return {
    summary: asset.summary,
    sha256: await sha256Hex(buffer),
    size: asset.blob.size,
    type: asset.blob.type,
  };
}

const fixture: CharacterLibraryFixture = {
  constants: () => ({
    defaultDatabase: CHARACTER_LIBRARY_DEFAULT_DATABASE,
    databaseVersion: CHARACTER_LIBRARY_DATABASE_VERSION,
    maxEntries: CHARACTER_LIBRARY_MAX_ENTRIES,
    maxBytes: CHARACTER_LIBRARY_MAX_BYTES,
    maxNameLength: CHARACTER_LIBRARY_MAX_NAME_LENGTH,
    maxModelBytes: MAX_MODEL_BYTES,
    maxAtlasBytes: MAX_ENCODED_BYTES,
  }),
  create: (handle, options) => settle(() => {
    if (libraries.has(handle)) {
      throw new Error(`fixture 句柄已存在：${handle}`);
    }
    const library = createCharacterLibrary(options);
    libraries.set(handle, library);
  }),
  close: (handle) => settle(() => {
    requireLibrary(handle).close();
  }),
  forget: (handle) => settle(() => {
    const library = libraries.get(handle);
    if (library) {
      library.close();
      libraries.delete(handle);
    }
  }),
  list: (handle) => settle(() => requireLibrary(handle).list()),
  stored: (handle, id) => settle(() => storedInfo(handle, id)),
  active: (handle) => settle(() => activeInfo(handle)),
  addKey: (handle, key, kind, profile, name) => settle(() => (
    requireLibrary(handle).add(createInput(kind, requireBlob(key), profile, name))
  )),
  addUrl: (handle, kind, url, profile, name) => settle(async () => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`无法获取 ${url}：HTTP ${response.status}`);
    }
    const blob = await response.blob();
    return requireLibrary(handle).add(createInput(kind, blob, profile, name));
  }),
  addBase64: (handle, kind, base64, mime, profile, name) => settle(() => (
    requireLibrary(handle).add(
      createInput(kind, blobFromBase64(base64, mime), profile, name),
    )
  )),
  addConcurrent: (requests) => Promise.all(requests.map((request) => settle(() => (
    requireLibrary(request.handle).add(createInput(
      request.kind,
      requireBlob(request.key),
      request.profile,
      request.name,
    ))
  )))),
  removeAndActivate: (removeHandle, activateHandle, id) => {
    const remove = settle(() => requireLibrary(removeHandle).remove(id));
    const activate = settle(() => requireLibrary(activateHandle).activate(id));
    return Promise.all([remove, activate]).then(([removeOutcome, activateOutcome]) => ({
      remove: removeOutcome,
      activate: activateOutcome,
    }));
  },
  addKeyWithAbort,
  addKeyThenCloseAtDecode,
  migrateUrl: (handle, url) => settle(async () => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`无法获取 ${url}：HTTP ${response.status}`);
    }
    return requireLibrary(handle).migrateLegacyVrm(await response.arrayBuffer());
  }),
  migrateBase64: (handle, base64) => settle(() => {
    const bytes = blobFromBase64(base64, 'model/gltf-binary');
    return bytes.arrayBuffer().then((buffer) => (
      requireLibrary(handle).migrateLegacyVrm(buffer)
    ));
  }),
  migrateKey: (handle, key) => settle(async () => {
    const buffer = await requireBlob(key).arrayBuffer();
    return requireLibrary(handle).migrateLegacyVrm(buffer);
  }),
  activate: (handle, id) => settle(() => requireLibrary(handle).activate(id)),
  rename: (handle, id, name) => settle(() => (
    requireLibrary(handle).rename(id, name as string)
  )),
  remove: (handle, id) => settle(() => requireLibrary(handle).remove(id)),
  makeAtlas,
  makeWebp,
  makeVrm: makeVrmKey,
  makeGarbageVrm: () => {
    const bytes = new TextEncoder().encode('this is not a glb file');
    const key = registerBlob(new Blob([bytes], { type: 'model/gltf-binary' }));
    return {
      key,
      size: bytes.byteLength,
      type: 'model/gltf-binary',
      base64: btoa(String.fromCharCode(...bytes)),
    };
  },
  makeTruncatedVrm: makeTruncatedVrmKey,
  makeTextBlob: (text, mime) => {
    const bytes = new TextEncoder().encode(text);
    const key = registerBlob(new Blob([bytes], { type: mime }));
    return {
      key,
      size: bytes.byteLength,
      type: mime,
      base64: btoa(String.fromCharCode(...bytes)),
    };
  },
  rewrapKey: (key, mime) => settle(async () => {
    const bytes = new Uint8Array(await requireBlob(key).arrayBuffer());
    return describeKey(registerBlob(new Blob([bytes], { type: mime })));
  }),
  hashKey: (key) => requireBlob(key).arrayBuffer().then((buffer) => sha256Hex(buffer)),
  hashUrl: (url) => settle(async () => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`无法获取 ${url}：HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    return {
      sha256: await sha256Hex(buffer),
      size: blob.size,
      type: blob.type,
    };
  }),
  fetchKey: (url) => settle(async () => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`无法获取 ${url}：HTTP ${response.status}`);
    }
    return describeKey(registerBlob(await response.blob()));
  }),
  setDecodeDelays: (delays) => {
    probe.decodeDelays = [...delays];
  },
  bitmapStats: () => ({
    openBitmaps: probe.openBitmaps,
    closedBitmaps: probe.closedBitmaps,
    outstandingBitmaps: probe.openBitmaps - probe.closedBitmaps,
    activeDecodes: probe.activeDecodes,
    decodeCount: probe.decodeCount,
  }),
  databases: () => settle(listDatabases),
  inspectRaw: (databaseName) => settle(() => inspectRaw(databaseName)),
  corruptAsset: (databaseName, id) => settle(() => corruptAsset(databaseName, id)),
  upgradeDatabase: (databaseName, version) => settle(() => upgradeDatabase(databaseName, version)),
  setStatus,
};

window.__libraryFixture = fixture;
setStatus('character library fixture ready');
