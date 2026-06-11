#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { ensureDir, writeJson } from "fs-extra/esm";
import { execa } from "execa";
import { loadConfig } from "../config/loadConfig.js";
import { providerFor } from "../providers/index.js";
import { reviewerFor } from "../reviewers/index.js";
import { emptyState, isReusableReview, loadState, reviewKey, saveState } from "../state/reviewState.js";
import type { PullRequestReview, RepositoryConfig, RevisaurConfig } from "../types/revisaur.js";

type SiteRepository = Pick<RepositoryConfig, "id" | "name" | "owner" | "provider" | "repo" | "url">;

const program = new Command();
const dataDirEnvKey = "REVISAUR_DATA_DIR";
const logIcon = {
    cache: "💾",
    complete: "✅",
    error: "❌",
    info: "ℹ️",
    review: "🔍",
    search: "📋",
};
const outputDirEnvKey = "REVISAUR_OUTPUT_DIR";
const workspaceEnvKey = "REVISAUR_WORKSPACE";

program
    .name("revisaur")
    .description("Generate an Astro website containing AI reviews for recent pull requests.")
    .version("0.1.0");

program
    .command("generate")
    .description("Fetch pull requests, run missing reviews, and build the static site.")
    .option("-c, --config <path>", "Path to revisaur TOML config", "revisaur.toml")
    .option("--skip-build", "Only write review data, do not run astro build")
    .action(async (options: { config: string; skipBuild?: boolean }) => {
        const workspace = process.cwd();
        const config = await loadConfig(path.resolve(workspace, options.config));
        await generate(config, Boolean(options.skipBuild), workspace);
    });

program
    .command("demo")
    .description("Generate fake review data and build the static demo site.")
    .option("--data-dir <path>", "Directory for generated review data", ".revisaur/data")
    .option("-o, --output-dir <path>", "Directory for the built static site", "site-dist")
    .option("--skip-build", "Only write demo review data, do not run astro build")
    .action(async (options: { dataDir: string; outputDir: string; skipBuild?: boolean }) => {
        const workspace = process.cwd();
        await demo(options.dataDir, options.outputDir, Boolean(options.skipBuild), workspace);
    });

await program.parseAsync();

async function generate(config: RevisaurConfig, skipBuild: boolean, workspace: string): Promise<void> {
    const dataDir = path.resolve(workspace, config.dataDir);
    const outputDir = path.resolve(workspace, config.outputDir);
    await ensureDir(dataDir);
    const statePath = path.join(dataDir, "state.json");
    const state = await loadState(statePath);
    const reviewer = reviewerFor(config.reviewer);
    // Tracks the current run's site payload while state.reviews remains the full cache.
    const reviewKeys: string[] = [];
    let cachedReviews = 0;
    let completedReviews = 0;
    let failedReviews = 0;

    console.log(
        `${logIcon.cache} Loaded review cache from ${statePath} with ${Object.keys(state.reviews).length.toString()} entries.`,
    );

    for (const repo of config.repositories) {
        const provider = providerFor(repo);
        const pullRequests = await provider.listRecentlyUpdatedPullRequests(repo);
        console.log(`${logIcon.search} Found ${pullRequests.length.toString()} pull requests for ${repo.name}.`);

        for (const pullRequest of pullRequests) {
            const key = reviewKey(pullRequest);
            const label = `${repo.name} PR #${pullRequest.number.toString()}`;
            reviewKeys.push(key);

            if (isReusableReview(state.reviews[key])) {
                cachedReviews += 1;
                console.log(
                    `${logIcon.cache} Using cached review for ${label} at ${pullRequest.headSha.slice(0, 8)} (${state.reviews[key].status}).`,
                );
                continue;
            }

            console.log(
                `${logIcon.info} No successful cached review for ${label} at ${pullRequest.headSha.slice(0, 8)}.`,
            );
            console.log(`${logIcon.review} Reviewing ${label}: ${pullRequest.title}`);

            const diff = await provider.getPullRequestDiff(repo, pullRequest.number);
            const reviewedAt = new Date().toISOString();

            try {
                const result = await reviewer.review({
                    repositoryUrl: repo.url,
                    pullRequest,
                    diff,
                    promptInstructions: repo.promptInstructions,
                });
                const review: PullRequestReview = {
                    repoId: repo.id,
                    pullRequest,
                    status: "reviewed",
                    reviewedCommit: pullRequest.headSha,
                    reviewedAt,
                    summary: result.summary,
                    rawOutput: result.rawOutput,
                    diff,
                    comments: result.comments,
                };
                state.reviews[key] = review;
                completedReviews += 1;
                console.log(
                    `${logIcon.complete} Review completed for ${label} with ${result.comments.length.toString()} comments.`,
                );
            } catch (error) {
                const review: PullRequestReview = {
                    repoId: repo.id,
                    pullRequest,
                    status: "failed",
                    reviewedCommit: pullRequest.headSha,
                    reviewedAt,
                    summary: "Review failed.",
                    rawOutput: "",
                    diff,
                    comments: [],
                    error: error instanceof Error ? error.message : String(error),
                };
                state.reviews[key] = review;
                failedReviews += 1;
                console.log(`${logIcon.error} Review failed for ${label}: ${review.error ?? "Unknown error"}`);
            }

            await saveState(statePath, state);
        }
    }

    await writeSiteData(
        dataDir,
        config.repositories,
        reviewKeys.map((key) => state.reviews[key]).filter((review): review is PullRequestReview => Boolean(review)),
    );

    await saveState(statePath, state);
    console.log(
        `${logIcon.complete} Review run complete: ${cachedReviews.toString()} cached, ${completedReviews.toString()} reviewed, ${failedReviews.toString()} failed.`,
    );

    if (!skipBuild) {
        await buildSite(config.dataDir, outputDir, workspace);
    }
}

