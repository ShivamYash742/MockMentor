/**
 * Server-side Appwrite client using node-appwrite SDK.
 * This is used in API routes (server-side) for secure file operations.
 * The client SDK (appwrite) only works in browsers — this SDK works in Node.js / serverless.
 */
import { Client, Storage } from 'node-appwrite';

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const bucketId = process.env.NEXT_PUBLIC_BUCKET_ID;
const apiKey = process.env.APPWRITE_API_KEY;

if (!endpoint) {
  throw new Error(
    'Missing NEXT_PUBLIC_APPWRITE_ENDPOINT. Set it in .env.'
  );
}

if (!projectId) {
  throw new Error(
    'Missing NEXT_PUBLIC_APPWRITE_PROJECT_ID. Set it in .env.'
  );
}

if (!bucketId) {
  throw new Error(
    'Missing NEXT_PUBLIC_BUCKET_ID (Appwrite Storage Bucket ID). Set it in .env.'
  );
}

if (!apiKey) {
  throw new Error(
    'Missing APPWRITE_API_KEY. Create an API key in your Appwrite Console → Settings → API Keys, and add it to .env.'
  );
}

const client = new Client()
  .setEndpoint(endpoint)
  .setProject(projectId)
  .setKey(apiKey);

export const serverStorage = new Storage(client);

export const BUCKET_ID = bucketId;
