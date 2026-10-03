# Rollback plan

A rollback should be boring: restore the last known good site, keep visitors informed and avoid making the problem worse.

## What can be rolled back

| Problem | Rollback target |
| --- | --- |
| Bad content | Revert or edit the content commit. |
| Broken build | Re-run last successful workflow or revert code. |
| Bad deployment | Re-run the previous successful deployment. |
| Bad custom domain | Restore DNS to previous host. |
| Bad OAuth setup | Restore previous callback and `ALLOWED_HOSTS`. |
| Bad analytics setting | Remove variables/settings and redeploy. |

## Fast content rollback

If an editor publishes wrong content:

1. Open the GitHub pull request/commit that changed it.
2. Revert the commit or edit the content directly.
3. Run schema tests.
4. Merge/deploy.

Commands:

```powershell
git revert <bad-commit>
npm test -- tests/unit/schemas.test.ts
```

## Deployment rollback

1. Find the last successful GitHub Actions deployment.
2. Re-run that workflow if the artifact/source is still valid, or revert the bad commit.
3. Keep `SITE_URL` and `ALLOW_INDEXING` unchanged unless the host itself is bad.
4. Run smoke tests.

```powershell
node scripts/smoke.mjs https://www.example.org
```

## DNS rollback

Use this only if the custom domain itself is broken.

1. Lower TTL if possible.
2. Restore previous CNAME/redirect records.
3. Set `SITE_URL` to the working host.
4. Set `ALLOW_INDEXING=false` if using a temporary host.
5. Update OAuth callback to the working host.
6. Redeploy.

## Communication

For public schedule mistakes, post a short correction:

- What changed.
- Correct date/time/place.
- Whether the event is cancelled or still happening.
- Where to get updates.

## After-action note

Record:

- Start and end time.
- What failed.
- How it was detected.
- Rollback step used.
- Follow-up prevention.

Keep the note in an issue or operations log, not necessarily in the public repository.
