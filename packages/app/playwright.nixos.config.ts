import base from "./playwright.config"
// Fork tool (bishal-patches/scripts/app-e2e.sh): Playwright's bundled browsers cannot run on NixOS, so use
// the Chromium the script provides through nix shell.
export default {
  ...base,
  projects: (base.projects ?? []).map((project) => ({
    ...project,
    use: { ...project.use, launchOptions: { executablePath: process.env.CHROMIUM } },
  })),
}
