import { Octokit } from "octokit";
import type { RepositoryProvider } from "./provider.js";
import type { PullRequestSummary, RepositoryConfig } from "../types/revisaur.js";

const perPageKey = "per_page";
const pullNumberKey = "pull_number";
const maxPullRequestPages = 5;
const pullRequestsPageSize = 100;

type GitHubPullRequest = Awaited<ReturnType<Octokit["rest"]["pulls"]["list"]>>["data"][number];

interface PullRequestFilters {
    includedAssignees: ReadonlySet<string>;
    includedAuthors: ReadonlySet<string>;
    skippedAuthors: ReadonlySet<string>;
}

export class GitHubProvider implements RepositoryProvider {
    #client: Octokit;

    constructor(token = process.env.GITHUB_TOKEN) {
        this.#client = new Octokit(token === undefined || token === "" ? {} : { auth: token });
    }

    async listRecentlyUpdatedPullRequests(repo: RepositoryConfig): Promise<PullRequestSummary[]> {
        const filters = pullRequestFilters(repo);
        const pullRequests: GitHubPullRequest[] = [];
        let page = 1;

        while (pullRequests.length < repo.maxPullRequests && page <= maxPullRequestPages) {
            const response = await this.#client.rest.pulls.list({
                owner: repo.owner,
                repo: repo.repo,
                state: "open",
                sort: "updated",
                direction: "desc",
                page,
                [perPageKey]: pullRequestsPageSize,
            });

            for (const pr of response.data) {
                if (matchesPullRequestFilters(filters, pr)) {
                    pullRequests.push(pr);
                }

                if (pullRequests.length >= repo.maxPullRequests) {
                    break;
                }
            }

            if (response.data.length < pullRequestsPageSize) {
                break;
            }

            page += 1;
        }

        return Promise.all(
            pullRequests.map(async (pr) => ({
                provider: "github",
                repoId: repo.id,
                number: pr.number,
                reviewState: pr.draft === true ? "draft" : await this.#reviewState(repo, pr.number),
                title: pr.title,
                url: pr.html_url,
                author: pr.user?.login ?? "unknown",
                assignees: pr.assignees?.map((assignee) => assignee.login).filter((login) => login.length > 0) ?? [],
                headSha: pr.head.sha,
                baseSha: pr.base.sha,
                updatedAt: pr.updated_at,
                mergedAt: pr.merged_at,
            })),
        );
    }

    async getPullRequestDiff(repo: RepositoryConfig, pullRequestNumber: number): Promise<string> {
        const response = await this.#client.rest.pulls.get({
            owner: repo.owner,
            repo: repo.repo,
            [pullNumberKey]: pullRequestNumber,
            mediaType: { format: "diff" },
        });

        return response.data as unknown as string;
    }

    async #reviewState(repo: RepositoryConfig, pullRequestNumber: number): Promise<"approved" | "ready"> {
        const response = await this.#client.rest.pulls.listReviews({
            owner: repo.owner,
            repo: repo.repo,
            [pullNumberKey]: pullRequestNumber,
            [perPageKey]: 100,
        });

        const latestReviewByUser = new Map<string, { state: string; submittedAt: string }>();

        for (const review of response.data) {
            const user = review.user?.login;
            const submittedAt = review.submitted_at;

            if (user === undefined || user === "" || submittedAt === undefined) {
                continue;
            }

            const latestReview = latestReviewByUser.get(user);
            if (latestReview === undefined || submittedAt > latestReview.submittedAt) {
                latestReviewByUser.set(user, { state: review.state, submittedAt });
            }
        }

        const latestStates = [...latestReviewByUser.values()].map((review) => review.state);

        if (latestStates.includes("CHANGES_REQUESTED")) {
            return "ready";
        }

        return latestStates.includes("APPROVED") ? "approved" : "ready";
    }
}

function pullRequestFilters(repo: RepositoryConfig): PullRequestFilters {
    return {
        includedAssignees: new Set(repo.includedAssignees.map((user) => user.toLowerCase())),
        includedAuthors: new Set(repo.includedAuthors.map((user) => user.toLowerCase())),
        skippedAuthors: new Set(repo.skippedAuthors.map((user) => user.toLowerCase())),
    };
}

function matchesPullRequestFilters(filters: PullRequestFilters, pr: GitHubPullRequest): boolean {
    const author = (pr.user?.login ?? "").toLowerCase();

    if (filters.skippedAuthors.has(author)) {
        return false;
    }

    if (filters.includedAuthors.size === 0 && filters.includedAssignees.size === 0) {
        return true;
    }

    if (filters.includedAuthors.has(author)) {
        return true;
    }

    return (
        pr.assignees
            ?.map((assignee) => assignee.login.toLowerCase())
            .some((assignee) => filters.includedAssignees.has(assignee)) ?? false
    );
}
