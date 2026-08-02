import { searchPinterest } from "./pinterest.js";

const query = process.argv[2]?.trim();
const limit = Number(process.argv[3] || 20);

if (!query) {
  process.stderr.write('Использование: npm run pinterest:search -- "mens skincare aesthetic" 20\n');
  process.exitCode = 1;
} else {
  searchPinterest({ query, limit })
    .then((results) => process.stdout.write(`${JSON.stringify(results, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
