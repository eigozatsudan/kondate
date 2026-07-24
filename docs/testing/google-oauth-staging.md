# Google OAuth staging evidence (template)

Instruction-only. **Do not commit** the actual JSON artifact or a copied result.

## When

On the exact release candidate SHA, from staging origin with `startScreen: "login"`, complete a real Google OAuth success in the original browser.

## Artifact (external path only)

Write JSON **outside** the repository with exactly these fields:

```json
{
  "candidateSha": "<40-or-64 hex git SHA>",
  "stagingDeployId": "<24 hex Netlify deploy id>",
  "stagingDeploySha": "<same as candidateSha>",
  "executedAt": "<ISO-8601 with offset>",
  "expiresAt": "<executedAt + exactly 24 hours>",
  "tester": "<non-email human label>",
  "stagingOrigin": "https://<staging-host>",
  "startScreen": "login",
  "stateMatched": true,
  "originalBrowserCallbackCompleted": true,
  "tokenFreeResult": true,
  "passed": true
}
```

Forbidden: account id, email, authorization code, continuation secret, PKCE verifier, access/refresh token, screenshot, raw log, unknown keys.

Obtain `stagingDeployId` / commit from Netlify deploy metadata — not memory.

## Verify

```bash
export NETLIFY_AUTH_TOKEN=...   # release-runner only; never a site/build var
export GOOGLE_OAUTH_RELEASE_EVIDENCE=/absolute/path/outside/repo/evidence.json
node scripts/verify-release-evidence.mjs "$GOOGLE_OAUTH_RELEASE_EVIDENCE"
```

Expect stdout: `google_oauth_evidence: pass`. Run before expiry and before tag/production deploy.
