import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME!;
const MAX_AGE_MINUTES = parseInt(process.env.MAX_AGE_MINUTES || '30');

export const handler = async (): Promise<void> => {
  try {
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - (MAX_AGE_MINUTES * 60 * 1000));

    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
    });

    const response = await s3Client.send(listCommand);
    
    if (!response.Contents || response.Contents.length === 0) {
      return;
    }

    const objectsToDelete = response.Contents
      .filter(object => object.LastModified && object.LastModified < cutoffTime)
      .map(object => ({ Key: object.Key! }));

    if (objectsToDelete.length === 0) {
      return;
    }

    const deleteCommand = new DeleteObjectsCommand({
      Bucket: BUCKET_NAME,
      Delete: { Objects: objectsToDelete },
    });

    await s3Client.send(deleteCommand);
    console.log(`Deleted ${objectsToDelete.length} objects older than ${MAX_AGE_MINUTES} minutes`);
  } catch (error) {
    console.error('Error cleaning up old files:', error);
    throw error;
  }
};