import { S3Client, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;

/**
 * 判断 URL 是否属于 R2
 */
export const isR2Url = (url: string) => {
  if (!url || !PUBLIC_URL) return false;
  
  // 更加宽松的匹配逻辑：忽略协议(http/https)和末尾斜杠
  const normalize = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return normalize(url).startsWith(normalize(PUBLIC_URL));
};

/**
 * Upload a file to Cloudflare R2
 */
export async function uploadToBlob(path: string, buffer: Buffer, contentType?: string) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: path,
    Body: buffer,
    ContentType: contentType,
  });

  await r2Client.send(command);
  
  // 返回公共可访问的 URL
  return `${PUBLIC_URL}/${path}`;
}

/**
 * Delete a file from Cloudflare R2 using its URL
 */
export async function deleteFromBlob(url: string) {
  if (!url) return;
  
  // 如果是旧的 Vercel Blob 链接，直接忽略
  if (!isR2Url(url)) {
    console.log('[R2] Skipping delete for non-R2 URL:', url);
    return;
  }

  try {
    // 使用 URL 对象更准确地提取路径作为 Key
    const urlObj = new URL(url);
    // pathname 通常以 / 开头，S3 的 Key 不需要开头的 /
    const key = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
    
    console.log(`[R2] Attempting to delete key: ${key}`);
    
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await r2Client.send(command);
    console.log(`[R2] Successfully deleted: ${key}`);
  } catch (error) {
    console.error('[R2] Failed to delete:', url, error);
  }
}

/**
 * Copy a file within Cloudflare R2
 */
export async function copyBlob(sourceUrl: string, destinationPath: string) {
  try {
    // 如果源是 Vercel Blob，无法直接在 R2 内部 Copy，必须报错让上层走回退逻辑
    if (!isR2Url(sourceUrl)) {
      throw new Error('Cannot copy from non-R2 source');
    }

    const urlObj = new URL(sourceUrl);
    const sourceKey = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
    
    const command = new CopyObjectCommand({
      Bucket: BUCKET_NAME,
      CopySource: `${BUCKET_NAME}/${sourceKey}`,
      Key: destinationPath,
    });

    await r2Client.send(command);
    
    return `${PUBLIC_URL}/${destinationPath}`;
  } catch (error) {
    console.error('Failed to copy in R2:', sourceUrl, error);
    throw error;
  }
}
