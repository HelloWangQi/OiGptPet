import type { MusicDanceStyle } from '../packages/character-core/music-choreography';

const storageKey = 'oigptpet.music-dance-style.v1';
const styles: readonly MusicDanceStyle[] = ['groove', 'idol-pop', 'catwalk'];

/** The dance choice is a local app preference, separate from character backups. */
export function readMusicDanceStylePreference(): MusicDanceStyle {
  try {
    const value = localStorage.getItem(storageKey);
    return styles.find(style => style === value) ?? 'groove';
  } catch {
    return 'groove';
  }
}

export function writeMusicDanceStylePreference(style: MusicDanceStyle): boolean {
  if (!styles.includes(style)) return false;
  try {
    localStorage.setItem(storageKey, style);
    return true;
  } catch {
    return false;
  }
}
