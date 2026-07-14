import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { recallMemory } from '../memory/vector-memory.js';

/**
 * Builds the `recall_memory` Strands tool — the TypeScript replacement for the
 * Python Strands `memory` tool. It performs a semantic search over the user's
 * past conversation turns (stored in S3 Vectors) and returns the closest matches
 * for the model to fold into its answer.
 *
 * The tool is built per-user and **closes over the verified `userId`** rather
 * than accepting it as a model argument: the model cannot ask for another
 * user's memories because it cannot choose the userId. This is the
 * tenant-isolation rule (identity comes from the verified caller, never from
 * model/user-supplied input) applied to memory recall.
 *
 * @param userId Verified caller id the recall is scoped to.
 * @returns A Strands tool ready to pass in `createAssistant({ tools })`.
 */
export function createRecallMemoryTool(userId: string) {
  return tool({
    name: 'recall_memory',
    description:
      "Search your long-term memory of past conversations with this user. " +
      'Use it when the user references something from an earlier session, or ' +
      'when prior context would make your answer more relevant.',
    inputSchema: z.object({
      query: z
        .string()
        .describe('A natural-language description of what to recall.'),
      topK: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe('How many memories to retrieve (default 5).'),
    }),
    callback: async ({ query, topK }) => {
      const results = await recallMemory({ userId, query, topK: topK ?? 5 });
      if (results.length === 0) {
        return 'No relevant memories found.';
      }
      return results
        .map((r) => `- (${r.role ?? 'unknown'}) ${r.text ?? ''}`.trim())
        .join('\n');
    },
  });
}
