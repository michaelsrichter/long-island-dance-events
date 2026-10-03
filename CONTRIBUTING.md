# Contributing

Use small pull requests. Run the smallest relevant checks before asking for review:

```powershell
npm run check
npm test
$env:BUILD_NOW='2026-10-01T22:00:00-04:00'; npm run build
npm run test:links
```

Content changes should keep every collection valid and every publishable entry explicit about `published`.
