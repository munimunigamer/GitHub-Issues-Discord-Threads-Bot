import express from "express";
import { GithubHandlerFunction } from "../interfaces";
import {
  handleClosed,
  handleCreated,
  handleDeleted,
  handleLabeled,
  handleLocked,
  handleOpened,
  handleReopened,
  handleUnlabeled,
  handleUnlocked,
} from "./githubHandlers";

const app = express();
app.use(express.json());

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
  };

  app.post("/", async (req, res) => {
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
