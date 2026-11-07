import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lifted.app',
  appName: 'LIFTED',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#E0F2FE',
  },
  ios: {
    backgroundColor: '#E0F2FE',
  },
};

export default config;
