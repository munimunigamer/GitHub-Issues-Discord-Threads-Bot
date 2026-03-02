import { Request } from "express";
import {
  addTagToThread,
  archiveThread,
  createComment,
  createThread,
  deleteThread,
  lockThread,
  removeTagFromThread,
  TYPE_TAG_NAMES,
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
  const {
    node_id,
    number,
    title,
    user,
    body,
    labels,
    type: issue_type,
  } = req.body.issue;
  if (store.threads.some((thread) => thread.node_id === node_id)) return;

  const { login } = user;

  // Map opinionated labels to Discord tag IDs
  const appliedTags = (labels || [])
    .map((label: { name: string }) => store.tagMap.get(label.name))
    .filter((tagId: string | undefined): tagId is string => tagId !== undefined)
    .slice(0, 5); // Discord 5-tag limit

  // Map native issue type to Discord tag ID
  if (issue_type?.name) {
    const typeTagId = store.tagMap.get(issue_type.name);
    if (
      typeTagId &&
      !appliedTags.includes(typeTagId) &&
      appliedTags.length < 5
    ) {
      appliedTags.push(typeTagId);
    }
  }

  createThread({ login, appliedTags, number, title, body, node_id });
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

export async function handleTyped(req: Request) {
  const { node_id } = req.body.issue;
  const issueType = req.body.issue?.type;
  if (!issueType || !node_id) return;

  const thread = store.threads.find((t) => t.node_id === node_id);
  if (!thread) return;

  // Echo suppression: skip if this type change was initiated by the bot
  if (thread.lockLabeling) {
    thread.lockLabeling = false;
    return;
  }

  const newTagId = store.tagMap.get(issueType.name);
  if (!newTagId) return;

  // Add new type tag first, then remove old ones (add-first avoids the
  // "cannot remove last tag" guard when the old type is the only tag)
  await addTagToThread(node_id, newTagId);

  for (const [name, tagId] of store.tagMap.entries()) {
    if (
      TYPE_TAG_NAMES.has(name) &&
      tagId !== newTagId &&
      thread.appliedTags.includes(tagId)
    ) {
      await removeTagFromThread(node_id, tagId);
    }
  }
}

export async function handleUntyped(req: Request) {
  const { node_id } = req.body.issue;
  if (!node_id) return;

  const thread = store.threads.find((t) => t.node_id === node_id);
  if (!thread) return;

  // Echo suppression: skip if this type change was initiated by the bot
  if (thread.lockLabeling) {
    thread.lockLabeling = false;
    return;
  }

  // Determine the old type name from webhook changes payload
  const oldTypeName = req.body.changes?.type?.from?.name;
  if (!oldTypeName) return;

  const tagId = store.tagMap.get(oldTypeName);
  if (!tagId) return;

  await removeTagFromThread(node_id, tagId);
}

export async function handleLabeled(req: Request) {
  const { node_id } = req.body.issue;
  const label = req.body.label;
  if (!label || !node_id) return;

  const thread = store.threads.find((t) => t.node_id === node_id);
  if (!thread) return;

  // Echo suppression: skip if this label change was initiated by the bot
  if (thread.lockLabeling) {
    thread.lockLabeling = false;
    return;
  }

  // Only sync opinionated tags -- silently ignore non-opinionated labels
  const tagId = store.tagMap.get(label.name);
  if (!tagId) return;

  await addTagToThread(node_id, tagId);
}

export async function handleUnlabeled(req: Request) {
  const { node_id } = req.body.issue;
  const label = req.body.label;
  if (!label || !node_id) return;

  const thread = store.threads.find((t) => t.node_id === node_id);
  if (!thread) return;

  // Echo suppression: skip if this label change was initiated by the bot
  if (thread.lockLabeling) {
    thread.lockLabeling = false;
    return;
  }

  // Only sync opinionated tags -- silently ignore non-opinionated labels
  const tagId = store.tagMap.get(label.name);
  if (!tagId) return;

  await removeTagFromThread(node_id, tagId);
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
