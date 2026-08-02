import { createApp } from "./app.js";
import { CarouselDatabase } from "./database.js";

const port = Number(process.env.PORT || 4318);
const database = new CarouselDatabase();
database.recoverInterruptedSessions();
const app = createApp(database);

app.listen(port, "127.0.0.1", () => {
  console.log(`[carousel-lab] backend: http://127.0.0.1:${port}`);
  console.log(`[carousel-lab] database: ${database.path}`);
});
