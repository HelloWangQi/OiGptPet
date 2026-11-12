declare const __WITH_DEMO__: boolean;
declare const __APP_VERSION__: string;
interface PetToolsLayout { open: boolean; petWidth: number; petLeft: number; toolsLeft: number; toolsWidth: number }
interface CompanionChatState { status: string; text?: string; requestId?: string; sequence: number }
interface ChatReadiness { ready: boolean; code: 'ready' | 'missing_model' | 'invalid_model' | 'missing_key' | 'unavailable' | 'unreadable_key' | 'busy' | 'timeout' | 'cancelled' }
interface CompanionChatSnapshot {
  sequence: number;
  state: CompanionChatState;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  attempt: { requestId: string; text: string; status: string; partial: string; error?: string } | null;
}

interface Window {
  petDesktop?: {
    getChatSettings(): Promise<{ model: string; hasKey: boolean; encryptionAvailable: boolean }>;
    checkChatSettings(): Promise<ChatReadiness>;
    getChatSnapshot(): Promise<CompanionChatSnapshot>;
    getChatState(): Promise<CompanionChatState>;
    saveChatSettings(value: { model: string; apiKey?: string; forgetKey?: boolean }): Promise<{ model: string; hasKey: boolean; encryptionAvailable: boolean }>;
    sendChat(text: string, requestId?: string): Promise<{ text?: string; error?: string; cancelled?: boolean }>;
    sendPetMessage(text: string, requestId?: string): Promise<{ text?: string; error?: string; cancelled?: boolean }>;
    cancelChat(): Promise<void>;
    clearChat(): Promise<void>;
    onChatState(callback: (state: CompanionChatState) => void): () => void;
    saveDiagnostics(): Promise<boolean>;
    reportRenderSample(value: import('./render-monitor').RenderSample): Promise<void>;
    getWindowVisibility(): Promise<boolean>;
    onWindowVisibility(callback: (visible: boolean) => void): () => void;
    getModel(): Promise<Uint8Array | null>;
    setModel(bytes: Uint8Array): Promise<boolean>;
    openPet(): Promise<void>;
    openWorkshop(): Promise<void>;
    hidePet(): Promise<void>;
    quit(): Promise<void>;
    startDrag(): Promise<boolean>;
    endDrag(): Promise<void>;
    setClickThrough(value: boolean): Promise<void>;
    setScale(value: number): Promise<void>;
    setToolsOpen(value: boolean): Promise<PetToolsLayout>;
    onToolsLayout(callback: (layout: PetToolsLayout) => void): () => void;
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
