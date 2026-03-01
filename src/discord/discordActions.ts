import {
  EmbedBuilder,
  ForumChannel,
  MessagePayload,
  ThreadChannel,
} from "discord.js";
import { config } from "../config";
import { ProjectColumn, Thread } from "../interfaces";
import { octokit, repoCredentials } from "../github/githubActions";
import {
  ActionValue,
  Actions,
  Triggerer,
  getDiscordUrl,
  logger,
} from "../logger";
import { store } from "../store";
import client from "./discord";

const TAG_BUDGET = {
  total: 20, // Discord hard limit
  opinionated: 14, // Max opinionated tags
  kanban: 6, // Max kanban column tags (20 - opinionated)
};

const OPINIONATED_TAGS: { name: string; moderated?: boolean }[] = [
  // Issue type
  { name: "Bug" },
  { name: "Feature" },
  { name: "Question" },
  { name: "Discussion" },
  // Priority (moderator-only)
  { name: "Critical", moderated: true },
  { name: "High Priority", moderated: true },
  { name: "Low Priority" },
  // Status (moderator-only)
  { name: "Needs Triage", moderated: true },
  { name: "Accepted", moderated: true },
  { name: "Won't Fix", moderated: true },
  // Meta
  { name: "Good First Issue" },
  { name: "Help Wanted" },
  { name: "Duplicate", moderated: true },
];

const info = (action: ActionValue, thread: Thread) =>
  logger.info(`${Triggerer.Github} | ${action} | ${getDiscordUrl(thread)}`);

/**
 * IMG-02: Extract image URLs from GitHub markdown content.
 * Handles both markdown image syntax ![alt](url) and HTML <img src="url"> tags.
 * Returns deduplicated array of image URL strings.
 */
export function extractImageUrls(markdown: string): string[] {
  if (!markdown) return [];

  const urls: string[] = [];

  // Markdown images: ![alt](url) or ![alt](url "title")
  const mdRegex = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = mdRegex.exec(markdown)) !== null) {
    urls.push(match[2]);
  }

  // HTML img tags: <img ... src="url" ...>
  const htmlRegex = /<img\s[^>]*src=["']([^"']+)["'][^>]*>/gi;
  while ((match = htmlRegex.exec(markdown)) !== null) {
    urls.push(match[1]);
  }

  // Deduplicate
  return [...new Set(urls)];
}

/**
 * IMG-02: Strip image syntax (markdown and HTML) from text so Discord
 * doesn't show raw tags alongside the embeds.
 */
