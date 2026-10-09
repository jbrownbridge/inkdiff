# Release checklist

This file is an example for trying Inkdiff. Open the pull request that changes it, and see the rendered view.

## Before the release

1. Update the version in `package.json`.
2. Run the tests and the linter.
3. Write the release notes.
4. Ask a second maintainer to review the notes.

## Build

Run the build and check the output folder.

```sh
npm ci
npm run build
```

## Steps

| Step | Owner | Time |
|---|---|---|
| Build | CI | 5 min |
| Test | CI | 10 min |
| Security scan | CI | 4 min |
| Publish | Maintainer | 2 min |

## Flow

```mermaid
flowchart LR
  A[Build] --> B[Test]
  B --> S[Security scan]
  S -->|pass| C[Publish]
  S -->|fail| F[Fix and rebuild]
  F --> A
```

## After the release

- Announce the release.
- Close the milestone.
- Check the error reports for one day.

## Notes

Keep each release small. A small release is easy to review and easy to roll back.

If a step fails, stop and fix it before you continue.
