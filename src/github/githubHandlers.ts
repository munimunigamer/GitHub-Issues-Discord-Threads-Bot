import { Request } from "express";
import {
  addTagToThread,
  archiveThread,
  createComment,
  createThread,
  deleteThread,
  getThreadChannel,
  lockThread,
  removeTagFromThread,
  sendActivityMessage,
  sendActivityMessageByNumber,
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

  // Ensure at least one tag -- Discord forums may require a tag to create a post
  if (appliedTags.length === 0) {
    const fallbackTagId = store.tagMap.get("Needs Triage");
    if (fallbackTagId) {
      appliedTags.push(fallbackTagId);
    }
  }

  await createThread({ login, appliedTags, number, title, body, node_id });
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

  // Skip type labels — managed via handleTyped/handleUntyped
  if (TYPE_TAG_NAMES.has(label.name)) return;

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

  // Skip type labels — managed via handleTyped/handleUntyped
  if (TYPE_TAG_NAMES.has(label.name)) return;

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

// --- Activity event handlers ---

/** Parse `#N` references from a PR body, distinguishing closing keywords from plain references. */
export function parseIssueReferences(body: string | null | undefined): {
  closing: number[];
  referencing: number[];
} {
  const closing: number[] = [];
  const referencing: number[] = [];
  if (!body) return { closing, referencing };

  const closingRegex = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  const closingNumbers = new Set<number>();
  let match;
  while ((match = closingRegex.exec(body)) !== null) {
    closingNumbers.add(Number(match[1]));
  }
  closing.push(...closingNumbers);

  const refRegex = /#(\d+)/g;
  while ((match = refRegex.exec(body)) !== null) {
    const num = Number(match[1]);
    if (!closingNumbers.has(num) && !referencing.includes(num)) {
      referencing.push(num);
    }
  }

  return { closing, referencing };
}

export async function handlePullRequestOpened(req: Request) {
  const pr = req.body.pull_request;
  if (!pr) return;
  const { login, avatar_url } = req.body.sender;
  const prLink = `[${pr.title} #${pr.number}](${pr.html_url})`;
  const { closing, referencing } = parseIssueReferences(pr.body);

  for (const num of referencing) {
    await sendActivityMessageByNumber({
      number: num,
      login,
      avatar_url,
      content: `opened pull request ${prLink} referencing this issue`,
    });
  }
  for (const num of closing) {
    await sendActivityMessageByNumber({
      number: num,
      login,
      avatar_url,
      content: `opened pull request ${prLink} that will close this issue`,
    });
  }
}

export async function handlePullRequestMerged(req: Request) {
  const pr = req.body.pull_request;
  if (!pr || !pr.merged) return;
  const { login, avatar_url } = req.body.sender;
  const prLink = `[${pr.title} #${pr.number}](${pr.html_url})`;
  const { closing, referencing } = parseIssueReferences(pr.body);

  const nonClosing = referencing;
  for (const num of nonClosing) {
    await sendActivityMessageByNumber({
      number: num,
      login,
      avatar_url,
      content: `merged pull request ${prLink}`,
    });
  }
  for (const num of closing) {
    await sendActivityMessageByNumber({
      number: num,
      login,
      avatar_url,
      content: `merged pull request ${prLink}, closing this issue`,
    });
  }
}

export async function handleAssigned(req: Request) {
  if (!req.body.issue || !req.body.assignee) return;
  const { login, avatar_url } = req.body.sender;
  const node_id = req.body.issue.node_id;
  const assignee = req.body.assignee.login;

  await sendActivityMessage({
    node_id,
    login,
    avatar_url,
    content: `assigned **${assignee}**`,
  });
}

export async function handleUnassigned(req: Request) {
  if (!req.body.issue || !req.body.assignee) return;
  const { login, avatar_url } = req.body.sender;
  const node_id = req.body.issue.node_id;
  const assignee = req.body.assignee.login;

  await sendActivityMessage({
    node_id,
    login,
    avatar_url,
    content: `unassigned **${assignee}**`,
  });
}

export async function handleMilestoned(req: Request) {
  if (!req.body.issue || !req.body.milestone) return;
  const { login, avatar_url } = req.body.sender;
  const node_id = req.body.issue.node_id;
  const milestoneName = req.body.milestone.title;

  await sendActivityMessage({
    node_id,
    login,
    avatar_url,
    content: `added this to milestone **${milestoneName}**`,
  });
}

export async function handleDemilestoned(req: Request) {
  if (!req.body.issue || !req.body.milestone) return;
  const { login, avatar_url } = req.body.sender;
  const node_id = req.body.issue.node_id;
  const milestoneName = req.body.milestone.title;

  await sendActivityMessage({
    node_id,
    login,
    avatar_url,
    content: `removed this from milestone **${milestoneName}**`,
  });
}

export async function handleTransferred(req: Request) {
  if (!req.body.issue) return;
  const { login, avatar_url } = req.body.sender;
  const node_id = req.body.issue.node_id;
  const newRepo = req.body.changes?.new_repository;
  const repoFullName = newRepo ? newRepo.full_name : "another repository";

  await sendActivityMessage({
    node_id,
    login,
    avatar_url,
    content: `transferred this issue to **${repoFullName}**`,
  });
}

export async function handleEdited(req: Request) {
  if (!req.body.issue) return;
  const changes = req.body.changes;
  if (!changes?.title) return; // Only act on title changes

  const { login, avatar_url } = req.body.sender;
  const node_id = req.body.issue.node_id;
  const oldTitle = changes.title.from;
  const newTitle = req.body.issue.title;

  await sendActivityMessage({
    node_id,
    login,
    avatar_url,
    content: `changed the title: ~~${oldTitle}~~ -> ${newTitle}`,
  });

  // Rename the Discord thread to match (preserve [#N] suffix)
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel) return;

  const number = thread.number;
  if (number) {
    const suffix = ` [#${number}]`;
    const maxBase = 100 - suffix.length;
    const newName =
      newTitle.length + suffix.length > 100
        ? newTitle.slice(0, maxBase) + suffix
        : newTitle + suffix;

    try {
      const wasArchived = channel.archived;
      if (wasArchived) {
        thread.lockArchiving = true;
        await channel.setArchived(false);
      }
      await channel.setName(newName);
      thread.title = newName;
      if (wasArchived) {
        await channel.setArchived(true);
      }
    } catch (err) {
      logger.warn(
        `Failed to rename thread ${thread.id}: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  }
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
