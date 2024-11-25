import { handler } from '../../src/s3Processing';
import { mockClient } from 'aws-sdk-client-mock';
import { 
  DynamoDBClient, 
  PutItemCommand 
} from '@aws-sdk/client-dynamodb';
import { 
  S3Client, 
  HeadObjectCommand 
} from '@aws-sdk/client-s3';
import { 
  SNSClient, 
  PublishCommand 
} from '@aws-sdk/client-sns';

const dynamoDbMock = mockClient(DynamoDBClient);
const s3Mock = mockClient(S3Client);
const snsMock = mockClient(SNSClient);

describe('S3 Processing Lambda', () => {
  beforeEach(() => {
    dynamoDbMock.reset();
    s3Mock.reset();
    snsMock.reset();
    process.env.ALLOWED_EXTENSIONS = JSON.stringify(['.pdf', '.doc', '.docx']);
    process.env.TABLE_NAME = 'TestTable';
    process.env.ERROR_TOPIC_ARN = 'arn:aws:sns:region:account:topic';
  });

  test('processes valid file extension', async () => {
    const event = {
      Records: [{
        s3: {
          bucket: { name: 'test-bucket' },
          object: { key: 'test-file.pdf' }
        }
      }]
    };

    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 1024
    });

    dynamoDbMock.on(PutItemCommand).resolves({});

    await handler(event as any);

    expect(dynamoDbMock.calls()).toHaveLength(1);
    expect(snsMock.calls()).toHaveLength(0);
  });

  test('rejects invalid file extension', async () => {
    const event = {
      Records: [{
        s3: {
          bucket: { name: 'test-bucket' },
          object: { key: 'test-file.exe' }
        }
      }]
    };

    snsMock.on(PublishCommand).resolves({});

    await handler(event as any);

    expect(dynamoDbMock.calls()).toHaveLength(0);
    expect(snsMock.calls()).toHaveLength(1);
  });
});