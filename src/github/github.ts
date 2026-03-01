import crypto from "crypto";
import express from "express";
import { config } from "../config";
import { GithubHandlerFunction } from "../interfaces";
import {
  handleClosed,
  handleCreated,
  handleDeleted,
  handleLabeled,
  handleLocked,
  handleOpened,
  handleProjectItemEdited,
  handleReopened,
  handleUnlabeled,
  handleUnlocked,
} from "./githubHandlers";

const app = express();
// Use raw body so we can verify the webhook signature before parsing
app.use(express.json());

function verifySignature(
  payload: string,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", config.GITHUB_WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function initGithub() {
  app.get("", (_, res) => {
    res.json({ msg: "github webhooks work" });
  });

  const githubHandlers: {
    [key: string]: GithubHandlerFunction;
  } = {
    "issues.opened": (req) => handleOpened(req),
    "issues.closed": (req) => handleClosed(req),
    "issues.reopened": (req) => handleReopened(req),
    "issues.locked": (req) => handleLocked(req),
    "issues.unlocked": (req) => handleUnlocked(req),
    "issues.deleted": (req) => handleDeleted(req),
    "issues.labeled": (req) => handleLabeled(req),
    "issues.unlabeled": (req) => handleUnlabeled(req),
    "issue_comment.created": (req) => handleCreated(req),
    "projects_v2_item.edited": (req) => handleProjectItemEdited(req),
  };

  app.post("/", async (req, res) => {
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const payload = JSON.stringify(req.body);

    if (!verifySignature(payload, signature)) {
      res.status(401).json({ msg: "invalid signature" });
      return;
    }

    const event = req.headers["x-github-event"] as string;
    const action = req.body.action as string;
    const key = `${event}.${action}`;
    const handler = githubHandlers[key];
    handler && handler(req);
    res.json({ msg: "ok" });
  });

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

export default app;
