interface Window {
  petDesktop?: {
    getModel(): Promise<Uint8Array | null>;
    setModel(bytes: Uint8Array): Promise<boolean>;
    openPet(): Promise<void>;
    openWorkshop(): Promise<void>;
    hidePet(): Promise<void>;
    setClickThrough(value: boolean): Promise<void>;
    setScale(value: number): Promise<void>;
    saveAtlas(bytes: Uint8Array, profile: 'v1' | 'v2'): Promise<string | null>;
    onModelChanged(callback: () => void): () => void;
    onInteractionRestored(callback: () => void): () => void;
  };
}
