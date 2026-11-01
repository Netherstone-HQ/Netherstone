/// <reference types="vite/client" />

/** The app version from package.json, e.g. "0.2.0" or "0.2.0-beta.1". */
declare const __APP_VERSION__: string;

/** False in builds for package managers, which update the app themselves. */
declare const __SELF_UPDATE__: boolean;
