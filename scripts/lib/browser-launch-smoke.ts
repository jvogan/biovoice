import { chromium } from "playwright";
import type { TargetKind } from "../../packages/runtime-and-adapters/src/index.js";

export interface InteractiveBrowserSmokeResult {
  url: string;
  target: TargetKind;
  workflowTitle: string;
  successMessage: string;
  artifactLabel: string;
  disconnectBannerObserved: boolean;
}

const browserScenarioByTarget: Record<TargetKind, {
  workflowTitle: string;
  successMessage: string;
  artifactLabel: string;
  initialWorkflowTimeoutMs: number;
  successTimeoutMs: number;
}> = {
  pymol: {
    workflowTitle: "Surface and Presentation View",
    successMessage: "Finished Surface and Presentation View",
    artifactLabel: "PyMOL PNG export",
    initialWorkflowTimeoutMs: 60_000,
    successTimeoutMs: 300_000,
  },
  chimerax: {
    workflowTitle: "Ligand Interaction Explainer",
    successMessage: "Finished Ligand Interaction Explainer",
    artifactLabel: "ChimeraX PNG export",
    initialWorkflowTimeoutMs: 20_000,
    successTimeoutMs: 120_000,
  },
};

export async function runInteractiveBrowserSmoke(url: string, target: TargetKind): Promise<InteractiveBrowserSmokeResult> {
  const launchUrl = normalizeConsoleUrl(url, target);
  const scenario = browserScenarioByTarget[target];
  const browser = await launchBrowser();

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    });
    await context.grantPermissions(["microphone"], { origin: launchUrl.origin });
    const page = await context.newPage();

    await page.goto(launchUrl.toString(), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await waitForText(page, "BioVoice", 30_000);
    await waitForButtonEnabled(page.getByRole("button", { name: "Connect" }), 30_000);
    const workflowButton = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(scenario.workflowTitle)}\\b`) });
    await waitForButtonEnabled(workflowButton, scenario.initialWorkflowTimeoutMs);

    await page.getByRole("button", { name: "Connect" }).click();
    await waitForText(page, "Connected", 30_000);
    await waitForButtonDisabled(workflowButton, 15_000);

    await page.getByRole("button", { name: "Disconnect" }).click();
    await waitForText(page, "Offline", 15_000);

    let disconnectBannerObserved = false;
    const dismissError = page.getByRole("button", { name: "Dismiss error" });
    if (await dismissError.isVisible().catch(() => false)) {
      disconnectBannerObserved = true;
      await dismissError.click();
      await waitForRoleGone(page, "alert", 5_000);
    }

    await waitForButtonEnabled(workflowButton, 15_000);
    await workflowButton.click();
    await waitForText(page, scenario.successMessage, scenario.successTimeoutMs);
    await waitForText(page, scenario.artifactLabel, 15_000);
    await waitForButtonEnabled(workflowButton, 30_000);
    await ensureNoAlert(page);

    await context.close();
    return {
      url: launchUrl.toString(),
      target,
      workflowTitle: scenario.workflowTitle,
      successMessage: scenario.successMessage,
      artifactLabel: scenario.artifactLabel,
      disconnectBannerObserved,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

function normalizeConsoleUrl(rawUrl: string, target: TargetKind): URL {
  const url = new URL(rawUrl);
  url.searchParams.delete("widget");
  url.searchParams.delete("overlay");
  url.searchParams.set("target", target);
  return url;
}

async function launchBrowser() {
  const args = [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ];

  try {
    return await chromium.launch({
      channel: "chrome",
      headless: true,
      args,
    });
  } catch (error) {
    try {
      return await chromium.launch({
        headless: true,
        args,
      });
    } catch {
      throw new Error(
        `Unable to launch a browser for the local smoke test. Install Google Chrome or run 'npx playwright install chromium'. Original error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function waitForText(page: { getByText(text: string): { first(): { waitFor(options: { timeout: number }): Promise<void> } } }, text: string, timeout: number): Promise<void> {
  await page.getByText(text).first().waitFor({ timeout });
}

async function waitForButtonEnabled(locator: {
  waitFor(options: { state: "visible"; timeout: number }): Promise<void>;
  isDisabled(): Promise<boolean>;
}, timeout: number): Promise<void> {
  await locator.waitFor({ state: "visible", timeout });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!await locator.isDisabled()) {
      return;
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for the workflow button to become enabled.");
}

async function waitForButtonDisabled(locator: {
  waitFor(options: { state: "visible"; timeout: number }): Promise<void>;
  isDisabled(): Promise<boolean>;
}, timeout: number): Promise<void> {
  await locator.waitFor({ state: "visible", timeout });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await locator.isDisabled()) {
      return;
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for the workflow button to become disabled.");
}

async function waitForRoleGone(page: { getByRole(role: string): { waitFor(options: { state: "hidden"; timeout: number }): Promise<void> } }, role: string, timeout: number): Promise<void> {
  await page.getByRole(role).waitFor({ state: "hidden", timeout });
}

async function ensureNoAlert(page: { getByRole(role: string): { isVisible(): Promise<boolean> } }): Promise<void> {
  const alert = page.getByRole("alert");
  if (await alert.isVisible().catch(() => false)) {
    throw new Error("The operator console displayed an error banner during the browser smoke.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
