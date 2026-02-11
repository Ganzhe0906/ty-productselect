import { sql } from '@vercel/postgres';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config({ path: resolve(__dirname, '../.env.local') });

async function clearNeon() {
  console.log('正在清空 Neon 数据库...');
  try {
    const result = await sql`DELETE FROM libraries`;
    console.log(`✅ Neon 数据库已清空，删除了 ${result.rowCount} 条记录。`);
  } catch (error) {
    console.error('❌ 清空 Neon 失败:', error);
  }
}

async function clearR2() {
  console.log('正在清空 Cloudflare R2...');
  const r2Client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
  });

  const bucketName = process.env.R2_BUCKET_NAME;

  try {
    // 1. 列出所有文件
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
    });
    const listResponse = await r2Client.send(listCommand);

    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      console.log('✅ R2 存储桶已经是空的。');
      return;
    }

    // 2. 批量删除
    const objectsToDelete = listResponse.Contents.map((obj) => ({ Key: obj.Key }));
    
    const deleteCommand = new DeleteObjectsCommand({
      Bucket: bucketName,
      Delete: { Objects: objectsToDelete },
    });

    await r2Client.send(deleteCommand);
    console.log(`✅ R2 存储桶已清空，删除了 ${objectsToDelete.length} 个文件。`);
  } catch (error) {
    console.error('❌ 清空 R2 失败:', error);
  }
}

async function main() {
  console.log('⚠️ 开始执行全量数据清空操作...');
  await clearNeon();
  await clearR2();
  console.log('✨ 所有数据已重置，你可以重新开始了！');
  process.exit(0);
}

main();
