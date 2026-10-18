import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ru.family.buh',
  appName: 'Семейный бюджет',
  webDir: 'dist-native',
  android: {
    // Lets the app talk to a server on plain http (e.g. inside the home network).
    allowMixedContent: true,
  },
  plugins: {
    // Native HTTP: no CORS or mixed-content limits when the server uses plain http.
    CapacitorHttp: { enabled: true },
  },
}

export default config
