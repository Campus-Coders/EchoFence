import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    headless: true,
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-web-security",
      ],
    },
    trace: "off",
  },
  webServer: {
    command: "cmd.exe /c npx next dev -p 3000",
    port: 3000,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
