/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in the Windows and Android builds: ask for a server address on the login screen. */
  readonly VITE_NATIVE?: string
  /** Server address pre-filled on the login screen of native builds. */
  readonly VITE_SERVER_URL?: string
}

/** Version from package.json, set by the release workflow. */
declare const __APP_VERSION__: string
