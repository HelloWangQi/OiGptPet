declare const __WITH_DEMO__: boolean;

interface Window {
  petDesktop?: {
    getModel(): Promise<Uint8Array | null>;
    setModel(bytes: Uint8Array): Promise<boolean>;
    openPet(): Promise<void>;
    openWorkshop(): Promise<void>;
    hidePet(): Promise<void>;
    setClickThrough(value: boolean): Promise<void>;
    setScale(value: number): Promise<void>;
    getPreferences(): Promise<import('./desktop-preferences').DesktopPreferences>;
    setPreferences(patch: import('./desktop-preferences').PreferencesPatch): Promise<import('./desktop-preferences').DesktopPreferences>;
    onPreferencesChanged(callback: (preferences: import('./desktop-preferences').DesktopPreferences) => void): () => void;
    saveAtlas(bytes: Uint8Array, profile: 'v1' | 'v2', sha256: string): Promise<string | null>;
    saveReport(json: string): Promise<string | null>;
    saveCharacterPackage(bytes: Uint8Array, sha256: string, operationId: string): Promise<string | null>;
    cancelCharacterPackage(operationId: string): Promise<boolean>;
    onModelChanged(callback: () => void): () => void;
    onInteractionRestored(callback: () => void): () => void;
  };
}
