/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    openExternal: (url: string) => Promise<void>;
    getAppVersion: () => Promise<string>;
    platform: string;
    isDesktop: boolean;
  };
}
