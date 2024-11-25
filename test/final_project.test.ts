import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as FinalProject from '../lib/final_project-stack';

describe('FinalProject Stack', () => {
  const app = new cdk.App();
  const stack = new FinalProject.FinalProjectStack(app, 'TestStack', {
    clientEmail: 'test@example.com',
    allowedFileExtensions: ['.pdf', '.doc', '.docx'],
    stage: 'prod',
    env: { account: '123456789012', region: 'eu-central-1' }
  });
  const template = Template.fromStack(stack);

  test('VPC Created', () => {
    template.hasResourceProperties('AWS::EC2::VPC', {
      CidrBlock: Match.anyValue(),
      EnableDnsHostnames: true,
      EnableDnsSupport: true,
    });
  });

  test('S3 Bucket Created', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: [
          {
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'POST', 'PUT'],
            AllowedOrigins: ['*'],
          },
        ],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true
      }
    });
  });

  test('DynamoDB Table Created', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        {
          AttributeName: 'id',
          KeyType: 'HASH',
        },
        {
          AttributeName: 'uploadDate',
          KeyType: 'RANGE',
        },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  test('Lambda Functions Created', () => {
    // Check for existence of each Lambda function
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Runtime: 'nodejs18.x',
    });

    // Verify the total number of Lambda functions
    const functions = template.findResources('AWS::Lambda::Function');
    expect(Object.keys(functions).length).toBe(5);
  });

  test('EC2 Instance Created', () => {
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't2.micro',
    });
  });

  test('Error SNS Topic Created', () => {
    template.hasResourceProperties('AWS::SNS::Topic', {
      DisplayName: 'File Processing Errors',
    });
  });
});