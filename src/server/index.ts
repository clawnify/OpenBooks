import { createApp } from "@clawnify/app";
import { initUploads } from "./uploads";
import api from "./routes";

type Env = { Bindings: { DB: D1Database; UPLOADS: R2Bucket } };

const app = createApp<Env>({ title: "OpenBooks", version: "1.0.0" });

app.use("*", async (c, next) => {
  initUploads(c.env.UPLOADS);
  await next();
});

app.route("/", api);

export default app;
