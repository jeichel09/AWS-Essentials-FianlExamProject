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

    expect(dynamoDbMock.commandCalls(PutItemCommand)).toHaveLength(1);
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
    
    // Verify the content of the DynamoDB call
    const putItemCall = dynamoDbMock.commandCalls(PutItemCommand)[0];
    expect(putItemCall.args[0].input).toMatchObject({
      TableName: 'TestTable',
      Item: expect.objectContaining({
        fileExtension: { S: '.pdf' },
        fileName: { S: 'test-file.pdf' },
        fileSize: { N: '1024' }
      })
    });
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

    expect(dynamoDbMock.commandCalls(PutItemCommand)).toHaveLength(0);
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(1);
    
    // Verify SNS message content
    const publishCall = snsMock.commandCalls(PublishCommand)[0];
    expect(publishCall.args[0].input).toMatchObject({
      TopicArn: 'arn:aws:sns:region:account:topic',
      Message: expect.stringContaining('Invalid file extension: .exe')
    });
  });
});