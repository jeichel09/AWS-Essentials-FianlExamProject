import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as destinations from 'aws-cdk-lib/aws-lambda-destinations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { RemovalPolicy, Duration } from 'aws-cdk-lib';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';


interface FileProcessingStackProps extends cdk.StackProps {
  readonly clientEmail: string;
  readonly allowedFileExtensions: string[];
  readonly stage: 'prod';
}

export class FinalProjectStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: FileProcessingStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'FileProcessingVPC', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        }
      ]
    });

    // Create Security Group for EC2
    const webServerSG = new ec2.SecurityGroup(this, 'WebServerSG', {
      vpc,
      description: 'Security group for web server',
      allowAllOutbound: true,
    });

    // Allow inbound traffic
    webServerSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP'
    );
    webServerSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS'
    );
    webServerSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH'
    );

    // Create SNS Topic for error notifications
    const errorTopic = new sns.Topic(this, 'ErrorNotificationTopic', {
      displayName: 'File Processing Errors'
    });

    // Create S3 bucket
    const bucket = new s3.Bucket(this, 'FileStorageBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true
      }),
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.POST,
            s3.HttpMethods.PUT,
          ],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });

    // Create DynamoDB table
    const table = new dynamodb.Table(this, 'FileMetadataTable', {
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'uploadDate',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'expirationTime',
      stream: dynamodb.StreamViewType.NEW_IMAGE, // Enable DynamoDB Streams
    });

    // Add GSI for file extension queries
    table.addGlobalSecondaryIndex({
      indexName: 'FileExtensionIndex',
      partitionKey: {
        name: 'fileExtension',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'uploadDate',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Create S3 Event Processing Lambda
    const s3ProcessingLambda = new lambdaNodejs.NodejsFunction(this, 'S3ProcessingLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: `${__dirname}/../src/s3Processing.ts`,
      environment: {
        TABLE_NAME: table.tableName,
        ALLOWED_EXTENSIONS: JSON.stringify(props?.allowedFileExtensions ?? []),
        ERROR_TOPIC_ARN: errorTopic.topicArn,
      },
      timeout: Duration.seconds(30),
      onFailure: new destinations.SnsDestination(errorTopic),
    });

    // Create Email Notification Lambda
    const emailNotificationLambda = new lambdaNodejs.NodejsFunction(this, 'EmailNotificationLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      entry: `${__dirname}/../src/emailNotification.ts`,
      environment: {
        CLIENT_EMAIL: props?.clientEmail ?? '',
      },
      timeout: Duration.seconds(30),
      onFailure: new destinations.SnsDestination(errorTopic),
    });

    // Create cleanup Lambda
    const cleanupLambda = new lambdaNodejs.NodejsFunction(this, 'CleanupLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: `${__dirname}/../src/cleanup.ts`,
      environment: {
        BUCKET_NAME: bucket.bucketName,
        MAX_AGE_MINUTES: '30',
      },
      timeout: Duration.seconds(30),
    });

    // Grant permissions to s3 Event Lambdas
    bucket.grantRead(s3ProcessingLambda);
    table.grantWriteData(s3ProcessingLambda);
    errorTopic.grantPublish(s3ProcessingLambda);
    
    // Grant SES permissions to email Lambda
    emailNotificationLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
      effect: iam.Effect.ALLOW,
    }));

    // Grant permissions to cleanup Lambda
    bucket.grantReadWrite(cleanupLambda);

    // Create EventBridge rule to trigger cleanup
    new events.Rule(this, 'CleanupSchedule', {
      schedule: events.Schedule.rate(Duration.minutes(5)), // Runs every 5 minutes
      targets: [new targets.LambdaFunction(cleanupLambda)],
    });

    // Add S3 trigger for processing Lambda
    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(s3ProcessingLambda)
    );

    // Add DynamoDB Stream trigger for email notification Lambda
    emailNotificationLambda.addEventSource(
      new lambdaEventSources.DynamoEventSource(table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 1,
        retryAttempts: 3,
      })
    );

    // Create EC2 Role
    const ec2Role = new iam.Role(this, 'EC2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    // Add necessary policies to EC2 role
    ec2Role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess')
    );
    ec2Role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess')
    );

    // Create EC2 instance
    const ec2Instance = new ec2.Instance(this, 'WebServer', {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroup: webServerSG,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      role: ec2Role,
      keyPair: ec2.KeyPair.fromKeyPairName(this, 'ImportedKeyPair', 'my-key-pair'),
    });

    // Create asset for user data script
    const userDataAsset = new Asset(this, 'UserDataAsset', {
      path: path.join(__dirname, '../scripts/user-data.sh'),
    });

    // Grant read permissions to the instance
    userDataAsset.grantRead(ec2Instance.role);

    // Add user data to the instance
    const localPath = ec2Instance.userData.addS3DownloadCommand({
      bucket: userDataAsset.bucket,
      bucketKey: userDataAsset.s3ObjectKey,
    });

    ec2Instance.userData.addExecuteFileCommand({
      filePath: localPath,
      arguments: '--verbose -y',
    });

    // Add environment variables to user data
    ec2Instance.userData.addCommands(
      `echo "export BUCKET_NAME=${bucket.bucketName}" >> /etc/environment`,
      `echo "export TABLE_NAME=${table.tableName}" >> /etc/environment`,
      `echo "export ALLOWED_EXTENSIONS=${props?.allowedFileExtensions?.join(',') ?? ''}" >> /etc/environment`,
      `echo "export CLIENT_EMAIL=${props?.clientEmail ?? ''}" >> /etc/environment`,
    );

    // Stack Outputs
    new cdk.CfnOutput(this, 'InstancePublicIP', {
      value: ec2Instance.instancePublicIp,
    });

    new cdk.CfnOutput(this, 'InstancePublicDNS', {
      value: ec2Instance.instancePublicDnsName,
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
    });
  }
}
