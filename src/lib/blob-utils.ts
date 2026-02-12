import { S3Client, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';

// 延迟初始化 S3 客户端，确保在调用时环境变量已加载
let _r2Client: S3Client | null = null;

function getR2Client() {
  if (!_r2Client) {
    const endpoint = process.env.R2_ENDPOINT;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!endpoint) {
      console.error('[R2] Missing R2_ENDPOINT environment variable');
    }

    _r2Client = new S3Client({
      region: 'auto',
      endpoint: endpoint || undefined,
      credentials: {
        accessKeyId: accessKeyId || '',
        secretAccessKey: secretAccessKey || '',
      },
      // R2 强烈建议设置 forcePathStyle 为 true
      forcePathStyle: true,
    });
  }
  return _r2Client;
}

const getBucketName = () => process.env.R2_BUCKET_NAME || '';
const getPublicUrl = () => process.env.R2_PUBLIC_URL || '';

/**
 * 判断 URL 是否属于 R2
 */
export const isR2Url = (url: string) => {
  const publicUrl = getPublicUrl();
  if (!url || !publicUrl) return false;
  
  // 更加宽松的匹配逻辑：忽略协议(http/https)和末尾斜杠
  const normalize = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return normalize(url).startsWith(normalize(publicUrl));
};

/**
 * Upload a file to Cloudflare R2
 */
export async function uploadToBlob(path: string, buffer: Buffer, contentType?: string) {
  const bucketName = getBucketName();
  if (!bucketName) throw new Error('R2_BUCKET_NAME is not defined');

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: path,
    Body: buffer,
    ContentType: contentType,
  });

  try {
    const client = getR2Client();
    await client.send(command);
    
    // 返回公共可访问的 URL
    return `${getPublicUrl()}/${path}`;
  } catch (error: any) {
    console.error('[R2] Upload failed:', error);
    if (error.message.includes('ENOTFOUND') && !process.env.R2_ENDPOINT) {
      throw new Error('R2 存储配置错误：未找到 R2_ENDPOINT 环境变量，请检查 Vercel 项目设置。');
    }
    throw error;
  }
}

/**
 * Delete a file from Cloudflare R2 using its URL
 */
export async function deleteFromBlob(url: string) {
  if (!url) return;
  
  if (!isR2Url(url)) {
    console.log('[R2] Skipping delete for non-R2 URL:', url);
    return;
  }

  try {
    const urlObj = new URL(url);
    const key = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
    
    const bucketName = getBucketName();
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const client = getR2Client();
    await client.send(command);
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
    if (!isR2Url(sourceUrl)) {
      throw new Error('Cannot copy from non-R2 source');
    }

    const urlObj = new URL(sourceUrl);
    const sourceKey = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
    
    const bucketName = getBucketName();
    const command = new CopyObjectCommand({
      Bucket: bucketName,
      CopySource: `${bucketName}/${sourceKey}`,
      Key: destinationPath,
    });

    const client = getR2Client();
    await client.send(command);
    
    return `${getPublicUrl()}/${destinationPath}`;
  } catch (error: any) {
    console.error('[R2] Copy failed:', error);
    throw error;
  }
}
