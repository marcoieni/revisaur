import { beforeEach, describe, expect, it, vi, type MockedFunction } from "vitest";
import type { Octokit } from "octokit";
import { GitHubProvider } from "./github.js";
import type { RepositoryConfig } from "../types/revisaur.js";

const htmlUrlKey = "html_url";
const mergedAtKey = "merged_at";
const updatedAtKey = "updated_at";

type PullsList = Octokit["rest"]["pulls"]["list"];
type PullsListReviews = Octokit["rest"]["pulls"]["listReviews"];
type PullsListResponse = Awaited<ReturnType<PullsList>>;
type GitHubPullRequest = PullsListResponse["data"][number];
type GitHubAssignee = NonNullable<NonNullable<GitHubPullRequest["assignees"]>[number]>;
type GitHubUser = NonNullable<GitHubPullRequest["user"]>;

const octokitMocks = vi.hoisted(
    (): {
        listPullRequests: MockedFunction<PullsList>;
        listReviews: MockedFunction<PullsListReviews>;
    } => ({
        listPullRequests: vi.fn<PullsList>(),
        listReviews: vi.fn<PullsListReviews>(),
    }),
);

vi.mock("octokit", () => ({
    ["Octokit"]: vi.fn(function mockOctokit() {
        return {
            rest: {
                pulls: {
                    list: octokitMocks.listPullRequests,
                    listReviews: octokitMocks.listReviews,
                },
            },
        };
    }),
}));

describe("GitHubProvider", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("paginates until enough pull requests match configured filters", async () => {
        const firstPage = Array.from({ length: 100 }, (_, index) =>
            pullRequest(index + 1, { user: user(`other-${index.toString()}`) }),
        );
        const matchingPullRequest = pullRequest(101, {
            assignees: [assignee("target")],
            user: user("other-author"),
        });
        octokitMocks.listPullRequests
            .mockResolvedValueOnce(pullsListResponse(firstPage))
            .mockResolvedValueOnce(pullsListResponse([matchingPullRequest]));

        const provider = new GitHubProvider("");

        await expect(
            provider.listRecentlyUpdatedPullRequests(
                repository({
                    includedAssignees: ["target"],
                    maxPullRequests: 1,
                }),
            ),
        ).resolves.toMatchObject([{ assignees: ["target"], number: 101 }]);

        expect(octokitMocks.listPullRequests).toHaveBeenCalledTimes(2);
        expect(octokitMocks.listPullRequests).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ page: 1, ["per_page"]: 100 }),
        );
        expect(octokitMocks.listPullRequests).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ page: 2, ["per_page"]: 100 }),
        );
    });
});

function repository(overrides: Partial<RepositoryConfig> = {}): RepositoryConfig {
    return {
        id: "github-example-project",
        name: "example/project",
        provider: "github",
        url: "https://github.com/example/project",
        owner: "example",
        repo: "project",
        maxPullRequests: 10,
        includedAuthors: [],
        includedAssignees: [],
        skippedAuthors: [],
        ...overrides,
    };
}

function pullRequest(number: number, overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
    return {
        number,
        draft: true,
        title: `Pull request ${number.toString()}`,
        [htmlUrlKey]: `https://github.com/example/project/pull/${number.toString()}`,
        user: user("author"),
        assignees: [],
        head: { sha: `head-${number.toString()}` },
        base: { sha: `base-${number.toString()}` },
        [updatedAtKey]: "2026-06-11T00:00:00Z",
        [mergedAtKey]: null,
        ...overrides,
    } as GitHubPullRequest;
}

function pullsListResponse(data: GitHubPullRequest[]): PullsListResponse {
    return { data } as PullsListResponse;
}

function user(login: string): GitHubUser {
    return { login } as GitHubUser;
}

function assignee(login: string): GitHubAssignee {
    return { login } as GitHubAssignee;
}
