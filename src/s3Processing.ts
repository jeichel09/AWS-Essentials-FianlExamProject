import { S3Event } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import * as path from 'path';

const dynamoDb = new DynamoDBClient({});
const sns = new SNSClient({});
const s3 = new S3Client({});

const allowedExtensions = JSON.parse(process.env.ALLOWED_EXTENSIONS || '[]');

export const handler = async (event: S3Event) => {
  const record = event.Records[0];
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key);
  const extension = path.extname(key).toLowerCase();

  try {
    // Check file extension
    if (!allowedExtensions.includes(extension)) {
      // Send error notification
      await sns.send(new PublishCommand({
        TopicArn: process.env.ERROR_TOPIC_ARN,
        Message: `Invalid file extension: ${extension} for file ${key}`,
      }));
      return;
    }

    // Get file metadata from S3
    const headObject = await s3.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    }));

    const timestamp = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + (30 * 60); // 30 minutes

    // Store metadata in DynamoDB
    await dynamoDb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        id: { S: `${Date.now()}` },
        uploadDate: { S: timestamp },
        fileExtension: { S: extension },
        fileName: { S: key },
        fileSize: { N: headObject.ContentLength?.toString() || '0' },
        expirationTime: { N: ttl.toString() }
      }
    }));

  } catch (error) {
    console.error('Error processing S3 event:', error);
    throw error;
  }
};