async function demo(
    dataDirOption: string,
    outputDirOption: string,
    skipBuild: boolean,
    workspace: string,
): Promise<void> {
    const dataDir = path.resolve(workspace, dataDirOption);
    const outputDir = path.resolve(workspace, outputDirOption);
    await ensureDir(dataDir);

    const repositories = demoRepositories();
    const reviews = demoReviews();
    const state = emptyState();

    for (const review of reviews) {
        state.reviews[reviewKey(review.pullRequest)] = review;
    }

    await writeSiteData(dataDir, repositories, reviews);
    await saveState(path.join(dataDir, "state.json"), state);

    if (!skipBuild) {
        await buildSite(dataDirOption, outputDir, workspace);
    }
}

async function buildSite(dataDir: string, outputDir: string, workspace: string): Promise<void> {
    const packageRoot = resolvePackageRoot();
    await execa("pnpm", ["astro", "build"], {
        stdio: "inherit",
        cwd: packageRoot,
        env: {
            ...process.env,
            [dataDirEnvKey]: dataDir,
            [outputDirEnvKey]: outputDir,
            [workspaceEnvKey]: workspace,
        },
    });
}

async function writeSiteData(
    dataDir: string,
    repositories: SiteRepository[],
    reviews: PullRequestReview[],
): Promise<void> {
    await writeJson(
        path.join(dataDir, "site.json"),
        {
            generatedAt: new Date().toISOString(),
            repositories: repositories.map(siteRepository),
            reviews,
        },
        { spaces: 2 },
    );
}

function siteRepository({ id, name, provider, url, owner, repo }: SiteRepository): SiteRepository {
    return { id, name, provider, url, owner, repo };
}

function resolvePackageRoot(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return here.endsWith(`${path.sep}dist${path.sep}cli`) ? path.resolve(here, "../..") : path.resolve(here, "../..");
}

function demoRepositories(): RepositoryConfig[] {
    return [
        {
            id: "github-octoflow-api",
            name: "Octoflow API",
            provider: "github",
            url: "https://github.com/example/octoflow-api",
            owner: "example",
            repo: "octoflow-api",
            maxPullRequests: 5,
            includedAuthors: [],
            includedAssignees: [],
            skippedAuthors: [],
        },
        {
            id: "github-launchpad-web",
            name: "Launchpad Web",
            provider: "github",
            url: "https://github.com/example/launchpad-web",
            owner: "example",
            repo: "launchpad-web",
            maxPullRequests: 5,
            includedAuthors: [],
            includedAssignees: [],
            skippedAuthors: [],
        },
        {
            id: "github-nimbus-worker",
            name: "Nimbus Worker",
            provider: "github",
            url: "https://github.com/example/nimbus-worker",
            owner: "example",
            repo: "nimbus-worker",
            maxPullRequests: 5,
            includedAuthors: [],
            includedAssignees: [],
            skippedAuthors: [],
        },
    ];
}

