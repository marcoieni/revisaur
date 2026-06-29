# GitHub Action

Revisaur ships as a composite action. It installs Node, pnpm, Kiro CLI, and runs the generator. The generated static site is written to `site-dist`; upload or deploy that directory from your workflow.

When the action runs in a repository such as `owner/reviews`, Revisaur automatically builds assets with the `/reviews` base path required by GitHub Pages project sites. For a custom domain or an `owner.github.io` repository deployed at the domain root, set `base-path: "/"`.

Kiro [headless mode](https://kiro.dev/docs/cli/headless/) requires `KIRO_API_KEY`. Create a Kiro API key and store it as a repository secret named `KIRO_API_KEY`. Kiro documents headless mode as `kiro-cli chat --no-interactive`, with API-key auth through the `KIRO_API_KEY` environment variable.

## Run the action

Add a workflow like the example below to `.github/workflows/revisaur.yml` in the repository that should publish the review site. The workflow can run at your favorite schedule, or you can run it manually from GitHub by opening **Actions**, selecting the workflow, and choosing **Run workflow**.

Keep the `concurrency` block in the workflow. Revisaur keeps review state while it generates the site, and the GitHub Pages deploy job also writes to a shared deployment target. The `pages` group ensures only one Revisaur Pages deployment runs at a time, while `cancel-in-progress: false` lets an already running review finish instead of interrupting it when another scheduled or manual run starts.

```yaml
name: Revisaur

on:
  workflow_dispatch:
  schedule:
    - cron: "17 * * * *"

permissions: {}

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: read
    steps:
      - uses: actions/checkout@v6
      - uses: marcoieni/revisaur/action@main
        env:
          KIRO_API_KEY: ${{ secrets.KIRO_API_KEY }}
      - name: Commit review JSON API
        shell: bash
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add .revisaur/data/reviews
          git diff --cached --quiet && exit 0
          git commit -m "Update Revisaur review data"
          git push
      - uses: actions/upload-pages-artifact@v5
        with:
          path: site-dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

The build job is the only job that runs the AI reviewer, so it gets repository write permission to commit review JSON files plus read-only pull request access and the Kiro API key. The deploy job gets the Pages/OIDC permissions, but it only publishes the generated artifact and does not run the reviewer.

By default Revisaur writes committed review files to `.revisaur/data/reviews`, matching the default `data_dir`. If your `revisaur.toml` uses a different `data_dir`, commit that directory's `reviews` subdirectory instead. If your repository ignores `.revisaur/`, add an exception for `.revisaur/data/reviews/`.

Reviews not already present in the checkout use temporary shallow git checkouts so the AI reviewer can inspect repository files. Each repository is cloned at most once per run, outside `data_dir`, and the checkout is removed after that repository's reviews finish.

The generated site also exposes the committed review data as a static API under `site-dist/api/reviews/`. For example:

```bash
jq -r '.reviews[] | "\(.repoId) #\(.number) \(.status) \(.path)"' .revisaur/data/reviews/index.json
```

For now the provider implementation supports GitHub repository URLs. The config keeps an explicit `provider` field so GitLab and Forgejo providers can be added without changing the file shape.
