import {
  CHARACTER_LIBRARY_MAX_NAME_LENGTH,
  CharacterLibraryError,
  type CharacterKind,
  type CharacterSummary,
} from './types';
import type { AtlasProfile } from '../target-chatgpt/contract';

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function normalizeCharacterName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new CharacterLibraryError('invalid-name', '角色名称必须是字符串。');
  }
  const name = value.trim();
  const length = codePointLength(name);
  if (length < 1 || length > CHARACTER_LIBRARY_MAX_NAME_LENGTH) {
    throw new CharacterLibraryError(
      'invalid-name',
      `角色名称去除首尾空白后必须为 1–${CHARACTER_LIBRARY_MAX_NAME_LENGTH} 个字符。`,
    );
  }
  return name;
}

/** Defaults never come from File.name or a local path. */
export function defaultCharacterName(
  staticName: string | undefined,
  fallback: string,
): string {
  const trimmed = (staticName ?? '').trim();
  if (!trimmed) {
    return fallback;
  }
  return Array.from(trimmed).slice(0, CHARACTER_LIBRARY_MAX_NAME_LENGTH).join('');
}

export function characterIdFor(
  kind: CharacterKind,
  sha256: string,
  profile?: AtlasProfile,
): string {
  return kind === 'vrm'
    ? `vrm:${sha256}`
    : `sprite:${profile ?? 'unknown'}:${sha256}`;
}

export function compareCharacterSummaries(
  left: CharacterSummary,
  right: CharacterSummary,
): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}