function demoReviews(): PullRequestReview[] {
    const now = Date.now();
    return [
        {
            repoId: "github-octoflow-api",
            pullRequest: {
                provider: "github",
                repoId: "github-octoflow-api",
                number: 184,
                reviewState: "approved",
                title: "Cache project activity summaries",
                url: "https://github.com/example/octoflow-api/pull/184",
                author: "riley",
                assignees: ["sam", "morgan"],
                headSha: "9f3b7c2d8a1e4f52b6c901df774aa018e8db7210",
                baseSha: "3a44a6b65d734515ab54c97f5ec10af42de4b095",
                updatedAt: new Date(now - 18 * 60 * 60 * 1000).toISOString(),
            },
            status: "reviewed",
            reviewedCommit: "9f3b7c2d8a1e4f52b6c901df774aa018e8db7210",
            reviewedAt: new Date(now - 16 * 60 * 60 * 1000).toISOString(),
            summary:
                "**Cache key issue found:** the new_cache layer is a _useful_ performance win, but the *current key* omits `viewerRole` and can leak activity totals across permission scopes.\n\nRecommended follow-up:\n- Partition the cache by viewer role or permission scope.\n- Add coverage for **owner-to-viewer** cache reuse.\n\nSee `getActivitySummary` before merging.",
            rawOutput:
                "Found one high-impact cache key issue and one lower-risk invalidation gap around archived projects.",
            diff: `diff --git a/src/activity/cache.ts b/src/activity/cache.ts
index 7c2a915..c91b0f6 100644
--- a/src/activity/cache.ts
+++ b/src/activity/cache.ts
@@ -1,9 +1,20 @@
+import { redis } from "../redis/client";
 import { loadActivity } from "./loadActivity";

-export async function getActivitySummary(projectId: string) {
-  return loadActivity(projectId);
+export async function getActivitySummary(projectId: string, viewerRole: string) {
+  const cacheKey = \`activity:\${projectId}\`;
+  const cached = await redis.get(cacheKey);
+
+  if (cached) {
+    return JSON.parse(cached);
+  }
+
+  const summary = await loadActivity(projectId, viewerRole);
+  await redis.set(cacheKey, JSON.stringify(summary), { ex: 300 });
+  return summary;
 }
diff --git a/src/activity/routes.ts b/src/activity/routes.ts
index c112243..2d7e401 100644
--- a/src/activity/routes.ts
+++ b/src/activity/routes.ts
@@ -12,7 +12,7 @@ router.get("/projects/:projectId/activity", async (req, res) => {
   const project = await requireProject(req.params.projectId, req.user.id);
   const role = await membershipRole(project.id, req.user.id);

-  const summary = await getActivitySummary(project.id);
+  const summary = await getActivitySummary(project.id, role);
   res.json({ projectId: project.id, summary });
 });`,
            comments: [
                {
                    path: "src/activity/cache.ts",
                    line: 5,
                    side: "right",
                    severity: "critical",
                    body: "**Security:** this key only includes `projectId`, so a restricted viewer can receive a summary cached for an owner.\n\nInclude `viewerRole` or a permission scope in the key before storing the response.",
                },
                {
                    path: "src/activity/cache.ts",
                    line: 14,
                    side: "right",
                    severity: "warning",
                    body: "Consider invalidating this when projects are **archived** or **restored**.\n\nOtherwise the dashboard can show stale activity for up to five minutes.",
                },
            ],
        },
        {
            repoId: "github-octoflow-api",
            pullRequest: {
                provider: "github",
                repoId: "github-octoflow-api",
                number: 176,
                reviewState: "ready",
                title: "Add bulk invitation endpoint",
                url: "https://github.com/example/octoflow-api/pull/176",
                author: "sam",
                headSha: "0d7a6c20b863a2b2e22ab986a51271940ac97d54",
                baseSha: "f92ec884de08f221932e982f3abca3e8ccca94fb",
                updatedAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
            },
            status: "reviewed",
            reviewedCommit: "0d7a6c20b863a2b2e22ab986a51271940ac97d54",
            reviewedAt: new Date(now - 3 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString(),
            summary:
                "The endpoint covers the main workflow and reports partial failures clearly.\n\nThe validation should reject duplicate emails before sending invitations.",
            rawOutput: "Suggested adding duplicate detection and a test for repeated addresses in one request.",
            diff: `diff --git a/src/invitations/bulk.ts b/src/invitations/bulk.ts
index a11d501..df98215 100644
--- a/src/invitations/bulk.ts
+++ b/src/invitations/bulk.ts
@@ -4,8 +4,18 @@ import { sendInvite } from "./sendInvite";
 export async function createBulkInvites(projectId: string, emails: string[]) {
   const results = [];

-  for (const email of emails) {
-    results.push(await sendInvite(projectId, email));
+  for (const email of emails.map((value) => value.trim().toLowerCase())) {
+    if (!email.includes("@")) {
+      results.push({ email, status: "invalid" });
+      continue;
+    }
+
+    try {
+      results.push(await sendInvite(projectId, email));
+    } catch (error) {
+      results.push({ email, status: "failed" });
+    }
   }

   return results;
 }`,
            comments: [
                {
                    path: "src/invitations/bulk.ts",
                    line: 6,
                    side: "right",
                    severity: "suggestion",
                    body: "Normalize first, then deduplicate the list before the loop.\n\nA repeated address currently receives multiple invites.",
                },
            ],
        },
        {
            repoId: "github-launchpad-web",
            pullRequest: {
                provider: "github",
                repoId: "github-launchpad-web",
                number: 92,
                reviewState: "draft",
                title: "Refresh billing settings page",
                url: "https://github.com/example/launchpad-web/pull/92",
                author: "taylor",
                assignees: ["avery"],
                headSha: "bd441671ac82ac301bb7fbfcd77c9a4d76c255e2",
                baseSha: "76b4d911f77394b8ff64536b37ec9cd76f80036f",
                updatedAt: new Date(now - 7 * 60 * 60 * 1000).toISOString(),
            },
            status: "reviewed",
            reviewedCommit: "bd441671ac82ac301bb7fbfcd77c9a4d76c255e2",
            reviewedAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
            summary:
                "The layout is clearer and keyboard navigation remains intact.\n\nOne empty-state branch still renders an enabled submit button with no selected plan.",
            rawOutput: "Checked billing settings flow. One submit-state bug found in the empty plan branch.",
            diff: `diff --git a/src/pages/billing/Settings.tsx b/src/pages/billing/Settings.tsx
index 9a070a1..ac13094 100644
--- a/src/pages/billing/Settings.tsx
+++ b/src/pages/billing/Settings.tsx
@@ -30,10 +30,15 @@ export function BillingSettings({ account, plans }: BillingSettingsProps) {
       <PlanPicker
         plans={plans}
         selectedPlan={selectedPlan}
         onChange={setSelectedPlan}
       />
-      <button type="submit" disabled={isSaving}>
-        Save billing settings
+      <button
+        type="submit"
+        disabled={isSaving || account.status === "past_due"}
+      >
+        {isSaving ? "Saving..." : "Save billing settings"}
       </button>
     </form>
   );
 }`,
            comments: [
                {
                    path: "src/pages/billing/Settings.tsx",
                    line: 37,
                    side: "right",
                    severity: "warning",
                    body: "This still allows submit when plans is empty and selectedPlan is undefined.\n\nDisable until a concrete plan is selected.",
                },
            ],
        },
        {
            repoId: "github-launchpad-web",
            pullRequest: {
                provider: "github",
                repoId: "github-launchpad-web",
                number: 88,
                reviewState: "ready",
                title: "Migrate analytics cards to server data",
                url: "https://github.com/example/launchpad-web/pull/88",
                author: "avery",
                assignees: ["taylor", "casey"],
                headSha: "a4acb7846f86b3b783f7311ea1cc06d1f50b7e81",
                baseSha: "f47dbe2a18d083ada55ff1fcf78fc6e949038935",
                updatedAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
            },
            status: "failed",
            reviewedCommit: "a4acb7846f86b3b783f7311ea1cc06d1f50b7e81",
            reviewedAt: new Date(now - 5 * 24 * 60 * 60 * 1000 + 20 * 60 * 1000).toISOString(),
            summary: "Review failed.",
            rawOutput: "",
            diff: `diff --git a/src/components/AnalyticsCards.tsx b/src/components/AnalyticsCards.tsx
index 51ed23b..5a299ce 100644
--- a/src/components/AnalyticsCards.tsx
+++ b/src/components/AnalyticsCards.tsx
@@ -9,7 +9,7 @@ export function AnalyticsCards({ metrics }: AnalyticsCardsProps) {
   return (
     <section className="analytics-grid">
       {metrics.map((metric) => (
-        <MetricCard key={metric.label} metric={metric} />
+        <MetricCard key={metric.id} metric={metric} />
       ))}
     </section>
   );
 }`,
            comments: [],
            error: "Reviewer command exited before producing JSON output.",
        },
        {
            repoId: "github-nimbus-worker",
            pullRequest: {
                provider: "github",
                repoId: "github-nimbus-worker",
                number: 57,
                reviewState: "approved",
                title: "Retry failed export jobs",
                url: "https://github.com/example/nimbus-worker/pull/57",
                author: "jordan",
                assignees: ["casey"],
                headSha: "19b6cf0d23f7a40e9c1b4d88fa75e639ad214c0f",
                baseSha: "c6aa0f37ce7a9a6a6d3c726e2bd9b9f2d43e7a0a",
                updatedAt: new Date(now - 11 * 60 * 60 * 1000).toISOString(),
            },
            status: "reviewed",
            reviewedCommit: "19b6cf0d23f7a40e9c1b4d88fa75e639ad214c0f",
            reviewedAt: new Date(now - 10 * 60 * 60 * 1000).toISOString(),
            summary:
                "The retry queue now covers transient export failures and preserves the original job metadata.\n\nThe new backoff path should also cap the retry counter before enqueueing follow-up work.",
            rawOutput:
                "Found one retry-safety issue: jobs can be requeued beyond the documented maximum attempt count.",
            diff: `diff --git a/src/jobs/exportRetry.ts b/src/jobs/exportRetry.ts
index 3c8f2a1..70b546d 100644
--- a/src/jobs/exportRetry.ts
+++ b/src/jobs/exportRetry.ts
@@ -8,10 +8,19 @@ const MAX_ATTEMPTS = 5;
 export async function retryExportJob(job: ExportJob) {
   const nextAttempt = job.attempt + 1;

-  if (nextAttempt > MAX_ATTEMPTS) {
-    await markExportFailed(job.id);
-    return;
-  }
+  const delayMs = Math.min(30000, nextAttempt * 5000);
+  await enqueueExport({
+    ...job,
+    attempt: nextAttempt,
+    runAfter: new Date(Date.now() + delayMs).toISOString(),
+  });
+}
+
+export async function retryFailedExports(jobs: ExportJob[]) {
+  for (const job of jobs) {
+    await retryExportJob(job);
+  }
 }`,
            comments: [
                {
                    path: "src/jobs/exportRetry.ts",
                    line: 11,
                    side: "right",
                    severity: "warning",
                    body: "This removed the MAX_ATTEMPTS guard before enqueueing the next job.\n\nKeep the terminal failure branch so permanently failing exports do not retry forever.",
                },
            ],
        },
        {
            repoId: "github-nimbus-worker",
            pullRequest: {
                provider: "github",
                repoId: "github-nimbus-worker",
                number: 51,
                reviewState: "ready",
                title: "Stream worker health metrics",
                url: "https://github.com/example/nimbus-worker/pull/51",
                author: "casey",
                assignees: ["jordan", "riley"],
                headSha: "f84ce159498a5021845c45fbe21f1db8b9fb11dc",
                baseSha: "52cb1b8ff13861d8295f2d46550653a61e747d09",
                updatedAt: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(),
            },
            status: "reviewed",
            reviewedCommit: "f84ce159498a5021845c45fbe21f1db8b9fb11dc",
            reviewedAt: new Date(now - 4 * 24 * 60 * 60 * 1000 + 35 * 60 * 1000).toISOString(),
            summary:
                "The metrics stream is straightforward and keeps the worker heartbeat visible to operators.\n\nAdd a bounded buffer or drop policy before enabling it for every worker.",
            rawOutput: "Suggested bounding the metric queue to prevent memory growth under a disconnected sink.",
            diff: `diff --git a/src/metrics/stream.ts b/src/metrics/stream.ts
index 42b8dd0..65463ef 100644
--- a/src/metrics/stream.ts
+++ b/src/metrics/stream.ts
@@ -1,8 +1,18 @@
 import { collectWorkerMetrics } from "./collect";

+const subscribers = new Set<(event: WorkerMetric) => void>();
+
 export function publishWorkerMetric(workerId: string) {
   const metric = collectWorkerMetrics(workerId);
-  console.log(JSON.stringify(metric));
+  for (const subscriber of subscribers) {
+    subscriber(metric);
+  }
 }
+
+export function subscribeToWorkerMetrics(callback: (event: WorkerMetric) => void) {
+  subscribers.add(callback);
+  return () => subscribers.delete(callback);
+}`,
            comments: [
                {
                    path: "src/metrics/stream.ts",
                    line: 4,
                    side: "right",
                    severity: "suggestion",
                    body: "This unbounded subscriber set depends on every caller invoking the returned cleanup.\n\nConsider adding idle timeouts or connection lifecycle tests.",
                },
            ],
        },
    ];
}
