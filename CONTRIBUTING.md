# Contributing to Carousel Lab

Thanks for helping improve Carousel Lab. This project is an early local-first tool, so small, focused pull requests are easier to review and safer to ship.

## Development setup

```bash
git clone https://github.com/Danprog4/tt-carousels.git
cd tt-carousels
npm install
npm run dev
```

The API runs at `http://127.0.0.1:4318`; Vite runs at `http://127.0.0.1:5173`.

TikTok and Pinterest work requires a dedicated Chrome instance:

```bash
npm run chrome:start
```

Do not use or automate another person's browser profile. Sign into the dedicated profile manually.

## Before opening a pull request

```bash
npm test
npm run build
```

Please keep these rules in mind:

- add or update tests for contracts, ranking, persistence, or rendering behavior;
- keep AI output behind strict Zod schemas;
- preserve the separation between cheap metadata ranking and selected-corpus visual analysis;
- never commit `data/`, browser profiles, credentials, `.env` files, scraped media, or creator datasets;
- do not add publishing, liking, commenting, following, or other account mutation automation;
- document new environment variables and user-visible behavior in the README.

## Pull requests

Describe:

1. the user problem;
2. the chosen behavior;
3. how it was tested;
4. any impact on AI cost, browser load, stored data, or migrations.

For UI changes, include a screenshot or short recording when possible.

## Bug reports

Include your operating system, Node version, Chrome version, the failing command, and the exact error message. Remove cookies, tokens, local paths, creator datasets, and other private information before posting logs.

## Responsible research

Contributions must respect platform terms, rate limits, privacy, and image rights. Carousel Lab is for local research and content transformation, not mass account automation or unauthorized data collection.
