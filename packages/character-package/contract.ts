import type { CharacterInput } from '../character-library';
import type { AtlasProfile } from '../target-chatgpt/contract';

/**
 * OIPET001 v1: 8-byte magic, 4-byte little-endian manifest length,
 * UTF-8 JSON manifest, then exactly one raw payload with no trailing bytes.
 */
export const CHARACTER_PACKAGE_MAGIC = 'OIPET001';
export const CHARACTER_PACKAGE_MAGIC_BYTES = 8;
export const CHARACTER_PACKAGE_HEADER_BYTES = 12;
export const CHARACTER_PACKAGE_FORMAT = 'oigptpet-character';
export const CHARACTER_PACKAGE_SCHEMA_VERSION = 1;

export const CHARACTER_PACKAGE_MAX_NAME_LENGTH = 80;
export const CHARACTER_PACKAGE_MAX_MANIFEST_BYTES = 65_536;
export const CHARACTER_PACKAGE_MAX_VRM_BYTES = 64 * 1024 * 1024;
export const CHARACTER_PACKAGE_MAX_SPRITE_BYTES = 20 * 1024 * 1024;
export const CHARACTER_PACKAGE_MAX_BYTES = (
  CHARACTER_PACKAGE_HEADER_BYTES
  + CHARACTER_PACKAGE_MAX_MANIFEST_BYTES
  + CHARACTER_PACKAGE_MAX_VRM_BYTES
);

export const CHARACTER_PACKAGE_VRM_MIME = 'model/gltf-binary';
export const CHARACTER_PACKAGE_SPRITE_MIMES = Object.freeze([
  'image/png',
  'image/webp',
] as const);

export type CharacterPackageKind = 'vrm' | 'sprite';
export type CharacterPackageSpriteMime = typeof CHARACTER_PACKAGE_SPRITE_MIMES[number];

export const VRM_MANIFEST_FIELD_ORDER = Object.freeze([
  'format',
  'schemaVersion',
  'name',
  'kind',
  'mime',
  'encodedBytes',
  'sha256',
] as const);

export const SPRITE_MANIFEST_FIELD_ORDER = Object.freeze([
  ...VRM_MANIFEST_FIELD_ORDER,
  'profile',
] as const);

export type CharacterPackageManifestField = typeof SPRITE_MANIFEST_FIELD_ORDER[number];

interface CharacterPackageManifestBase {
  format: typeof CHARACTER_PACKAGE_FORMAT;
  schemaVersion: typeof CHARACTER_PACKAGE_SCHEMA_VERSION;
  name: string;
  kind: CharacterPackageKind;
  mime: string;
  encodedBytes: number;
  sha256: string;
}

export interface VrmPackageManifest extends CharacterPackageManifestBase {
  kind: 'vrm';
  mime: typeof CHARACTER_PACKAGE_VRM_MIME;
}

export interface SpritePackageManifest extends CharacterPackageManifestBase {
  kind: 'sprite';
  mime: CharacterPackageSpriteMime;
  profile: AtlasProfile;
}

export type CharacterPackageManifest = VrmPackageManifest | SpritePackageManifest;

export interface CharacterPackageResult {
  blob: Blob;
  sha256: string;
  encodedBytes: number;
}

export interface DecodedCharacterPackage {
  input: CharacterInput;
  assetSha256: string;
  packageSha256: string;
  encodedBytes: number;
}

export type CharacterPackageErrorCode =
  | 'invalid-input'
  | 'invalid-container'
  | 'invalid-manifest'
  | 'unsupported-version'
  | 'invalid-name'
  | 'invalid-kind'
  | 'invalid-profile'
  | 'invalid-mime'
  | 'invalid-size'
  | 'too-large'
  | 'hash-mismatch';

export interface CharacterPackageErrorOptions {
  cause?: unknown;
}

export class CharacterPackageError extends Error {
  readonly code: CharacterPackageErrorCode;

  constructor(
    code: CharacterPackageErrorCode,
    message: string,
    options: CharacterPackageErrorOptions = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'CharacterPackageError';
    this.code = code;
  }
}

export function characterPackageLimitForKind(kind: CharacterPackageKind): number {
  return kind === 'vrm'
    ? CHARACTER_PACKAGE_MAX_VRM_BYTES
    : CHARACTER_PACKAGE_MAX_SPRITE_BYTES;
}

export const CHARACTER_PACKAGE_CONTRACT = Object.freeze({
  magic: CHARACTER_PACKAGE_MAGIC,
  schemaVersion: CHARACTER_PACKAGE_SCHEMA_VERSION,
  format: CHARACTER_PACKAGE_FORMAT,
  headerBytes: CHARACTER_PACKAGE_HEADER_BYTES,
  maxManifestBytes: CHARACTER_PACKAGE_MAX_MANIFEST_BYTES,
  maxNameLength: CHARACTER_PACKAGE_MAX_NAME_LENGTH,
  maxVrmBytes: CHARACTER_PACKAGE_MAX_VRM_BYTES,
  maxSpriteBytes: CHARACTER_PACKAGE_MAX_SPRITE_BYTES,
  maxPackageBytes: CHARACTER_PACKAGE_MAX_BYTES,
  vrmMime: CHARACTER_PACKAGE_VRM_MIME,
  spriteMimes: CHARACTER_PACKAGE_SPRITE_MIMES,
  vrmFieldOrder: VRM_MANIFEST_FIELD_ORDER,
  spriteFieldOrder: SPRITE_MANIFEST_FIELD_ORDER,
});
