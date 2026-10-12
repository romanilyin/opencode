import { expect, sourceURL, story } from "../../storybook/playwright/story"

const fixture = sourceURL(new URL("./tool-presentation.fixture.tsx", import.meta.url))

story(
  "shows direct lifecycle presentation, plain text fallback and canonical errors",
  async ({ mount, page }, testInfo) => {
    await mount("components-markdown--compact-result")
    await page.evaluate(async (fixture) => {
      const { mountToolPresentation } = await import(fixture)
      mountToolPresentation()
    }, fixture)
    const root = page.getByTestId("tool-presentation-fixture")
    const direct = root.getByTestId("direct")
    await expect(direct.getByText("Reading records", { exact: true })).toBeVisible()
    await expect(direct.getByText("Reading shard 2", { exact: true })).toBeVisible()
    await expect(direct.getByRole("progressbar", { name: "Tool progress" })).toHaveAttribute("aria-valuenow", "2")
    await expect(direct.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "5")
    await expect(direct.locator("img")).toHaveAttribute("alt", "")
    await expect(root.getByTestId("count-only").getByRole("progressbar")).toHaveCount(0)
    await expect(root.getByTestId("count-only").locator('[data-slot="tool-presentation-progress"]')).toHaveText("8")
    await expect(
      root.getByTestId("count-only").locator('[data-slot="tool-presentation-progress"]'),
    ).not.toHaveAttribute("aria-valuenow")
    await expect(root.getByTestId("completed").getByText("5 records loaded", { exact: true })).toBeVisible()
    const failed = root.getByTestId("failed")
    await expect(failed.locator('[data-component="tool-error-card-icon"]')).toBeVisible()
    await expect(failed.getByText("Lookup failed", { exact: true })).toBeVisible()
    await failed.getByRole("button", { name: /Lookup failed/ }).click()
    await expect(failed.getByText("permission_denied: Original canonical error", { exact: true })).toBeVisible()
    await expect(root.getByTestId("group").getByRole("button", { name: /Grouped records/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    await expect(root.getByTestId("group").locator("img").first()).toBeVisible()
    await root.screenshot({
      path: process.env.OPENCODE_PRESENTATION_SCREENSHOT ?? testInfo.outputPath("tool-presentation.png"),
    })

    await root.getByRole("button", { name: "Complete direct call", exact: true }).click()
    await expect(direct.getByText("Records loaded", { exact: true })).toBeVisible()
    await expect(direct.getByRole("progressbar")).toHaveCount(0)
    await direct.getByRole("button", { name: /Records loaded/ }).click()
    await expect(direct.getByText("Canonical direct output", { exact: true })).toBeVisible()
    await root.getByRole("button", { name: "Malformed direct metadata", exact: true }).click()
    await expect(direct.getByText("Called `acme.lookup`", { exact: true })).toBeVisible()
    await expect(direct.locator("img")).toHaveCount(0)
    await root.getByRole("button", { name: "Plain text direct label", exact: true }).click()
    await expect(direct.getByText("<b>Plain label</b>", { exact: true })).toBeVisible()
    await expect(direct.locator("b")).toHaveCount(0)
  },
)

story("keeps repeated nested invocations distinct and keyed through reverse completion", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => {
    const { mountToolPresentation } = await import(fixture)
    mountToolPresentation()
  }, fixture)
  const root = page.getByTestId("tool-presentation-fixture")
  const calls = root.getByTestId("execute").locator('[data-component="execute-tool-calls"]')
  const first = calls.locator('[data-tool-call-id="first"]')
  const second = calls.locator('[data-tool-call-id="second"]')
  await expect(first.getByText("First lookup", { exact: true })).toBeVisible()
  await expect(second.getByText("Second lookup", { exact: true })).toBeVisible()
  await first.evaluate((element) => element.setAttribute("data-retained-node", "first"))
  await second.evaluate((element) => element.setAttribute("data-retained-node", "second"))
  await root.getByRole("button", { name: "Complete second first", exact: true }).click()
  await expect(calls.getByRole("listitem")).toHaveCount(2)
  await expect(first).toHaveAttribute("data-retained-node", "first")
  await expect(second).toHaveAttribute("data-retained-node", "second")
  await expect(first).toHaveAttribute("data-status", "running")
  await expect(first.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2")
  await expect(second).toHaveAttribute("data-status", "error")
  await expect(second.getByText("Failed", { exact: true })).toBeVisible()
  await expect(second.getByText("Claims completed", { exact: true })).toBeVisible()
  await expect(second.getByText("acme.lookup", { exact: true })).toBeVisible()
})
