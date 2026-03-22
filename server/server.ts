import "../src/instrumentation";
import { instrument } from "../src/middleware/index.ts";
import app from "../src/server";

export default instrument(app);
