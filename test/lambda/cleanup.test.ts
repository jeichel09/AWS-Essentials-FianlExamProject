import { handler } from '../../src/cleanup';
import { mockClient } from 'aws-sdk-client-mock';
import { 
  S3Client, 
  ListObjectsV2Command, 
  DeleteObjectsCommand 
} from '@aws-sdk/client-s3';

const s3Mock = mockClient(S3Client);

describe('Cleanup Lambda', () => {
  beforeEach(() => {
    s3Mock.reset();
    process.env.BUCKET_NAME = 'test-bucket';
    process.env.MAX_AGE_MINUTES = '30';
  });

  test('deletes old files', async () => {
    const oldDate = new Date();
    oldDate.setHours(oldDate.getHours() - 1);

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        {
          Key: 'old-file.pdf',
          LastModified: oldDate
        }
      ]
    });

    s3Mock.on(DeleteObjectsCommand).resolves({});

    await handler();

    expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(1);
  });

  test('skips new files', async () => {
    const newDate = new Date();

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        {
          Key: 'new-file.pdf',
          LastModified: newDate
        }
      ]
    });

    await handler();

    expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
  });
});