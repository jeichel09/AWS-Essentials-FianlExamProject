#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FinalProjectStack } from '../lib/final_project-stack';

const app = new cdk.App();
new FinalProjectStack(app, 'FinalProjectStack', {
  clientEmail: 'dunyto@etik.com',
  allowedFileExtensions: ['.pdf', '.doc', '.docx'],
  stage: 'prod',
  env: { account: '703671935296', region: 'eu-central-1' },
  tags: {
    Environment: 'prod',
    Project: 'FinalProject'
  }
  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});