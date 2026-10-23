/**
 * Small in-memory IndexedDB subset used only by unit tests. Transactions and
 * requests are serialized; conflicting writes therefore exercise the same
 * cross-transaction assertions as a real browser. The independent smoke uses
 * real Chromium IndexedDB for persistence and transaction semantics.
 */

type Key = IDBValidKey;

interface StoreState {
  keyPath?: string;
  values: Map<Key, unknown>;
}

interface DatabaseState {
  version: number;
  stores: Map<string, StoreState>;
}

class FakeRequest {
  result: unknown;
  error: DOMException | null = null;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
}

function event(target: unknown): Event {
  return { target } as Event;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nextTask(callback: () => void): ReturnType<typeof setTimeout> {
  return setTimeout(callback, 0);
}

class FakeObjectStore {
  readonly name: string;
  private readonly transaction: FakeTransaction;

  constructor(name: string, transaction: FakeTransaction) {
    this.name = name;
    this.transaction = transaction;
  }

  get(key: Key): FakeRequest {
    return this.transaction.enqueue('get', this.name, { key });
  }

  getAll(): FakeRequest {
    return this.transaction.enqueue('getAll', this.name, {});
  }

  add(value: unknown): FakeRequest {
    return this.transaction.enqueue('add', this.name, { value });
  }

  put(value: unknown, key?: Key): FakeRequest {
    return this.transaction.enqueue('put', this.name, { value, key });
  }

  delete(key: Key): FakeRequest {
    return this.transaction.enqueue('delete', this.name, { key });
  }
}

interface Operation {
  type: 'get' | 'getAll' | 'add' | 'put' | 'delete';
  store: string;
  key?: Key;
  value?: unknown;
  request: FakeRequest;
}

class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onabort: ((event: Event) => void) | null = null;

  private readonly fake: FakeIndexedDb;
  private readonly state: DatabaseState;
  private readonly mode: IDBTransactionMode;
  private readonly releaseTurn: () => void;
  private readonly ready: Promise<void>;
  private readonly operations: Operation[] = [];
  private working: Map<string, StoreState> | null = null;
  private acquired = false;
  private finished = false;
  private aborted = false;
  private processing = false;
  private completionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    fake: FakeIndexedDb,
    state: DatabaseState,
    mode: IDBTransactionMode,
    ready: Promise<void>,
    releaseTurn: () => void,
  ) {
    this.fake = fake;
    this.state = state;
    this.mode = mode;
    this.ready = ready;
    this.releaseTurn = releaseTurn;
    void this.begin();
  }

  objectStore(name: string): FakeObjectStore {
    if (!this.state.stores.has(name)) {
      throw new DOMException(`Unknown object store: ${name}`, 'NotFoundError');
    }
    return new FakeObjectStore(name, this);
  }

  abort(): void {
    if (this.finished) {
      throw new DOMException('The transaction has finished.', 'InvalidStateError');
    }
    if (this.aborted) {
      return;
    }
    this.aborted = true;
    if (this.completionTimer !== null) {
      clearTimeout(this.completionTimer);
      this.completionTimer = null;
    }
    if (this.acquired) {
      this.finishAbort();
    }
    // If the turn has not been acquired yet, begin() will finish the abort.
  }

  enqueue(
    type: Operation['type'],
    store: string,
    payload: { key?: Key; value?: unknown },
  ): FakeRequest {
    if (this.finished) {
      throw new DOMException('The transaction has finished.', 'TransactionInactiveError');
    }
    if (this.aborted) {
      throw new DOMException('The transaction was aborted.', 'TransactionInactiveError');
    }
    const request = new FakeRequest();
    this.operations.push({ type, store, request, ...payload });
    if (this.acquired && !this.processing) {
      void this.process();
    }
    return request;
  }

  private async begin(): Promise<void> {
    await this.ready;
    if (this.finished) {
      this.releaseTurn();
      return;
    }
    if (this.aborted) {
      this.finishAbort();
      return;
    }
    this.acquired = true;
    this.working = this.mode === 'readwrite'
      ? this.cloneStores(this.state.stores)
      : this.state.stores;
    await this.process();
  }

  private cloneStores(source: Map<string, StoreState>): Map<string, StoreState> {
    const cloned = new Map<string, StoreState>();
    for (const [name, store] of source) {
      cloned.set(name, {
        keyPath: store.keyPath,
        values: new Map(store.values),
      });
    }
    return cloned;
  }

  private async process(): Promise<void> {
    if (this.processing) {
      return;
    }
    this.processing = true;
    if (this.completionTimer !== null) {
      clearTimeout(this.completionTimer);
      this.completionTimer = null;
    }
    while (this.operations.length > 0 && !this.aborted) {
      const operation = this.operations.shift() as Operation;
      const result = this.execute(operation);
      if (result.failure) {
        operation.request.error = result.failure;
        this.error = result.failure;
        operation.request.onerror?.(event(operation.request));
        await new Promise<void>((resolve) => nextTask(() => resolve()));
        this.processing = false;
        this.finishAbort(result.failure);
        return;
      }
      operation.request.result = result.value;
      operation.request.onsuccess?.(event(operation.request));
      await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
    }
    this.processing = false;
    if (!this.aborted && !this.finished) {
      this.scheduleComplete();
    }
  }

  private execute(operation: Operation): { value?: unknown; failure?: DOMException } {
    const store = this.working?.get(operation.store);
    if (!store) {
      return { failure: new DOMException('Unknown store.', 'NotFoundError') };
    }

    if (operation.type === 'get') {
      return { value: clone(store.values.get(operation.key as Key)) };
    }
    if (operation.type === 'getAll') {
      return { value: Array.from(store.values.values()).map(clone) };
    }
    if (operation.type === 'delete') {
      if (this.fake.consumeWriteFailure(operation.store)) {
        return { failure: new DOMException('Injected quota failure.', 'QuotaExceededError') };
      }
      store.values.delete(operation.key as Key);
      return { value: undefined };
    }

    if (this.fake.consumeWriteFailure(operation.store)) {
      return { failure: new DOMException('Injected quota failure.', 'QuotaExceededError') };
    }
    const value = operation.value as Record<string, unknown>;
    const key = store.keyPath
      ? value[store.keyPath] as Key
      : operation.key as Key;
    if (key === undefined) {
      return { failure: new DOMException('A key is required.', 'DataError') };
    }
    if (operation.type === 'add' && store.values.has(key)) {
      return { failure: new DOMException('A record with this key exists.', 'ConstraintError') };
    }
    store.values.set(key, clone(value));
    return { value: key };
  }

  private scheduleComplete(): void {
    this.completionTimer = nextTask(() => {
      this.completionTimer = null;
      if (this.finished || this.aborted) {
        return;
      }
      if (this.mode === 'readwrite' && this.working) {
        this.state.stores = this.working;
      }
      this.finished = true;
      this.releaseTurn();
      this.oncomplete?.(event(this));
    });
  }

  private finishAbort(reason?: DOMException): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.error = reason ?? this.error ?? new DOMException('Aborted.', 'AbortError');
    this.aborted = true;
    for (const operation of this.operations) {
      operation.request.error = this.error;
      operation.request.onerror?.(event(operation.request));
    }
    this.operations.length = 0;
    this.releaseTurn();
    this.onabort?.(event(this));
  }
}

