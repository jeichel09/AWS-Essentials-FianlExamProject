import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as FinalProject from '../lib/final_project-stack';

describe('FinalProject Stack', () => {
  let app: cdk.App;
  let stack: FinalProject.FinalProjectStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new FinalProject.FinalProjectStack(app, 'MyTestStack');
    template = Template.fromStack(stack);
  });

  test('Lambda Function Created', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs18.x',
      Handler: 'index.handler',
    });
  });

  test('DynamoDB Table Created', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  test('S3 Bucket Created', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });
});
