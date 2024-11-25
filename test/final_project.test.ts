import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
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
      CidrBlock: '10.0.0.0/16',
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
    template.resourceCountIs('AWS::Lambda::Function', 3);
  });

  test('EC2 Instance Created', () => {
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't2.micro',
    });
  });
});

