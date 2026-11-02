import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CHARACTER_PACKAGE_HEADER_BYTES,
  CHARACTER_PACKAGE_MAGIC,
  CHARACTER_PACKAGE_MAX_BYTES,
  CHARACTER_PACKAGE_MAX_MANIFEST_BYTES,
  CHARACTER_PACKAGE_MAX_NAME_LENGTH,
  CHARACTER_PACKAGE_MAX_SPRITE_BYTES,
  CHARACTER_PACKAGE_MAX_VRM_BYTES,
  CHARACTER_PACKAGE_SPRITE_MIMES,
  CHARACTER_PACKAGE_VRM_MIME,
  CharacterPackageError,
  SPRITE_MANIFEST_FIELD_ORDER,
  VRM_MANIFEST_FIELD_ORDER,
  decodeCharacterPackage,
  encodeCharacterPackage,
} from '../packages/character-package/index';
import type { CharacterAsset, CharacterSummary } from '../packages/character-library';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let vrmBytes: Uint8Array<ArrayBuffer>;
let pngBytes: Uint8Array<ArrayBuffer>;

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function expectBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.byteLength).toBe(expected.byteLength);
  expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true);
}

function copied(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

function blobOf(bytes: Uint8Array, type = ''): Blob {
  return new Blob([copied(bytes)], { type });
}

async function makeAsset(
  blob: Blob,
  kind: 'vrm' | 'sprite',
  name: string,
  options: {
    profile?: 'v1' | 'v2' | null;
    sha256?: string;
    encodedBytes?: number;
  } = {},
): Promise<CharacterAsset> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const summary = {
    id: 'package-test-entry',
    kind,
    name,
    sha256: options.sha256 ?? digest(bytes),
    encodedBytes: options.encodedBytes ?? blob.size,
    createdAt: '2026-10-23T00:00:00.000Z',
    ...(options.profile === undefined ? (kind === 'sprite' ? { profile: 'v2' } : {})
      : options.profile === null ? {} : { profile: options.profile }),
  } as CharacterSummary;
  return { summary, blob };
}

function manifestFor(
  payload: Uint8Array,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    format: 'oigptpet-character',
    schemaVersion: 1,
    name: '测试角色',
    kind: 'vrm',
    mime: CHARACTER_PACKAGE_VRM_MIME,
    encodedBytes: payload.byteLength,
    sha256: digest(payload),
    ...overrides,
  };
}

function rawContainer(
  manifestBytes: Uint8Array,
  payload: Uint8Array,
  options: {
    magic?: Uint8Array;
    statedManifestLength?: number;
    trailingBytes?: Uint8Array;
  } = {},
): Blob {
  const magic = options.magic ?? encoder.encode(CHARACTER_PACKAGE_MAGIC);
  const trailing = options.trailingBytes ?? new Uint8Array();
  const bytes = new Uint8Array(
    CHARACTER_PACKAGE_HEADER_BYTES + manifestBytes.byteLength + payload.byteLength + trailing.byteLength,
  );
  bytes.set(magic.subarray(0, 8), 0);
  new DataView(bytes.buffer).setUint32(
    8,
    options.statedManifestLength ?? manifestBytes.byteLength,
    true,
  );
  bytes.set(manifestBytes, CHARACTER_PACKAGE_HEADER_BYTES);
  bytes.set(payload, CHARACTER_PACKAGE_HEADER_BYTES + manifestBytes.byteLength);
  bytes.set(trailing, bytes.byteLength - trailing.byteLength);
  return blobOf(bytes);
}

function containerFrom(
  manifest: unknown,
  payload: Uint8Array,
  options: { manifestBytes?: Uint8Array; trailingBytes?: Uint8Array } = {},
): Blob {
  return rawContainer(
    options.manifestBytes ?? encoder.encode(JSON.stringify(manifest)),
    payload,
    options,
  );
}

function fakeBlob(size: number, prefix = new Uint8Array()): Blob {
  return {
    size,
    type: 'image/png',
    arrayBuffer: async () => {
      throw new Error('full payload must not be read before the size gate');
    },
    slice: (start: number, end: number) => new Blob([
      prefix.slice(start, Math.min(end, prefix.byteLength)),
    ]),
  } as unknown as Blob;
}

async function expectCode(
  promise: Promise<unknown>,
  code: CharacterPackageError['code'],
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: 'CharacterPackageError',
    code,
  });
}