class FakeObjectStoreNames {
  constructor(private readonly names: () => string[]) {}

  contains(name: string): boolean {
    return this.names().includes(name);
  }

  get length(): number {
    return this.names().length;
  }

  item(index: number): string | null {
    return this.names()[index] ?? null;
  }

  [Symbol.iterator](): Iterator<string> {
    return this.names()[Symbol.iterator]();
  }
}

class FakeDatabase {
  readonly name: string;
  readonly version: number;
  readonly objectStoreNames: FakeObjectStoreNames;
  onversionchange: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  private readonly fake: FakeIndexedDb;
  private readonly state: DatabaseState;
  private closed = false;

  constructor(fake: FakeIndexedDb, name: string, state: DatabaseState) {
    this.fake = fake;
    this.name = name;
    this.state = state;
    this.version = state.version;
    this.objectStoreNames = new FakeObjectStoreNames(
      () => Array.from(state.stores.keys()),
    );
  }

  createObjectStore(
    name: string,
    options: { keyPath?: string } = {},
  ): FakeObjectStore {
    if (this.state.stores.has(name)) {
      throw new DOMException('Store already exists.', 'ConstraintError');
    }
    this.state.stores.set(name, {
      keyPath: options.keyPath,
      values: new Map(),
    });
    return new FakeObjectStore(name, {} as FakeTransaction);
  }

