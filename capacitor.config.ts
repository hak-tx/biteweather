import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.haktx.biteweather",
  appName: "BiteWeather",
  webDir: "dist/public",
  server: {
    url: "https://biteweather.vercel.app",
    cleartext: false,
  },
  ios: {
    scheme: "BiteWeather",
  },
};

export default config;
