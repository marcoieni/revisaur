<p align="center">
  <img src="public/logo.png" alt="Revisaur logo" width="180">
</p>

# Revisaur

> [!NOTE]
> This is still in early development. Come back after I announce this project publicly.

Revisaur reads a TOML configuration file, fetches the last N recently updated pull requests for each configured repository, runs an AI review for PR head commits that have not been reviewed yet, and generates a static Astro website.

The first provider is GitHub. The provider interface is intentionally isolated so GitLab and Forgejo can be added later. The first reviewer is Kiro CLI headless mode, with the reviewer interface ready for other tools such as Codex.

## Quick Start from npm

Revisaur requires Node.js 24 or newer. It also expects `pnpm` to be available when building the generated Astro site.

Install it in the project that will run the reviews:

```bash
npm install --save-dev revisaur
```

You can also install it globally:

```bash
npm install --global revisaur
```

Create a `revisaur.toml` file (see [Configuration](#configuration) for details).

Generate reviews and build the static site:

```bash
GITHUB_TOKEN=... KIRO_API_KEY=... npx revisaur generate --config revisaur.toml
```

The generated site is written to `site-dist` by default. To generate review data without building the Astro site, pass `--skip-build`:

```bash
GITHUB_TOKEN=... KIRO_API_KEY=... npx revisaur generate --config revisaur.toml --skip-build
```

To try the website without GitHub or reviewer credentials, generate demo data:

```bash
npx revisaur demo
```

## Quick Start from source

```bash
pnpm install
cp examples/revisaur.toml revisaur.toml
GITHUB_TOKEN=... KIRO_API_KEY=... pnpm generate -- --config revisaur.toml
pnpm dev
```

To try the website without GitHub or reviewer credentials, generate demo data:

```bash
pnpm demo
pnpm dev
```

## Configuration

```toml
output_dir = "site-dist"
data_dir = ".revisaur/data"
max_pull_requests = 10
included_authors = []
included_assignees = []
skipped_authors = ["renovate", "renovate[bot]", "dependabot", "dependabot[bot]"]
prompt_instructions = "Prioritize correctness, security, and regressions over style nits."

[reviewer]
kind = "kiro"
command = "kiro-cli"
model = "claude-opus-4.7"
reasoning_level = "default"
trust_tools = "read,grep,glob"
timeout_seconds = 900

[[repositories]]
name = "Astro"
provider = "github"
url = "https://github.com/withastro/astro"
max_pull_requests = 5
# Repository-level filters are unioned with global filters, not overridden.
included_authors = ["maintainer"]
# prompt_instructions = "Repository-specific instructions override the global prompt_instructions value."
```

Use `included_authors` to review only pull requests opened by specific users, and `included_assignees` to review only pull requests assigned to specific users. If both are configured, a pull request matching either list is reviewed. `skipped_authors` excludes pull requests by author and takes precedence over include filters.

Global and repository-level user filters (`included_authors`, `included_assignees`, and `skipped_authors`) are additive, not overriding. Revisaur uses the union of the global values and the repository values. For example, keep `skipped_authors` global to ignore bot pull requests in every repository, and add repository-specific filters such as:

- `skipped_authors` for extra authors that should be skipped in that repository.
- `included_authors` to limit reviews of that repository to specific maintainers.

Use `prompt_instructions` to add reviewer guidance to the generated prompt. A repository-level value overrides the global value for that repository.

Revisaur stores review state in `.revisaur/data/state.json`. A PR commit is reviewed once per repository, PR number, and head SHA. If a PR receives new commits, the changed head SHA causes a new review. Existing reviews are reused when rebuilding the website.

When Revisaur needs to run a review, it creates a temporary shallow checkout of the pull request head commit so that AI can access the full repository context.
After all reviews, Revisaur removes the temporary checkout so that it is not included in the review state cache.

## GitHub Pages

See [docs/github-action.md](docs/github-action.md) for a workflow using the composite action and the official GitHub Pages upload/deploy actions.

## Diff Rendering

The generated Astro site uses [`@pierre/diffs`](https://diffs.com/) to render pull request patches and line-specific AI review comments.

The generated website uses first-party browser `localStorage` to remember the color mode, diff display settings, and addressed checkboxes for pull request reviews and line-specific AI comments. Addressed checks are stored under `revisaur:addressed:v1`, because the generated website is static and has no backend. This makes the stored state private to the current browser profile: it is not committed to the generated site, synced across devices, or shared with other users.

## Icons

The site uses the following icons from [lucide.dev](https://lucide.dev):

- `public/icons/file.svg`
- `public/icons/moon.svg`
- `public/icons/square-split-horizontal.svg`
- `public/icons/square-split-vertical.svg`
- `public/icons/sun.svg`
- `public/icons/text-align-justify.svg`
- `public/icons/text-wrap.svg`
