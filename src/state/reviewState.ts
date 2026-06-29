import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { ensureDir, pathExists, readJson, writeJson } from "fs-extra/esm";
import type {
    PullRequestReview,
    PullRequestSummary,
    ReviewManifest,
    ReviewManifestEntry,
    ReviewState,
    SiteRepository,
} from "../types/revisaur.js";

const reviewApiDirectory = "reviews";
const reviewManifestFileName = "index.json";

export function emptyState(): ReviewState {
    return { version: 1, reviews: {} };
}

export async function loadState(path: string): Promise<ReviewState> {
    if (!(await pathExists(path))) {
        return emptyState();
    }

    return (await readJson(path)) as ReviewState;
}

export async function saveState(path: string, state: ReviewState): Promise<void> {
    await writeJson(path, state, { spaces: 2 });
}

export function reviewKey(pr: PullRequestSummary): string {
    return `${pr.provider}:${pr.repoId}:${pr.number.toString()}:${pr.headSha}`;
}

export function isReusableReview(review: PullRequestReview | undefined): boolean {
    return Boolean(review && review.status !== "failed");
}

export async function loadReviewState(dataDir: string): Promise<ReviewState> {
    const legacyState = await loadState(path.join(dataDir, "state.json"));
    const state: ReviewState = { version: 1, reviews: { ...legacyState.reviews } };
    const reviewFiles = await listReviewJsonFiles(path.join(dataDir, reviewApiDirectory));

    for (const reviewFile of reviewFiles) {
        const review = (await readJson(reviewFile)) as PullRequestReview;
        state.reviews[reviewKey(review.pullRequest)] = review;
    }

    return state;
}

export async function writeReviewFile(dataDir: string, review: PullRequestReview): Promise<void> {
    const reviewPath = path.join(dataDir, ...reviewJsonRelativePath(review).split(path.posix.sep));
    await ensureDir(path.dirname(reviewPath));
    await writeJson(reviewPath, review, { spaces: 2 });
}

export async function writeReviewApi(
    dataDir: string,
    repositories: SiteRepository[],
    reviews: PullRequestReview[],
    generatedAt: string,
): Promise<void> {
    await Promise.all(reviews.map((review) => writeReviewFile(dataDir, review)));
    const manifest: ReviewManifest = {
        version: 1,
        generatedAt,
        repositories,
        reviews: reviews.map(reviewManifestEntry).sort(compareReviewManifestEntries),
    };
    const manifestPath = path.join(dataDir, reviewApiDirectory, reviewManifestFileName);
    await ensureDir(path.dirname(manifestPath));
    await writeJson(manifestPath, manifest, { spaces: 2 });
}

export function reviewJsonRelativePath(review: PullRequestReview): string {
    return path.posix.join(reviewApiDirectory, reviewJsonApiPath(review));
}

function reviewJsonApiPath(review: PullRequestReview): string {
    return path.posix.join(
        safePathSegment(review.repoId),
        review.pullRequest.number.toString(),
        `${safePathSegment(review.pullRequest.headSha)}.json`,
    );
}

async function listReviewJsonFiles(directory: string): Promise<string[]> {
    if (!(await pathExists(directory))) {
        return [];
    }

    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            files.push(...(await listReviewJsonFiles(entryPath)));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== reviewManifestFileName) {
            files.push(entryPath);
        }
    }

    return files;
}

function reviewManifestEntry(review: PullRequestReview): ReviewManifestEntry {
    return {
        author: review.pullRequest.author,
        headSha: review.pullRequest.headSha,
        number: review.pullRequest.number,
        path: reviewJsonApiPath(review),
        provider: review.pullRequest.provider,
        repoId: review.repoId,
        reviewedAt: review.reviewedAt,
        status: review.status,
        title: review.pullRequest.title,
        updatedAt: review.pullRequest.updatedAt,
        url: review.pullRequest.url,
    };
}

function compareReviewManifestEntries(first: ReviewManifestEntry, second: ReviewManifestEntry): number {
    return (
        first.repoId.localeCompare(second.repoId) ||
        first.number - second.number ||
        first.headSha.localeCompare(second.headSha)
    );
}

function safePathSegment(value: string): string {
    if (/^[A-Za-z0-9._-]+$/.test(value)) {
        return value;
    }

    const sanitized = value.replaceAll(/[^A-Za-z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "") || "value";
    const hash = createHash("sha256").update(value).digest("hex").slice(0, 8);
    return `${sanitized.slice(0, 80)}-${hash}`;
}
