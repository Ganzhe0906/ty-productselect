import { put, del, copy } from '@vercel/blob';

/**
 * Upload a file to Vercel Blob
 */
export async function uploadToBlob(path: string, buffer: Buffer, contentType?: string) {
  const { url } = await put(path, buffer, {
    access: 'public',
    contentType: contentType,
  });
  return url;
}

/**
 * Delete a file from Vercel Blob using its URL
 */
export async function deleteFromBlob(url: string) {
  try {
    await del(url);
  } catch (error) {
    console.error('Failed to delete from blob:', url, error);
  }
}

/**
 * Copy a file within Vercel Blob
 */
export async function copyBlob(sourceUrl: string, destinationPath: string) {
  const { url } = await copy(sourceUrl, destinationPath, {
    access: 'public',
  });
  return url;
}
