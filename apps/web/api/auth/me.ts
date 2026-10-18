import { handler, json } from "../_lib/http.js";
import { currentUser } from "../_lib/auth.js";

export const GET = handler(async (req) => json({ user: await currentUser(req) }));
