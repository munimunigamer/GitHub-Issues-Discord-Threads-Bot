import {
  AnyThreadChannel,
  Client,
  DMChannel,
  ForumChannel,
  Message,
  NonThreadGuildBasedChannel,
  PartialMessage,
  ThreadChannel,
} from "discord.js";
import { config } from "../config";
import {
  addLabelsToIssue,
  closeIssue,
  createIssue,
  createIssueComment,
  deleteComment,
  deleteIssue,
  discoverProject,
  getIssues,
  lockIssue,
  openIssue,
  removeLabelFromIssue,
  unlockIssue,
} from "../github/githubActions";
import { logger } from "../logger";
import { store } from "../store";
import { Thread } from "../interfaces";
import {
  syncKanbanTags,
  resetOpinionatedTags,
  resetOpinionatedLabels,
  enrichThreadAfterIssueCreation,
} from "./discordActions";

export async function handleClientReady(client: Client) {
  logger.info(`Logged in as ${client.user?.tag}!`);

  store.threads = await getIssues();

  // Fetch cache for closed threads
  const threadPromises = store.threads.map(async (thread) => {
    const cachedChannel = client.channels.cache.get(thread.id) as
      | ThreadChannel
      | undefined;
    if (cachedChannel) {
      cachedChannel.messages.cache.forEach((message) => message.id);
      return thread; // Returning thread as valid
    } else {
      try {
        const channel = (await client.channels.fetch(
          thread.id,
        )) as ThreadChannel;
        channel.messages.cache.forEach((message) => message.id);
        return thread; // Returning thread as valid
      } catch (error) {
        return; // Marking thread as invalid
      }
    }
  });
  const threadPromisesResults = await Promise.all(threadPromises);
  store.threads = threadPromisesResults.filter(
    (thread) => thread !== undefined,
  ) as Thread[];

  logger.info(`Issues loaded : ${store.threads.length}`);

  const forumChannel = (await client.channels.fetch(
    config.DISCORD_CHANNEL_ID,
  )) as ForumChannel;
  store.availableTags = forumChannel.availableTags;

  try {
    await resetOpinionatedTags();
  } catch (err) {
    logger.error(
      `Tag reset failed during startup: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
  }

  try {
    await resetOpinionatedLabels();
  } catch (err) {
    logger.error(
      `Label reset failed during startup: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
  }

  try {
    const project = await discoverProject();
    if (project) {
      store.projectId = project.projectId;
      store.statusFieldId = project.statusFieldId;
      store.kanbanColumns = project.columns;
      await syncKanbanTags(project.columns);
    }
  } catch (err) {
    logger.error(
      `Kanban init failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
  }
}

export async function handleThreadCreate(params: AnyThreadChannel) {
  if (params.parentId !== config.DISCORD_CHANNEL_ID) return;

  // Skip if already tracked (bot just created this thread via createThread)
  if (store.threads.some((t) => t.id === params.id)) return;

  const { id, name, appliedTags } = params;

  store.threads.push({
    id,
    appliedTags,
    title: name,
    archived: false,
    locked: false,
    comments: [],
  });
}

export async function handleChannelUpdate(
  params: DMChannel | NonThreadGuildBasedChannel,
) {
  if (params.id !== config.DISCORD_CHANNEL_ID) return;

  if (params.type === 15) {
    store.availableTags = params.availableTags;
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, idx) => val === b[idx]);
}

export async function handleThreadUpdate(
  oldThread: AnyThreadChannel,
  newThread: AnyThreadChannel,
) {
  if (newThread.parentId !== config.DISCORD_CHANNEL_ID) return;

  const { id, archived, locked } = newThread;
  const thread = store.threads.find((item) => item.id === id);
  if (!thread) return;

  // --- Tag change detection ---
  const oldTags = thread.appliedTags;
  const currentTags = [...newThread.appliedTags];

  if (!thread.lockTagging && !arraysEqual(oldTags, currentTags)) {
    thread.appliedTags = currentTags; // Update store immediately

    const added = currentTags.filter((t) => !oldTags.includes(t));
    const removed = oldTags.filter((t) => !currentTags.includes(t));

    // Convert tag IDs to label names using store.tagMap (reverse lookup)
    // Only opinionated tags have entries in tagMap, so non-opinionated tags are automatically ignored
    const addedLabels = added
      .map((id) => {
        for (const [name, tagId] of store.tagMap.entries()) {
          if (tagId === id) return name;
        }
        return undefined;
      })
      .filter((name): name is string => name !== undefined);

    const removedLabels = removed
      .map((id) => {
        for (const [name, tagId] of store.tagMap.entries()) {
          if (tagId === id) return name;
        }
        return undefined;
      })
      .filter((name): name is string => name !== undefined);

    if (addedLabels.length > 0) {
      thread.lockLabeling = true;
      await addLabelsToIssue(thread, addedLabels);
    }
    if (removedLabels.length > 0) {
      thread.lockLabeling = true;
      for (const label of removedLabels) {
        await removeLabelFromIssue(thread, label);
      }
    }
  }

  // Reset lockTagging if it was set (echo suppression for kanban and label sync)
  if (thread.lockTagging) {
    thread.lockTagging = false;
    thread.appliedTags = currentTags; // Still update store
  }

  if (thread.locked !== locked && !thread.lockLocking) {
    if (thread.archived) {
      thread.lockArchiving = true;
    }
    thread.locked = locked;
    locked ? lockIssue(thread) : unlockIssue(thread);
  }
  if (thread.archived !== archived) {
    setTimeout(() => {
      // timeout for fixing discord archived post locking
      if (thread.lockArchiving) {
        if (archived) {
          thread.lockArchiving = false;
        }
        thread.lockLocking = false;
        return;
      }
      thread.archived = archived;
      archived ? closeIssue(thread) : openIssue(thread);
    }, 500);
  }
}

export async function handleMessageCreate(params: Message) {
  const { channelId, author } = params;

  if (author.bot) return;

  const thread = store.threads.find((thread) => thread.id === channelId);

  if (!thread) return;

  if (!thread.body) {
    await createIssue(thread, params);
    await enrichThreadAfterIssueCreation(thread);
  } else {
    createIssueComment(thread, params);
  }
}

export async function handleMessageDelete(params: Message | PartialMessage) {
  const { channelId, id } = params;
  const thread = store.threads.find((i) => i.id === channelId);
  if (!thread) return;

  const commentIndex = thread.comments.findIndex((i) => i.id === id);
  if (commentIndex === -1) return;

  const comment = thread.comments.splice(commentIndex, 1)[0];
  deleteComment(thread, comment.git_id);
}

export async function handleThreadDelete(params: AnyThreadChannel) {
  if (params.parentId !== config.DISCORD_CHANNEL_ID) return;

  const thread = store.threads.find((item) => item.id === params.id);
  if (!thread) return;

  deleteIssue(thread);
}