export function stripImageSyntax(markdown: string): string {
  if (!markdown) return markdown;
  return markdown
    .replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g, "")
    .replace(/<img\s[^>]*src=["'][^"']+["'][^>]*\/?>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * IMG-02: Create Discord embed objects for image URLs.
 * Discord supports up to 10 embeds per message; slices to 10 if more.
 */
export function createImageEmbeds(imageUrls: string[]): EmbedBuilder[] {
  return imageUrls.slice(0, 10).map((url) => new EmbedBuilder().setImage(url));
}

export async function createThread({
  body,
  login,
  title,
  appliedTags,
  node_id,
  number,
}: {
  body: string;
  login: string;
  title: string;
  appliedTags: string[];
  node_id: string;
  number: number;
}) {
  try {
    const forum = client.channels.cache.get(
      config.DISCORD_CHANNEL_ID,
    ) as ForumChannel;

    // LINK-02: Append [#N] suffix to thread title
    const suffix = ` [#${number}]`;
    const maxBase = 100 - suffix.length;
    const suffixedTitle =
      title.length + suffix.length > 100
        ? title.slice(0, maxBase) + suffix
        : title + suffix;

    // LINK-01: Include GitHub issue URL in first message
    const issueUrl = `https://github.com/${config.GITHUB_USERNAME}/${config.GITHUB_REPOSITORY}/issues/${number}`;

    // IMG-02: Extract image URLs from body, create embeds, and strip image tags from text
    const imageUrls = body ? extractImageUrls(body) : [];
    const imageEmbeds = createImageEmbeds(imageUrls);
    const displayBody = imageUrls.length > 0 ? stripImageSyntax(body) : body;

    const forumThread = await forum.threads.create({
      message: {
        content: `**${login}** opened this issue on GitHub: ${issueUrl}\n\n${displayBody || "*No description provided.*"}`,
        ...(imageEmbeds.length > 0 && { embeds: imageEmbeds }),
      },
      name: suffixedTitle,
      appliedTags,
    });

    // Directly register in store -- don't rely on handleThreadCreate
    const existingIndex = store.threads.findIndex(
      (t) => t.id === forumThread.id,
    );
    if (existingIndex !== -1) {
      // handleThreadCreate already added it -- patch it
      store.threads[existingIndex].node_id = node_id;
      store.threads[existingIndex].number = number;
      store.threads[existingIndex].body = body;
      store.threads[existingIndex].title = suffixedTitle;
    } else {
      // handleThreadCreate hasn't fired yet -- add it directly
      store.threads.push({
        id: forumThread.id,
        title: suffixedTitle,
        appliedTags: [...forumThread.appliedTags],
        node_id,
        number,
        body,
        comments: [],
        archived: false,
        locked: false,
      });
    }

    // Write Discord URL back to GitHub issue body for restart recovery
    const discordUrl = `https://discord.com/channels/${forum.guildId}/${forumThread.id}/${forumThread.id}`;
    const updatedBody = `${body || ""}\n\n---\n[View on Discord](${discordUrl})`;
    await octokit.rest.issues.update({
      ...repoCredentials,
      issue_number: number,
      body: updatedBody,
    });

    const thread = store.threads.find((t) => t.id === forumThread.id);
    if (thread) info(Actions.Created, thread);
  } catch (err) {
    logger.error(
      `Failed to create thread: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
  }
}

export async function createComment({
  git_id,
  body,
  login,
  avatar_url,
  node_id,
}: {
  git_id: number;
  body: string;
  login: string;
  avatar_url: string;
  node_id: string;
}) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel) return;

  // IMG-02: Extract image URLs from body, create embeds, and strip image tags from text
  const imageUrls = body ? extractImageUrls(body) : [];
  const imageEmbeds = createImageEmbeds(imageUrls);
  const displayBody = imageUrls.length > 0 ? stripImageSyntax(body) : body;

  channel.parent
    ?.createWebhook({ name: login, avatar: avatar_url })
    .then((webhook) => {
      const messagePayload = MessagePayload.create(webhook, {
        content: displayBody,
        threadId: thread.id,
        ...(imageEmbeds.length > 0 && { embeds: imageEmbeds }),
      }).resolveBody();
      webhook
        .send(messagePayload)
        .then(({ id }) => {
          thread?.comments.push({ id, git_id });
          webhook.delete("Cleanup");

          info(Actions.Commented, thread);
        })
        .catch(console.error);
    })
    .catch(console.error);
}

export async function archiveThread(node_id: string | undefined) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel || channel.archived) return;

  info(Actions.Closed, thread);

  thread.archived = true;
  channel.setArchived(true);
}

export async function unarchiveThread(node_id: string | undefined) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel || !channel.archived) return;

  info(Actions.Reopened, thread);

  thread.archived = false;
  channel.setArchived(false);
}

export async function lockThread(node_id: string | undefined) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel || channel.locked) return;

  info(Actions.Locked, thread);

  thread.locked = true;
  if (channel.archived) {
    thread.lockArchiving = true;
    thread.lockLocking = true;
    channel.setArchived(false);
    channel.setLocked(true);
    channel.setArchived(true);
  } else {
    channel.setLocked(true);
  }
}

export async function unlockThread(node_id: string | undefined) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel || !channel.locked) return;

  info(Actions.Unlocked, thread);

  thread.locked = false;
  if (channel.archived) {
    thread.lockArchiving = true;
    thread.lockLocking = true;
    channel.setArchived(false);
    channel.setLocked(false);
    channel.setArchived(true);
  } else {
    channel.setLocked(false);
  }
}

export async function deleteThread(node_id: string | undefined) {
  const { channel, thread } = await getThreadChannel(node_id);
  if (!thread || !channel) return;

  info(Actions.Deleted, thread);

  store.deleteThread(thread?.id);
  channel.delete();
}

export async function getThreadChannel(node_id: string | undefined): Promise<{
  channel: ThreadChannel<boolean> | undefined;
  thread: Thread | undefined;
}> {
  let channel: ThreadChannel<boolean> | undefined;
  if (!node_id) return { thread: undefined, channel };

  const thread = store.threads.find((thread) => thread.node_id === node_id);
  if (!thread) return { thread, channel };

  channel = <ThreadChannel | undefined>client.channels.cache.get(thread.id);
  if (channel) return { thread, channel };

  try {
    const fetchChanel = await client.channels.fetch(thread.id);
    channel = <ThreadChannel | undefined>fetchChanel;
  } catch (err) {
    /* empty */
  }

  return { thread, channel };
}

export async function addTagToThread(node_id: string, tagId: string) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel) return;

  // Check if tag is already applied
  if (thread.appliedTags.includes(tagId)) return;

  // Respect Discord's 5-tag per-thread limit
  if (thread.appliedTags.length >= 5) {
    logger.warn(
      `Thread ${thread.title}: Cannot add tag, already at 5-tag limit`,
    );
    return;
  }

  const newTags = [...thread.appliedTags, tagId].slice(0, 5);

  // Set lock flag before making the change
  thread.lockTagging = true;

  // Handle archived threads: unarchive, modify, re-archive
  const wasArchived = channel.archived;
  if (wasArchived) {
    thread.lockArchiving = true;
    await channel.setArchived(false);
  }

  await channel.setAppliedTags(newTags);
  thread.appliedTags = newTags;

  if (wasArchived) {
    await channel.setArchived(true);
  }

  info(Actions.Tagged, thread);
}

export async function removeTagFromThread(node_id: string, tagId: string) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel) return;

  // Check if tag is actually applied
  if (!thread.appliedTags.includes(tagId)) return;

  const newTags = thread.appliedTags.filter((t) => t !== tagId);

  // Set lock flag before making the change
  thread.lockTagging = true;

  // Handle archived threads: unarchive, modify, re-archive
  const wasArchived = channel.archived;
  if (wasArchived) {
    thread.lockArchiving = true;
    await channel.setArchived(false);
  }

  await channel.setAppliedTags(newTags);
  thread.appliedTags = newTags;

  if (wasArchived) {
    await channel.setArchived(true);
  }

  info(Actions.Untagged, thread);
}

export async function resetOpinionatedTags() {
  const forum = (await client.channels.fetch(
    config.DISCORD_CHANNEL_ID,
  )) as ForumChannel;

  await forum.setAvailableTags(OPINIONATED_TAGS);

  const refreshed = await forum.fetch();
  store.availableTags = refreshed.availableTags;

  // Populate tagMap: opinionated tag name -> Discord tag ID
  store.tagMap.clear();
  for (const tag of OPINIONATED_TAGS) {
    const matchingTag = store.availableTags.find((t) => t.name === tag.name);
    if (matchingTag) {
      store.tagMap.set(tag.name, matchingTag.id);
    }
  }

  logger.info(
    `Tag reset: ${store.availableTags.length} opinionated tags set, ${store.tagMap.size} mapped (${store.availableTags.length}/${TAG_BUDGET.total} slots used)`,
  );
}

export async function resetOpinionatedLabels() {
  // Fetch all existing labels
  const { data: existingLabels } = await octokit.rest.issues.listLabelsForRepo({
    ...repoCredentials,
    per_page: 100,
  });

  // Delete every existing label (sequential to avoid rate limits)
  let deletedCount = 0;
  for (const label of existingLabels) {
    await octokit.rest.issues.deleteLabel({
      ...repoCredentials,
      name: label.name,
    });
    deletedCount++;
  }

  // Create a label for each opinionated tag
  for (const tag of OPINIONATED_TAGS) {
    await octokit.rest.issues.createLabel({
      ...repoCredentials,
      name: tag.name,
    });
  }

  logger.info(
    `Label reset: deleted ${deletedCount} old labels, created ${OPINIONATED_TAGS.length} opinionated labels`,
  );
}

export async function syncKanbanTags(columns: ProjectColumn[]) {
  const forum = (await client.channels.fetch(
    config.DISCORD_CHANNEL_ID,
  )) as ForumChannel;
  const existingTags = forum.availableTags;

  const existingTagNames = new Set(existingTags.map((t) => t.name));

  const kanbanSlots = Math.min(columns.length, TAG_BUDGET.kanban);
  const columnsToSync = columns.slice(0, kanbanSlots);

  if (columns.length > TAG_BUDGET.kanban) {
    logger.warn(
      `Kanban: Project has ${columns.length} status columns but only ${TAG_BUDGET.kanban} reserved tag slots. Only syncing first ${TAG_BUDGET.kanban}.`,
    );
  }

  // Filter columns that don't already exist as tags
  const newColumnTags = columnsToSync
    .filter((col) => !existingTagNames.has(col.name.slice(0, 20)))
    .map((col) => {
      const truncated = col.name.slice(0, 20);
      if (col.name.length > 20) {
        logger.warn(
          `Kanban: Column name "${col.name}" truncated to "${truncated}" for Discord tag`,
        );
      }
      return { name: truncated };
    });

  // Check total budget
  if (existingTags.length + newColumnTags.length > TAG_BUDGET.total) {
    logger.warn(
      `Kanban: Cannot create ${newColumnTags.length} kanban tags -- would exceed ${TAG_BUDGET.total}-tag Discord limit (${existingTags.length} already used)`,
    );
    return;
  }

  // Create new tags if any
  if (newColumnTags.length > 0) {
    await forum.setAvailableTags([...existingTags, ...newColumnTags]);
  }

  // Refresh the forum and update store
  const refreshed = await forum.fetch();
  store.availableTags = refreshed.availableTags;

  // Populate kanbanTagMap
  store.kanbanTagMap.clear();
  for (const col of columnsToSync) {
    const truncated = col.name.slice(0, 20);
    const matchingTag = store.availableTags.find((t) => t.name === truncated);
    if (matchingTag) {
      store.kanbanTagMap.set(col.name, matchingTag.id);
    }
  }

  logger.info(
    `Kanban: ${store.kanbanTagMap.size} column tags synced (${store.availableTags.length}/${TAG_BUDGET.total} tag slots used)`,
  );
}

export async function updateKanbanTag(
  contentNodeId: string,
  oldColumnName: string | undefined,
  newColumnName: string,
) {
  const { thread, channel } = await getThreadChannel(contentNodeId);
  if (!thread || !channel) return;

  // Look up old and new tag IDs from kanbanTagMap
  const oldTagId = oldColumnName
    ? store.kanbanTagMap.get(oldColumnName)
    : undefined;
  const newTagId = store.kanbanTagMap.get(newColumnName);

  if (!newTagId) {
    logger.warn(
      `Kanban: No Discord tag found for column "${newColumnName}" -- column may not be synced`,
    );
    return;
  }

  // Build new tags: remove old kanban tag, add new one (never accumulate)
  let newTags = [...thread.appliedTags];
  if (oldTagId) {
    newTags = newTags.filter((t) => t !== oldTagId);
  }

  if (!newTags.includes(newTagId)) {
    if (newTags.length >= 5) {
      logger.warn(
        `Thread ${thread.title}: Cannot add kanban tag, at 5-tag limit`,
      );
      return;
    }
    newTags.push(newTagId);
  }

  // Set lock flag before making Discord API calls
  thread.lockTagging = true;

  // Handle archived threads: unarchive, modify, re-archive
  const wasArchived = channel.archived;
  if (wasArchived) {
    thread.lockArchiving = true;
    await channel.setArchived(false);
  }

  await channel.setAppliedTags(newTags);
  thread.appliedTags = newTags;

  if (wasArchived) {
    await channel.setArchived(true);
  }

  info(Actions.Tagged, thread);
}

export async function enrichThreadAfterIssueCreation(thread: Thread) {
  if (!thread.number) return;

  try {
    // LINK-02: Rename thread with [#N] suffix
    const channel = (await client.channels.fetch(thread.id)) as ThreadChannel;
    const suffix = ` [#${thread.number}]`;
    const maxBase = 100 - suffix.length;
    const newName = thread.title.slice(0, maxBase) + suffix;
    await channel.setName(newName);
    thread.title = newName;

    // LINK-01: Send bot message with GitHub issue URL
    const issueUrl = `https://github.com/${config.GITHUB_USERNAME}/${config.GITHUB_REPOSITORY}/issues/${thread.number}`;
    await channel.send(`GitHub issue created: ${issueUrl}`);

    // LINK-03: Append Discord URL to GitHub issue body
    const discordUrl = `https://discord.com/channels/${channel.guildId}/${thread.id}/${thread.id}`;
    const updatedBody = `${thread.body}\n\n---\n[View on Discord](${discordUrl})`;
    await octokit.rest.issues.update({
      ...repoCredentials,
      issue_number: thread.number,
      body: updatedBody,
    });
    thread.body = updatedBody;
  } catch (err) {
    logger.warn(
      `Cross-link enrichment failed for thread ${thread.id}: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
  }
}
