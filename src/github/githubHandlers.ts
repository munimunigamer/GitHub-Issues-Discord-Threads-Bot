import { Request } from "express";
import {
  archiveThread,
  createComment,
  createThread,
  deleteThread,
  lockThread,
  unarchiveThread,
  unlockThread,
  updateKanbanTag,
} from "../discord/discordActions";
import { logger } from "../logger";
import { store } from "../store";
import { getDiscordInfoFromGithubBody } from "./githubActions";

async function getIssueNodeId(req: Request): Promise<string | undefined> {
  return req.body.issue.node_id;
}

export async function handleOpened(req: Request) {
  if (!req.body.issue) return;
  const { node_id, number, title, user, body } = req.body.issue;
  if (store.threads.some((thread) => thread.node_id === node_id)) return;

  const { login } = user;

  // Phase 6: Tags are opinionated and not derived from GitHub labels
  createThread({ login, appliedTags: [], number, title, body, node_id });
}

export async function handleCreated(req: Request) {
  const { user, id, body } = req.body.comment;
  const { login, avatar_url } = user;
  const { node_id } = req.body.issue;

  // Check if the comment already contains Discord info
  if (getDiscordInfoFromGithubBody(body).channelId) {
    // If it does, stop processing (assuming created with a bot)
    return;
  }

  createComment({
    git_id: id,
    body,
    login,
    avatar_url,
    node_id,
  });
}

export async function handleClosed(req: Request) {
  const node_id = await getIssueNodeId(req);
  archiveThread(node_id);
}

export async function handleReopened(req: Request) {
  const node_id = await getIssueNodeId(req);
  unarchiveThread(node_id);
}

export async function handleLocked(req: Request) {
  const node_id = await getIssueNodeId(req);
  lockThread(node_id);
}

export async function handleUnlocked(req: Request) {
  const node_id = await getIssueNodeId(req);
  unlockThread(node_id);
}

export async function handleDeleted(req: Request) {
  const node_id = await getIssueNodeId(req);
  deleteThread(node_id);
}

export async function handleProjectItemEdited(req: Request) {
  // Guard: kanban disabled (no project detected at startup)
  if (!store.projectId) return;

  // Guard: must be a field_value change (not a body edit)
  const changes = req.body.changes;
  if (!changes?.field_value) return;

  const { field_type, field_name, from, to } = changes.field_value;

  // Guard: only process single_select Status field changes
  if (field_type !== "single_select") return;
  if (!field_name || field_name.toLowerCase() !== "status") return;

  // Extract content_node_id (the issue's node_id)
  const contentNodeId = req.body.projects_v2_item?.content_node_id;
  if (!contentNodeId) return;

  const oldColumnName: string | undefined = from?.name;
  const newColumnName: string | undefined = to?.name;

  // Guard: Status was cleared (moved to no column)
  if (!newColumnName) return;

  logger.info(
    `Kanban: Issue moved from "${oldColumnName || "(none)"}" to "${newColumnName}"`,
  );

  await updateKanbanTag(contentNodeId, oldColumnName, newColumnName);

  // If moved to "Done" column, archive the thread
  if (newColumnName.toLowerCase() === "done") {
    await archiveThread(contentNodeId);
  }
}