beforeAll(async () => {
  vrmBytes = copied(new Uint8Array(await readFile('public/models/demo.vrm')));
  pngBytes = copied(new Uint8Array(await readFile('artifacts/animation-fixes/run-04/atlas-v1.png')));
});

describe('header, manifest and payload contract', () => {
  it('encodes a real VRM with fixed header, field order and actual digests', async () => {
    const asset = await makeAsset(blobOf(vrmBytes, 'application/octet-stream'), 'vrm', ' 真实 VRM 角色 ');
    const result = await encodeCharacterPackage(asset);
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(result.encodedBytes).toBe(bytes.byteLength);
    expect(result.sha256).toBe(digest(bytes));
    expect(result.blob.size).toBe(bytes.byteLength);

    expect(decoder.decode(bytes.subarray(0, 8))).toBe(CHARACTER_PACKAGE_MAGIC);
    const manifestLength = new DataView(bytes.buffer).getUint32(8, true);
    const manifest = JSON.parse(
      decoder.decode(bytes.subarray(12, 12 + manifestLength)),
    ) as Record<string, unknown>;
    expect(Object.keys(manifest)).toEqual([...VRM_MANIFEST_FIELD_ORDER]);
    expect(manifest).toMatchObject({
      format: 'oigptpet-character',
      schemaVersion: 1,
      name: '真实 VRM 角色',
      kind: 'vrm',
      mime: CHARACTER_PACKAGE_VRM_MIME,
      encodedBytes: vrmBytes.byteLength,
      sha256: digest(vrmBytes),
    });
    expect(manifest.profile).toBeUndefined();
    expectBytes(bytes.slice(12 + manifestLength), vrmBytes);

    const decoded = await decodeCharacterPackage(result.blob);
    expect(decoded.input.kind).toBe('vrm');
    expect(decoded.input.name).toBe('真实 VRM 角色');
    expect(decoded.input.blob.type).toBe(CHARACTER_PACKAGE_VRM_MIME);
    expectBytes(new Uint8Array(await decoded.input.blob.arrayBuffer()), vrmBytes);
    expect(decoded.assetSha256).toBe(digest(vrmBytes));
    expect(decoded.packageSha256).toBe(result.sha256);
    expect(decoded.encodedBytes).toBe(result.encodedBytes);
  });

  it('round-trips real PNG bytes for both sprite profiles without re-encoding', async () => {
    for (const profile of ['v1', 'v2'] as const) {
      const asset = await makeAsset(blobOf(pngBytes, 'image/png'), 'sprite', `图集 ${profile}`, { profile });
      const result = await encodeCharacterPackage(asset);
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      const manifestLength = new DataView(bytes.buffer).getUint32(8, true);
      const manifest = JSON.parse(decoder.decode(bytes.subarray(12, 12 + manifestLength)));
      expect(Object.keys(manifest)).toEqual([...SPRITE_MANIFEST_FIELD_ORDER]);
      expect(manifest.profile).toBe(profile);
      expect(manifest.mime).toBe('image/png');

      const decoded = await decodeCharacterPackage(result.blob);
      expect(decoded.input).toMatchObject({ kind: 'sprite', profile, name: `图集 ${profile}` });
      expect(decoded.input.blob.type).toBe('image/png');
      expectBytes(new Uint8Array(await decoded.input.blob.arrayBuffer()), pngBytes);
      expect(decoded.assetSha256).toBe(digest(pngBytes));
    }
  });

  it('normalizes the VRM and sprite MIME in the manifest while preserving bytes', async () => {
    const vrm = await makeAsset(blobOf(vrmBytes, 'application/octet-stream'), 'vrm', 'MIME VRM');
    const vrmResult = await encodeCharacterPackage(vrm);
    const vrmBytesInPackage = new Uint8Array(await vrmResult.blob.arrayBuffer());
    const vrmManifestLength = new DataView(vrmBytesInPackage.buffer).getUint32(8, true);
    const vrmManifest = JSON.parse(decoder.decode(vrmBytesInPackage.subarray(12, 12 + vrmManifestLength)));
    expect(vrmManifest.mime).toBe(CHARACTER_PACKAGE_VRM_MIME);
    expectBytes(vrmBytesInPackage.slice(12 + vrmManifestLength), vrmBytes);

    const sprite = await makeAsset(blobOf(pngBytes, 'image/PNG; charset=binary'), 'sprite', 'MIME 图集', { profile: 'v1' });
    const spriteResult = await encodeCharacterPackage(sprite);
    const spriteBytes = new Uint8Array(await spriteResult.blob.arrayBuffer());
    const spriteManifestLength = new DataView(spriteBytes.buffer).getUint32(8, true);
    const spriteManifest = JSON.parse(decoder.decode(spriteBytes.subarray(12, 12 + spriteManifestLength)));
    expect(spriteManifest.mime).toBe('image/png');
    expect((await decodeCharacterPackage(spriteResult.blob)).input).toMatchObject({
      kind: 'sprite',
      profile: 'v1',
    });
  });

  it('enforces the name rule with code points and trims the stored name', async () => {
    const asset = await makeAsset(blobOf(vrmBytes), 'vrm', '  😀  '.repeat(0) + ' 名字 ');
    const result = await encodeCharacterPackage(asset);
    expect((await decodeCharacterPackage(result.blob)).input.name).toBe('名字');

    const maxName = '😀'.repeat(CHARACTER_PACKAGE_MAX_NAME_LENGTH);
    const maxAsset = await makeAsset(blobOf(vrmBytes), 'vrm', maxName);
    expect((await decodeCharacterPackage((await encodeCharacterPackage(maxAsset)).blob)).input.name)
      .toBe(maxName);

    const tooLong = await makeAsset(blobOf(vrmBytes), 'vrm', '😀'.repeat(CHARACTER_PACKAGE_MAX_NAME_LENGTH + 1));
    await expectCode(encodeCharacterPackage(tooLong), 'invalid-name');
    const blank = await makeAsset(blobOf(vrmBytes), 'vrm', '   ');
    await expectCode(encodeCharacterPackage(blank), 'invalid-name');
    const wrongType = { ...blank, summary: { ...blank.summary, name: 7 as unknown as string } };
    await expectCode(encodeCharacterPackage(wrongType), 'invalid-name');
  });

  it('reports the full container size separately from the payload size', async () => {
    const asset = await makeAsset(blobOf(pngBytes, 'image/png'), 'sprite', '大小', { profile: 'v2' });
    const result = await encodeCharacterPackage(asset);
    expect(result.encodedBytes).toBeGreaterThan(pngBytes.byteLength);
    const decoded = await decodeCharacterPackage(result.blob);
    expect(decoded.encodedBytes).toBe(result.encodedBytes);
    expect(decoded.input.blob.size).toBe(pngBytes.byteLength);
  });
});