  transaction(names: string | string[], mode: IDBTransactionMode = 'readonly'): FakeTransaction {
    if (this.closed) {
      throw new DOMException('The database is closed.', 'InvalidStateError');
    }
    const list = Array.isArray(names) ? names : [names];
    for (const name of list) {
      if (!this.state.stores.has(name)) {
        throw new DOMException(`Unknown object store: ${name}`, 'NotFoundError');
      }
    }
    const { ready, release } = this.fake.enqueueTransaction();
    const transaction = new FakeTransaction(this.fake, this.state, mode, ready, release);
    this.fake.trackTransaction(this, transaction);
    return transaction;
  }

  close(): void {
    this.closed = true;
    this.fake.forgetConnection(this);
  }

  markVersionChange(): void {
    this.onversionchange?.(event(this));
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

class FakeOpenRequest extends FakeRequest {
  onupgradeneeded: ((event: Event) => void) | null = null;
  onblocked: ((event: Event) => void) | null = null;
}

export class FakeIndexedDb {
  private readonly databases = new Map<string, DatabaseState>();
  private readonly connections = new Map<string, Set<FakeDatabase>>();
  private readonly failures = new Map<string, number>();
  private tail: Promise<void> = Promise.resolve();
  readonly openCalls: string[] = [];
  readonly deleteCalls: string[] = [];
  readonly transactions: FakeTransaction[] = [];
  blockedOnce = false;

  open(name: string, version?: number): FakeOpenRequest {
    this.openCalls.push(name);
    const request = new FakeOpenRequest();
    const requested = version ?? 1;

    nextTask(() => {
      if (this.blockedOnce) {
        this.blockedOnce = false;
        request.onblocked?.(event(request));
        return;
      }
      const existing = this.databases.get(name);
      if (existing && requested < existing.version) {
        request.error = new DOMException('VersionError', 'VersionError');
        request.onerror?.(event(request));
        return;
      }
      let state = existing;
      if (!state) {
        state = { version: requested, stores: new Map() };
        this.databases.set(name, state);
      }
      const upgrade = !existing || requested > existing.version;
      if (upgrade) {
        for (const connection of this.connections.get(name) ?? []) {
          connection.markVersionChange();
        }
        state.version = requested;
      }
      const database = new FakeDatabase(this, name, state);
      (request as unknown as { result: FakeDatabase }).result = database;
      if (upgrade) {
        request.onupgradeneeded?.(event(request));
      }
      this.connections.set(name, this.connections.get(name) ?? new Set());
      this.connections.get(name)?.add(database);
      request.onsuccess?.(event(request));
    });

    return request;
  }

  deleteDatabase(name: string): FakeOpenRequest {
    this.deleteCalls.push(name);
    const request = new FakeOpenRequest();
    nextTask(() => {
      this.databases.delete(name);
      for (const connection of this.connections.get(name) ?? []) {
        connection.markVersionChange();
      }
      this.connections.delete(name);
      (request as unknown as { result: undefined }).result = undefined;
      request.onsuccess?.(event(request));
    });
    return request;
  }

  failNextWrite(store: string, count = 1): void {
    this.failures.set(store, (this.failures.get(store) ?? 0) + count);
  }

  consumeWriteFailure(store: string): boolean {
    const remaining = this.failures.get(store) ?? 0;
    if (remaining <= 0) {
      return false;
    }
    this.failures.set(store, remaining - 1);
    return true;
  }

  enqueueTransaction(): { ready: Promise<void>; release: () => void } {
    let release = (): void => {};
    const finished = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = this.tail;
    this.tail = this.tail.then(() => finished);
    return { ready, release };
  }

  trackTransaction(_database: FakeDatabase, transaction: FakeTransaction): void {
    this.transactions.push(transaction);
  }

  forgetConnection(database: FakeDatabase): void {
    this.connections.get(database.name)?.delete(database);
  }

  rawStore(databaseName: string, storeName: string): Map<Key, unknown> | null {
    const state = this.databases.get(databaseName);
    return state?.stores.get(storeName)?.values ?? null;
  }

  isClosed(databaseName: string): boolean {
    const connections = this.connections.get(databaseName);
    return !connections || connections.size === 0;
  }

  reset(): void {
    this.databases.clear();
    this.connections.clear();
    this.failures.clear();
    this.openCalls.length = 0;
    this.deleteCalls.length = 0;
    this.transactions.length = 0;
    this.blockedOnce = false;
    this.tail = Promise.resolve();
  }
}

export function installFakeIndexedDb(): FakeIndexedDb {
  const fake = new FakeIndexedDb();
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: fake as unknown as IDBFactory,
    writable: true,
  });
  return fake;
}
