import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { DEFAULT_REGION } from '../config.js';

// Text embeddings via Amazon Titan Text Embeddings V2 on Bedrock. Ported
// from readysetcloud/content-tracking (api/services/embeddings.mjs). Kept
// separate from the chat model pipeline because embeddings use the
// InvokeModel API with a model-specific request body and its own model id.

const MODEL_ID = process.env.EMBEDDING_MODEL_ID || 'amazon.titan-embed-text-v2:0';

/**
 * Embedding vector dimension. Titan v2 supports 1024 / 512 / 256; 1024 is the
 * default for best recall and **must** match the dimension the S3 Vectors index
 * was created with.
 */
export const EMBEDDING_DIMENSIONS = 1024;

const bedrock = new BedrockRuntimeClient({ region: DEFAULT_REGION });

/**
 * Embeds a single string and returns the embedding as number[]. `normalize`
 * is on so cosine distance in the vector index behaves as expected.
 */
export async function embedText(
  text: string,
  { dimensions = EMBEDDING_DIMENSIONS }: { dimensions?: number } = {},
): Promise<number[]> {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('embedText requires non-empty text');
  }

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ inputText: text, dimensions, normalize: true }),
  });

  const response = await bedrock.send(command);

  const parsed = JSON.parse(new TextDecoder().decode(response.body)) as {
    embedding?: number[];
  };

  if (!Array.isArray(parsed.embedding) || parsed.embedding.length === 0) {
    throw new Error('Titan embedding response contained no embedding');
  }

  return parsed.embedding;
}