describe('encode validation', () => {
  it('rejects summary, MIME, profile and size contradictions', async () => {
    const vrm = await makeAsset(blobOf(vrmBytes), 'vrm', 'VRM');
    const wrongHash = { ...vrm, summary: { ...vrm.summary, sha256: '0'.repeat(64) } };
    await expectCode(encodeCharacterPackage(wrongHash), 'hash-mismatch');

    const wrongSize = { ...vrm, summary: { ...vrm.summary, encodedBytes: vrm.blob.size + 1 } };
    await expectCode(encodeCharacterPackage(wrongSize), 'invalid-size');

    const sprite = await makeAsset(blobOf(pngBytes, 'image/png'), 'sprite', '图集', { profile: 'v1' });
    const missingProfile = { ...sprite, summary: { ...sprite.summary, profile: undefined } };
    await expectCode(encodeCharacterPackage(missingProfile), 'invalid-profile');
    const wrongProfile = { ...sprite, summary: { ...sprite.summary, profile: 'v3' as unknown as 'v1' } };
    await expectCode(encodeCharacterPackage(wrongProfile), 'invalid-profile');
    const vrmProfile = { ...vrm, summary: { ...vrm.summary, profile: 'v2' as const } };
    await expectCode(encodeCharacterPackage(vrmProfile), 'invalid-profile');

    const gif = await makeAsset(blobOf(pngBytes, 'image/gif'), 'sprite', 'GIF', { profile: 'v1' });
    await expectCode(encodeCharacterPackage(gif), 'invalid-mime');
    const wrongKind = { ...vrm, summary: { ...vrm.summary, kind: 'audio' as unknown as 'vrm' } };
    await expectCode(encodeCharacterPackage(wrongKind), 'invalid-kind');
    const empty = await makeAsset(blobOf(new Uint8Array()), 'vrm', '空文件');
    await expectCode(encodeCharacterPackage(empty), 'invalid-size');
  });

  it('rejects oversized files before reading their payload', async () => {
    const spriteBlob = fakeBlob(CHARACTER_PACKAGE_MAX_SPRITE_BYTES + 1);
    const sprite = {
      summary: {
        id: 'too-large-sprite',
        kind: 'sprite' as const,
        name: '超限图集',
        sha256: '0'.repeat(64),
        encodedBytes: spriteBlob.size,
        createdAt: '2026-10-23T00:00:00.000Z',
        profile: 'v1' as const,
      },
      blob: spriteBlob,
    };
    await expectCode(encodeCharacterPackage(sprite), 'too-large');

    const vrmBlob = fakeBlob(CHARACTER_PACKAGE_MAX_VRM_BYTES + 1);
    const vrm = {
      summary: {
        id: 'too-large-vrm',
        kind: 'vrm' as const,
        name: '超限 VRM',
        sha256: '0'.repeat(64),
        encodedBytes: vrmBlob.size,
        createdAt: '2026-10-23T00:00:00.000Z',
      },
      blob: vrmBlob,
    };
    await expectCode(encodeCharacterPackage(vrm), 'too-large');
  });

  it('honors AbortSignal before and during encoding', async () => {
    const asset = await makeAsset(blobOf(vrmBytes), 'vrm', '取消');
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(encodeCharacterPackage(asset, preAborted.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });

    const controller = new AbortController();
    const pending = encodeCharacterPackage(asset, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('decode validation', () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5]);

  it('decodes a container and reports independent payload and package digests', async () => {
    const manifest = manifestFor(payload);
    const blob = containerFrom(manifest, payload);
    const decoded = await decodeCharacterPackage(blob);
    expect(decoded.input.kind).toBe('vrm');
    expect(decoded.input.name).toBe('测试角色');
    expectBytes(new Uint8Array(await decoded.input.blob.arrayBuffer()), payload);
    expect(decoded.assetSha256).toBe(digest(payload));
    const packageBytes = new Uint8Array(await blob.arrayBuffer());
    expect(decoded.packageSha256).toBe(digest(packageBytes));
    expect(decoded.encodedBytes).toBe(packageBytes.byteLength);
  });

  it.each([
    ['short header', blobOf(new Uint8Array(5))],
    ['bad magic', containerFrom(manifestFor(payload), payload, {
      manifestBytes: encoder.encode(JSON.stringify(manifestFor(payload))),
    })],
    ['zero manifest length', rawContainer(encoder.encode('{}'), payload, { statedManifestLength: 0 })],
    ['manifest too long', rawContainer(encoder.encode('{}'), payload, {
      statedManifestLength: CHARACTER_PACKAGE_MAX_MANIFEST_BYTES + 1,
    })],
  ])('rejects %s', async (_label, blob) => {
    if (_label === 'bad magic') {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      bytes.set(encoder.encode('BADMAGIC'), 0);
      await expectCode(decodeCharacterPackage(blobOf(bytes)), 'invalid-container');
      return;
    }
    if (_label === 'short header') {
      await expectCode(decodeCharacterPackage(blob), 'invalid-container');
      return;
    }
    await expectCode(decodeCharacterPackage(blob), 'invalid-container');
  });

  it('rejects invalid UTF-8, invalid JSON and non-object manifests', async () => {
    await expectCode(decodeCharacterPackage(rawContainer(new Uint8Array([0xff]), payload)), 'invalid-manifest');
    await expectCode(decodeCharacterPackage(containerFrom(null, payload, {
      manifestBytes: encoder.encode('{'),
    })), 'invalid-manifest');
    await expectCode(decodeCharacterPackage(containerFrom([], payload)), 'invalid-manifest');
  });

  it('rejects unsupported versions, unknown fields and invalid names', async () => {
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload, { schemaVersion: 2 }), payload)), 'unsupported-version');
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload, { schemaVersion: '1' }), payload)), 'invalid-manifest');
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload, { extra: true }), payload)), 'invalid-manifest');
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload, { name: '' }), payload)), 'invalid-name');
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload, { name: 'x'.repeat(81) }), payload)), 'invalid-name');
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload, { name: 3 }), payload)), 'invalid-name');
  });

  it('rejects kind, profile and MIME contradictions', async () => {
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload, { kind: 'audio' }), payload)), 'invalid-kind');
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload, {
      kind: 'vrm', profile: 'v1',
    }), payload)), 'invalid-profile');
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload, {
      kind: 'sprite', mime: 'image/png',
    }), payload)), 'invalid-profile');
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload, {
      kind: 'sprite', mime: 'image/png', profile: 'v3',
    }), payload)), 'invalid-profile');
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload, { mime: 'image/png' }), payload)), 'invalid-mime');
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload, {
      kind: 'sprite', mime: 'image/gif', profile: 'v1',
    }), payload)), 'invalid-mime');
  });

  it('rejects invalid encoded sizes, truncation, trailing bytes and hash mismatches', async () => {
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload, { encodedBytes: 0 }), payload)), 'invalid-size');
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload, { encodedBytes: 99 }), payload)), 'invalid-container');
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload), payload, {
      trailingBytes: new Uint8Array([9]),
    })), 'invalid-container');

    const valid = containerFrom(manifestFor(payload), payload);
    const validBytes = new Uint8Array(await valid.arrayBuffer());
    await expectCode(decodeCharacterPackage(blobOf(validBytes.subarray(0, validBytes.byteLength - 1))), 'invalid-container');
    await expectCode(decodeCharacterPackage(containerFrom(manifestFor(payload, {
      sha256: '0'.repeat(64),
    }), payload)), 'hash-mismatch');
  });

  it('enforces the kind payload limit before reading the full Blob', async () => {
    const spritePayloadSize = CHARACTER_PACKAGE_MAX_SPRITE_BYTES + 1;
    const manifest = manifestFor(payload, {
      kind: 'sprite',
      mime: 'image/png',
      profile: 'v2',
      encodedBytes: spritePayloadSize,
    });
    const manifestBytes = encoder.encode(JSON.stringify(manifest));
    const prefix = new Uint8Array(CHARACTER_PACKAGE_HEADER_BYTES + manifestBytes.byteLength);
    prefix.set(encoder.encode(CHARACTER_PACKAGE_MAGIC), 0);
    new DataView(prefix.buffer).setUint32(8, manifestBytes.byteLength, true);
    prefix.set(manifestBytes, CHARACTER_PACKAGE_HEADER_BYTES);
    const fake = fakeBlob(prefix.byteLength + spritePayloadSize, prefix);
    await expectCode(decodeCharacterPackage(fake), 'too-large');
  });

  it('rejects a package larger than the absolute maximum before reading', async () => {
    const fake = fakeBlob(CHARACTER_PACKAGE_MAX_BYTES + 1);
    await expectCode(decodeCharacterPackage(fake), 'too-large');
  });

  it('honors AbortSignal before and during decoding', async () => {
    const blob = containerFrom(manifestFor(payload), payload);
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(decodeCharacterPackage(blob, preAborted.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });

    const controller = new AbortController();
    const pending = decodeCharacterPackage(blob, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('contract constants', () => {
  it('exposes the v1 boundaries and fixed field order', () => {
    expect(CHARACTER_PACKAGE_MAGIC).toBe('OIPET001');
    expect(CHARACTER_PACKAGE_HEADER_BYTES).toBe(12);
    expect(CHARACTER_PACKAGE_MAX_MANIFEST_BYTES).toBe(65_536);
    expect(CHARACTER_PACKAGE_MAX_VRM_BYTES).toBe(64 * 1024 * 1024);
    expect(CHARACTER_PACKAGE_MAX_SPRITE_BYTES).toBe(20 * 1024 * 1024);
    expect(CHARACTER_PACKAGE_MAX_BYTES).toBe(12 + 65_536 + 64 * 1024 * 1024);
    expect([...CHARACTER_PACKAGE_SPRITE_MIMES]).toEqual(['image/png', 'image/webp']);
    expect([...VRM_MANIFEST_FIELD_ORDER]).toEqual([
      'format', 'schemaVersion', 'name', 'kind', 'mime', 'encodedBytes', 'sha256',
    ]);
    expect([...SPRITE_MANIFEST_FIELD_ORDER]).toEqual([
      'format', 'schemaVersion', 'name', 'kind', 'mime', 'encodedBytes', 'sha256', 'profile',
    ]);
  });
});
